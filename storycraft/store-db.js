/**
 * Work-level and chapter-level store on SQLite.
 *
 * `catalog.db` owns the workspace metadata (titles, proposals, session
 * pointers); each work owns a database file under `.storycraft/works/`. Every
 * mutation opens only the database it needs, runs in `BEGIN IMMEDIATE`, and
 * returns virtual artifact paths (`works/<workId>/chapters/ch-0007.md`) that do
 * not correspond to files on disk. File moves (rename/delete/restore) run the
 * catalog write and the move in an order that can be rolled back.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync, writeSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  backupTo, checkpoint, createWorkDatabase, exportsDir, integrityCheck, WORK_SCHEMA_VERSION,
  materialsDir, moveDatabaseFiles, openCatalog, openDatabase, openWork, removeDatabaseFiles, transaction,
  trashDir, trashFile, workFile, worksDir, backupsDir,
} from './db.js'
import { MATERIAL_PURPOSES, MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from './materials.js'
import { buildEpub } from './epub.js'
import { snippetFor } from './retrieval.js'
import { materialIndexText, searchTokens } from './search-text.js'

export { searchTokens }
import {
  StoryError, SUMMARY_MAX_CHARS, WORK_FORMS, chapterNumber, chapterStem, contentVersion, countWords, foldEvents,
  formOf, now, parseReview, planApprovalPolicy, stageOf, summaryAdmissible, trimSummary, unitOf, workIdOf,
} from './domain.js'
import { assertRevisionMode } from './revision.js'

/** How long an unused proposal is kept before the next proposal write prunes it. */
export const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Fixed mtime of export files, so directory copies stay reproducible. */
const EXPORT_MTIME = new Date('2000-01-01T00:00:00.000Z')

/** In-process export queues, keyed by workspace + work id. */
const exportLocks = new Map()

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Virtual path of one work root, as actions and routes report it. */
export function virtualWorkPath(workId) {
  return `works/${workId}`
}

/** Virtual path of one artifact inside a work. */
export function virtualPath(workId, relative) {
  return `${virtualWorkPath(workId)}/${String(relative).replaceAll('\\', '/')}`
}

/** One catalog row, or undefined. */
function catalogRow(db, workId) {
  return db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(workId))
}

/** The catalog row of an active work, or `work-not-found`. */
function activeWork(db, workId) {
  const row = catalogRow(db, workId)
  if (row === undefined || row.trashed_at !== null) throw new StoryError('work-not-found', `没有作品：${String(workId)}`)
  return row
}

/** Read `meta`, the single row of one work database. */
function metaOf(db) {
  const row = db.prepare('SELECT * FROM meta WHERE id = 1').get()
  if (row === undefined) throw new StoryError('db-corrupt', '作品库缺少 meta 行')
  return row
}

/** Whether one chapter exists. */
function chapterRow(db, number) {
  return db.prepare('SELECT * FROM chapters WHERE number = ?').get(number)
}

/** Insert a planned chapter row when absent. */
function ensureChapter(db, number) {
  const existing = chapterRow(db, number)
  if (existing !== undefined) return existing
  db.prepare('INSERT INTO chapters (number, updated_at) VALUES (?, ?)').run(number, now())
  return chapterRow(db, number)
}

/**
 * Current/stale/missing summary state for one chapter, on the caller's handle.
 * @param {import('node:sqlite').DatabaseSync} db - open work database.
 * @param {number} number - chapter number.
 * @returns {{state: 'current'|'stale'|'missing', text: string|undefined, revision: number|null, currentRevision: number}} state.
 */
export function summaryStateOf(db, number) {
  const row = db.prepare(`SELECT s.text, s.revision, c.current_revision
    FROM chapters c LEFT JOIN summaries s ON s.number = c.number
    WHERE c.number = ?`).get(number)
  return summaryStateOfRow(row)
}

/** Derive the summary state from one joined row. */
function summaryStateOfRow(row) {
  if (row === undefined) {
    return { state: 'missing', text: undefined, revision: null, currentRevision: 0 }
  }
  const text = row.text ?? undefined
  const revision = row.revision ?? null
  if (text === undefined || String(text).trim() === '' || revision === null) {
    return { state: 'missing', text, revision, currentRevision: row.current_revision }
  }
  const state = revision === row.current_revision ? 'current' : 'stale'
  return { state, text, revision, currentRevision: row.current_revision }
}

/** Summary state for every chapter of one work, keyed by chapter number. */
function summaryStateMap(db) {
  const map = new Map()
  for (const row of db.prepare(`SELECT c.number, s.text, s.revision, c.current_revision
    FROM chapters c LEFT JOIN summaries s ON s.number = c.number ORDER BY c.number`).all()) {
    map.set(row.number, summaryStateOfRow(row))
  }
  return map
}

/** Read one chapter's state from a map that covers every chapter row. */
function summaryStateFrom(map, number) {
  const state = map.get(number)
  if (state === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  return state
}

/** The newest review row of one chapter. */
function latestReviewRow(db, number) {
  return db.prepare('SELECT * FROM reviews WHERE number = ? ORDER BY round DESC LIMIT 1').get(number)
}

/** The current body row of one chapter. */
function currentVersion(db, chapter) {
  return db.prepare('SELECT * FROM chapter_versions WHERE number = ? AND revision = ?')
    .get(chapter.number, chapter.current_revision)
}

/**
 * Whether a review still describes a chapter's current revision.
 * @param {{revision: number}|undefined} review - newest review.
 * @param {{currentRevision?: number, current_revision?: number}} chapter - chapter entry or row.
 * @param {boolean} [allowPrevious] - accept the revision just replaced.
 * @returns {boolean} true when the review covers the chapter.
 */
function reviewCovers(review, chapter, allowPrevious = false) {
  const current = chapter.currentRevision ?? chapter.current_revision
  if (review === undefined || current === undefined) return false
  return review.revision === current || (allowPrevious && review.revision === current - 1)
}

/** A clean review records zero problems and authorizes the clean settlement path. */
function isCleanReview(review) {
  return typeof review?.text === 'string' && review.text.includes('- 清稿：无问题')
}

/** Touch the meta row's activity stamp. */
function touchMeta(db, at = now()) {
  db.prepare('UPDATE meta SET updated_at = ? WHERE id = 1').run(at)
}

/** Serialize every event row as the JSONL text `foldEvents` consumes. */
function eventsText(db) {
  return db.prepare('SELECT * FROM events ORDER BY seq').all()
    .map(row => JSON.stringify({ seq: row.seq, at: row.at, chapter: row.chapter, kind: row.kind, ...JSON.parse(row.payload) }))
    .join('\n')
}

/** Fold one work's event log. */
function foldedOf(db) {
  return foldEvents(eventsText(db))
}

/** The default truth rows a new work ships. */
const DEFAULT_BIBLE = {
  world: '# 世界观\n',
  characters: '[]\n',
  style: '# 文风基准\n',
  plan: '# 写作计划\n',
  intent: '# 作者意图与当前焦点\n',
}

// ---------------------------------------------------------------------------
// Work manifest and listing
// ---------------------------------------------------------------------------

/**
 * Read one work manifest from the catalog and its work database.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} manifest.
 */
export function readManifest(root, work) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    try {
      const meta = metaOf(db)
      const chapters = db.prepare('SELECT * FROM chapters ORDER BY number').all()
      return {
        version: 1,
        workId: row.work_id,
        title: row.title,
        form: row.form,
        ...(row.tags === null ? {} : { tags: JSON.parse(row.tags) }),
        planApproval: meta.plan_approval,
        ...(meta.word_min === null ? {} : { wordRange: { min: meta.word_min, max: meta.word_max } }),
        ...(meta.outline_written_at === null ? {} : {
          outline: {
            writtenAt: meta.outline_written_at,
            ...(meta.outline_approved_at === null ? {} : { approvedAt: meta.outline_approved_at }),
          },
        }),
        chapters: chapters.map(chapter => ({
          number: chapter.number,
          id: chapterStem(chapter.number),
          title: chapter.title,
          status: chapter.status,
          stage: chapter.stage,
          currentRevision: chapter.current_revision,
          words: chapter.words,
          ...(chapter.plan_approved_at === null ? {} : { planApprovedAt: chapter.plan_approved_at }),
          ...(chapter.last_revise_mode === null ? {} : { lastReviseMode: chapter.last_revise_mode }),
          updatedAt: chapter.updated_at,
        })),
        createdAt: row.created_at,
        updatedAt: meta.updated_at,
      }
    } finally {
      db.close()
    }
  } finally {
    catalog.close()
  }
}

/**
 * Create a work: the database file first, then the catalog row. A failed
 * catalog insert removes the file, so a half-created work never survives.
 * @param {string} root - workspace directory.
 * @param {{title: string, workId?: string, form?: string, wordRange?: {min: number, max: number}, tags?: string[]}} input - creation input.
 * @returns {{workId: string, path: string, manifest: object}} created work.
 */
export function initWork(root, input) {
  const title = String(input.title ?? '').trim()
  if (title === '') throw new StoryError('invalid-title', '作品需要标题')
  const form = input.form === undefined ? 'longform' : String(input.form)
  if (!WORK_FORMS.includes(form)) throw new StoryError('form-invalid', `作品形态只能是 ${WORK_FORMS.join(' / ')}：收到 ${String(input.form)}`)
  if (input.wordRange !== undefined) {
    const min = Number(input.wordRange?.min)
    const max = Number(input.wordRange?.max)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min) {
      throw new StoryError('word-range-invalid', `字数范围不合法：${JSON.stringify(input.wordRange)}`)
    }
  }
  const workId = typeof input.workId === 'string' && input.workId.trim() !== ''
    ? workIdOf(input.workId)
    : workIdOf(title)
  const catalog = openCatalog(root)
  try {
    if (catalogRow(catalog, workId) !== undefined) throw new StoryError('work-exists', `作品已存在：${workId}`)
    if (existsSync(workFile(root, workId))) throw new StoryError('work-exists', `作品已存在：${workId}`)
    const at = now()
    const tags = Array.isArray(input.tags) ? input.tags.map(tag => String(tag)) : undefined
    createWorkDatabase(root, workId, {
      workId,
      title,
      form,
      tags: tags === undefined ? null : JSON.stringify(tags),
      wordMin: input.wordRange?.min,
      wordMax: input.wordRange?.max,
      createdAt: at,
      updatedAt: at,
    })
    try {
      const db = openWork(root, workId)
      try {
        transaction(db, () => {
          for (const [name, content] of Object.entries(DEFAULT_BIBLE)) {
            db.prepare('INSERT INTO bible (name, content, version, updated_at) VALUES (?, ?, ?, ?)')
              .run(name, content, contentVersion(content), at)
          }
        })
      } finally {
        db.close()
      }
      transaction(catalog, () => {
        catalog.prepare(`INSERT INTO works (work_id, title, form, tags, schema_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(workId, title, form, tags === undefined ? null : JSON.stringify(tags), WORK_SCHEMA_VERSION, at, at)
      })
    } catch (error) {
      removeDatabaseFiles(workFile(root, workId))
      throw error
    }
    // A workspace first seen before this work existed was cached as reconciled;
    // the new catalog must be checked again on the next read.
    reconciledRoots.delete(root)
    return { workId, path: virtualWorkPath(workId), manifest: readManifest(root, workId) }
  } finally {
    catalog.close()
  }
}

/**
 * Compare catalog rows against the files on disk and stamp missing ones.
 *
 * A row without a file is marked `missing_at` and skipped by the list; a file
 * without a row is reported as an orphan and left alone for manual recovery.
 * @param {string} root - workspace directory.
 * @returns {{missing: string[], orphans: string[], trash: string[], degraded: boolean}} reconciliation report.
 */
export function reconcileWorks(root) {
  const catalog = openCatalog(root, { create: false, busyTimeout: 0 })
  try {
    const rows = catalog === undefined ? [] : catalog.prepare('SELECT work_id, trashed_at, missing_at FROM works').all()
    const known = new Set(rows.map(row => row.work_id))
    const missing = rows
      .filter(row => row.trashed_at === null && !existsSync(workFile(root, row.work_id)))
      .map(row => row.work_id)
    let degraded = false
    if (catalog !== undefined) {
      const changed = rows.filter((row) => {
        const present = existsSync(row.trashed_at === null ? workFile(root, row.work_id) : trashFile(root, row.work_id))
        return present ? row.missing_at !== null : row.missing_at === null
      })
      if (changed.length > 0) {
        try {
          transaction(catalog, () => {
            for (const row of changed) {
              const present = existsSync(row.trashed_at === null ? workFile(root, row.work_id) : trashFile(root, row.work_id))
              catalog.prepare('UPDATE works SET missing_at = ? WHERE work_id = ?')
                .run(present ? null : now(), row.work_id)
            }
          })
        } catch {
          // Another writer holds the catalog; the next read retries. The listing
          // itself must stay readable.
          degraded = true
        }
      }
    }
    const orphans = []
    if (existsSync(worksDir(root))) {
      for (const name of readdirSync(worksDir(root))) {
        if (!name.endsWith('.db')) continue
        if (!known.has(name.slice(0, -3))) orphans.push(name)
      }
    }
    const trashedIds = new Set(rows.filter(row => row.trashed_at !== null).map(row => row.work_id))
    const trash = existsSync(trashDir(root))
      ? readdirSync(trashDir(root))
        .filter(name => name.endsWith('.db') && !trashedIds.has(name.slice(0, -3)))
      : []
    return { missing, orphans, trash, degraded }
  } finally {
    catalog?.close()
  }
}

/** Workspaces already reconciled in this process. */
const reconciledRoots = new Set()

/**
 * Reconcile one workspace once per process, at first touch, and record the
 * diagnostics. A listing must stay readable when reconciliation cannot run.
 * @param {string} root - workspace directory.
 */
export function ensureReconciled(root) {
  if (reconciledRoots.has(root)) return
  try {
    const report = reconcileWorks(root)
    // A locked catalog is retried on the next read instead of being marked done.
    if (!report.degraded) reconciledRoots.add(root)
    if (report.missing.length > 0 || report.orphans.length > 0 || report.trash.length > 0) {
      console.warn(`[storycraft] 作品库对账（${root}）：`
        + `缺失 ${report.missing.length}（${report.missing.join('、') || '无'}）；`
        + `孤儿作品文件 ${report.orphans.length}（${report.orphans.join('、') || '无'}）；`
        + `孤儿回收站文件 ${report.trash.length}（${report.trash.join('、') || '无'}）`)
    }
  } catch (error) {
    // Without SQLite every action reports sqlite-unavailable; do not repeat the
    // diagnostic on every listing.
    if (error?.code === 'sqlite-unavailable') reconciledRoots.add(root)
    console.warn(`[storycraft] 作品库对账失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * List active works, newest activity first.
 * @param {string} root - workspace directory.
 * @returns {Array<object>} work summaries.
 */
export function listWorks(root) {
  ensureReconciled(root)
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return []
  try {
    const rows = catalog.prepare('SELECT * FROM works WHERE trashed_at IS NULL AND missing_at IS NULL').all()
    const works = []
    for (const row of rows) {
      let db
      try {
        db = openWork(root, row.work_id)
      } catch (error) {
        // Keep a broken or unmigrated work visible so the panel can explain it,
        // instead of silently dropping it from the list.
        const code = error?.code ?? 'work-open-failed'
        works.push({
          workId: row.work_id,
          title: row.title,
          form: formOf(row),
          chapters: null,
          writtenChapters: null,
          latestChapter: null,
          openProblems: null,
          updatedAt: row.updated_at,
          degraded: true,
          schemaVersion: row.schema_version,
          migrationError: {
            code,
            message: error instanceof Error ? error.message : String(error),
            retryable: code === 'work-busy',
          },
        })
        continue
      }
      try {
        const meta = metaOf(db)
        const chapters = db.prepare('SELECT number, current_revision FROM chapters ORDER BY number').all()
        let openProblems = 0
        for (const review of db.prepare(`SELECT r.text FROM reviews r
          JOIN (SELECT number, max(round) AS round FROM reviews GROUP BY number) newest
            ON newest.number = r.number AND newest.round = r.round`).all()) {
          openProblems += parseReview(review.text).filter(item => !item.done).length
        }
        works.push({
          workId: row.work_id,
          title: row.title,
          form: formOf(row),
          chapters: chapters.length,
          writtenChapters: chapters.filter(chapter => chapter.current_revision > 0).length,
          latestChapter: chapters.length === 0 ? 0 : chapters[chapters.length - 1].number,
          openProblems,
          updatedAt: meta.updated_at,
        })
      } finally {
        db.close()
      }
    }
    return works.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  } finally {
    catalog.close()
  }
}

/**
 * List trashed works, newest first.
 * @param {string} root - workspace directory.
 * @returns {Array<{workId: string, title: string, trashedAt: string, path: string}>} trash entries.
 */
export function listTrash(root) {
  ensureReconciled(root)
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return []
  try {
    return catalog.prepare('SELECT * FROM works WHERE trashed_at IS NOT NULL AND missing_at IS NULL ORDER BY trashed_at DESC')
      .all()
      .map(row => ({
        workId: row.work_id,
        title: row.title,
        trashedAt: row.trashed_at,
        path: `.storycraft/trash/${row.work_id}.db`,
      }))
  } finally {
    catalog.close()
  }
}

/**
 * Read one work for the workbench: manifest, chapters and folded state.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} work detail payload.
 */
export function readWork(root, work) {
  const manifest = readManifest(root, work)
  const db = openWork(root, manifest.workId)
  try {
    const planRows = new Set(db.prepare('SELECT number FROM chapter_plans').all().map(row => row.number))
    const summaryStates = summaryStateMap(db)
    const chapters = manifest.chapters.map(chapter => {
      const review = latestReviewRow(db, chapter.number)
      const summary = summaryStateFrom(summaryStates, chapter.number)
      return {
        number: chapter.number,
        id: chapter.id,
        title: chapter.title,
        status: chapter.status,
        revision: chapter.currentRevision,
        words: chapter.words,
        stage: stageOf(chapter),
        hasPlan: planRows.has(chapter.number),
        planApproved: chapter.planApprovedAt !== undefined,
        hasSummary: summary.state === 'current',
        summaryRevision: summary.revision,
        summaryStale: summary.state === 'stale',
        reviewRound: review?.round ?? 0,
        openProblems: review === undefined ? 0 : parseReview(review.text).filter(item => !item.done).length,
        updatedAt: chapter.updatedAt,
      }
    })
    const folded = foldedOf(db)
    const eventCount = db.prepare('SELECT count(*) AS n FROM events').get().n
    return {
      manifest: {
        version: manifest.version,
        workId: manifest.workId,
        planApproval: planApprovalPolicy(manifest),
        outline: manifest.outline,
        title: manifest.title,
        form: formOf(manifest),
        tags: manifest.tags,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
      },
      chapters,
      state: {
        entities: folded.entities,
        hooks: folded.hooks,
        events: eventCount,
      },
    }
  } finally {
    db.close()
  }
}

/**
 * Progress summary of one work.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} status payload.
 */
export function status(root, work) {
  const manifest = readManifest(root, work)
  const db = openWork(root, manifest.workId)
  try {
    const folded = foldedOf(db)
    const summaryStates = summaryStateMap(db)
    let openProblems = 0
    for (const review of db.prepare(`SELECT r.text FROM reviews r
      JOIN (SELECT number, max(round) AS round FROM reviews GROUP BY number) newest
        ON newest.number = r.number AND newest.round = r.round`).all()) {
      openProblems += parseReview(review.text).filter(item => !item.done).length
    }
    const written = manifest.chapters.filter(chapter => chapter.currentRevision > 0)
    return {
      workId: manifest.workId,
      planApproval: planApprovalPolicy(manifest),
      outline: manifest.outline === undefined
        ? null
        : {
            ...(manifest.outline.writtenAt === undefined ? {} : { writtenAt: manifest.outline.writtenAt }),
            ...(manifest.outline.approvedAt === undefined ? {} : { approvedAt: manifest.outline.approvedAt }),
          },
      title: manifest.title,
      chapters: manifest.chapters.map(chapter => {
        const summary = summaryStateFrom(summaryStates, chapter.number)
        return {
          number: chapter.number,
          status: chapter.status,
          stage: stageOf(chapter),
          revision: chapter.currentRevision,
          words: chapter.words,
          hasSummary: summary.state === 'current',
          summaryRevision: summary.revision,
          summaryStale: summary.state === 'stale',
        }
      }),
      form: formOf(manifest),
      writtenChapters: written.length,
      latestChapter: manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number,
      ...(manifest.wordRange === undefined ? {} : { wordRange: manifest.wordRange }),
      openProblems,
      entities: folded.entities.length,
      hooks: {
        opened: folded.hooks.filter(hook => hook.state === 'opened').length,
        used: folded.hooks.filter(hook => hook.state === 'used').length,
        resolved: folded.hooks.filter(hook => hook.state === 'resolved').length,
      },
    }
  } finally {
    db.close()
  }
}

/**
 * The delegate hint for one next-step result.
 *
 * It appears only when `story_delegate`'s preflight would pass: author gates
 * stay manual, and a `story_revise` that only lacks a submitted revision has no
 * open items for the reviser to work from.
 * @param {{action: string, missing?: string[]}} step - next step.
 * @param {object|undefined} last - last chapter entry.
 * @param {object|undefined} candidate - latest review row.
 * @returns {{role: 'writer'|'reviewer'|'reviser'|'summarizer'}|undefined} delegate hint.
 */
function delegateOf(step, last, candidate) {
  const role = { story_write: 'writer', story_review: 'reviewer', story_revise: 'reviser', story_summarize: 'summarizer' }[step.action]
  if (role === undefined) return undefined
  const missing = Array.isArray(step.missing) ? step.missing : []
  if (missing.includes('outline') || missing.includes('plan-approval') || missing.includes('revision')) return undefined
  if (role === 'reviser' && (last === undefined || candidate === undefined || candidate.revision !== last.currentRevision)) {
    return undefined
  }
  if (role === 'summarizer') {
    return summaryAdmissible(last, candidate) ? { role } : undefined
  }
  return { role }
}

/**
 * The next step of one work, derived from the stage machine. Read-only.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} next step.
 */
export function nextStep(root, work) {
  const manifest = readManifest(root, work)
  const db = openWork(root, manifest.workId)
  try {
    const hasPlan = number => db.prepare('SELECT 1 FROM chapter_plans WHERE number = ?').get(number) !== undefined
    const summaryOf = number => summaryStateOf(db, number)
    const chapters = manifest.chapters
    const last = chapters.length === 0 ? undefined : chapters[chapters.length - 1]
    const chapter = last === undefined ? 1 : last.number
    const outline = manifest.outline
    let candidate
    const step = (() => {
      if (last === undefined && outline?.approvedAt === undefined) {
        const reason = outline === undefined || outline.writtenAt === undefined
          ? '还没有全书计划：先写主线、卷划分与结局方向，等作者确认'
          : '全书计划等作者确认：确认后才能写第 1 章章纲'
        return { chapter, stage: 'planned', action: 'story_outline', reason, missing: ['outline'] }
      }
      if (last === undefined) {
        return { chapter, stage: 'planned', action: 'story_plan', reason: '还没有任何章节：先写第 1 章章纲', missing: [] }
      }
      const stage = stageOf(last)
      const hasBody = last.currentRevision > 0
      if (stage === 'settled') {
        const summary = summaryOf(last.number)
        if (summary.state !== 'current') {
          return {
            chapter: last.number, stage, action: 'story_summarize',
            reason: summary.state === 'stale'
              ? `第 ${last.number} 章已定稿，但摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，后面几章的写前上下文才用得上`
              : `第 ${last.number} 章已定稿但没有摘要：先补摘要，后面几章的写前上下文才用得上`,
            missing: ['summary'],
          }
        }
        const closing = db.prepare('SELECT * FROM volumes WHERE to_ch = ?').all(last.number)
          .find(volume => typeof volume.summary !== 'string' || volume.summary.trim() === '')
        if (closing !== undefined) {
          return {
            chapter: last.number, stage, action: 'story_volume',
            reason: `第 ${last.number} 章是「${closing.title}」的最后一章：给它补一段卷摘要，下一卷的写前上下文要用`,
            missing: ['volume-summary'],
          }
        }
        const next = last.number + 1
        if (outline?.approvedAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_outline',
            reason: '全书计划等作者确认：先在面板点「确认全书计划」，再写下一章章纲', missing: ['outline'],
          }
        }
        return { chapter: next, stage: 'planned', action: 'story_plan', reason: `第 ${last.number} 章已定稿：写第 ${next} 章章纲`, missing: [] }
      }
      if (!hasPlan(last.number)) {
        if (outline?.approvedAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_outline',
            reason: '全书计划等作者确认：先在面板点「确认全书计划」，再写章纲', missing: ['outline'],
          }
        }
        return { chapter: last.number, stage, action: 'story_plan', reason: `第 ${last.number} 章缺章纲`, missing: [] }
      }
      if (!hasBody) {
        if (planApprovalPolicy(manifest) === 'required' && last.planApprovedAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_write',
            reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」，然后写正文`,
            missing: ['plan-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_write', reason: `第 ${last.number} 章已有章纲，写正文`, missing: ['body'] }
      }
      if (stage === 'written') {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      candidate = latestReviewRow(db, last.number)
      if (!reviewCovers(candidate, last, true)) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      if (isCleanReview(candidate) && candidate.revision !== last.currentRevision) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章的清稿审稿针对旧版本 r${candidate.revision}：先重新审稿`, missing: ['review'] }
      }
      const open = parseReview(candidate.text).filter(item => !item.done)
      if (open.length > 0) {
        return {
          chapter: last.number, stage, action: 'story_revise',
          reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map(item => item.id),
        }
      }
      if (!isCleanReview(candidate) && stage !== 'revised') {
        return { chapter: last.number, stage, action: 'story_revise', reason: `第 ${last.number} 章审稿条目已处理完，但还没提交修订`, missing: ['revision'] }
      }
      const summary = summaryOf(last.number)
      if (summary.state !== 'current') {
        return {
          chapter: last.number, stage, action: 'story_summarize',
          reason: summary.state === 'stale'
            ? `第 ${last.number} 章摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，再定稿`
            : isCleanReview(candidate)
              ? `第 ${last.number} 章清稿审稿无问题：先写摘要，再定稿`
              : `第 ${last.number} 章已修订：先写摘要，再定稿`,
          missing: ['summary'],
        }
      }
      return { chapter: last.number, stage, action: 'story_state', reason: isCleanReview(candidate) ? `第 ${last.number} 章清稿审稿无问题，定稿` : `第 ${last.number} 章已修订，定稿`, missing: [] }
    })()
    const delegate = delegateOf(step, last, candidate)
    return {
      workId: manifest.workId,
      ...step,
      form: formOf(manifest),
      unit: unitOf(formOf(manifest)),
      ...(delegate === undefined ? {} : { delegate }),
    }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Settings and the book plan
// ---------------------------------------------------------------------------

/**
 * Update the word range and/or the plan-approval policy.
 * @param {string} root - workspace directory.
 * @param {{work: string, wordRange?: {min: number, max: number}|null, planApproval?: 'required'|'off'|null}} input - settings.
 * @returns {object} stored settings.
 */
export function updateSettings(root, input) {
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const meta = metaOf(db)
      const min = input.wordRange === null ? null : input.wordRange?.min ?? meta.word_min
      const max = input.wordRange === null ? null : input.wordRange?.max ?? meta.word_max
      if (min !== null && max !== null && (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min)) {
        throw new StoryError('word-range-invalid', `字数范围不合法：${JSON.stringify(input.wordRange)}`)
      }
      const policy = input.planApproval === null ? 'required' : input.planApproval ?? meta.plan_approval
      if (policy !== 'required' && policy !== 'off') throw new StoryError('plan-approval-invalid', '章纲确认策略不合法')
      db.prepare('UPDATE meta SET word_min = ?, word_max = ?, plan_approval = ?, updated_at = ? WHERE id = 1')
        .run(min, max, policy, now())
      return {
        workId,
        planApproval: policy,
        ...(min === null ? {} : { wordRange: { min, max } }),
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Write the book plan; a new plan is unapproved until the author confirms it.
 * @param {string} root - workspace directory.
 * @param {{work: string, mainline?: string, volumes?: string, ending?: string}} input - outline input.
 * @returns {{workId: string, outline: object}} stored outline state.
 */
export function writeOutline(root, input) {
  const mainline = String(input.mainline ?? '').trim()
  if (mainline === '') throw new StoryError('outline-invalid', '全书计划至少要写主线')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const text = ['# 写作计划', '', '## 主线', mainline, '', '## 卷划分',
        String(input.volumes ?? '').trim() || '（暂未划分）', '', '## 结局方向',
        String(input.ending ?? '').trim() || '（暂未确定）', ''].join('\n')
      const at = now()
      db.prepare(`INSERT INTO bible (name, content, version, updated_at) VALUES ('plan', ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET content = excluded.content, version = excluded.version, updated_at = excluded.updated_at`)
        .run(text, randomUUID(), at)
      db.prepare('UPDATE meta SET outline_written_at = ?, outline_approved_at = NULL, updated_at = ? WHERE id = 1').run(at, at)
      return { workId, outline: { writtenAt: at } }
    })
  } finally {
    db.close()
  }
}

/**
 * Record the author's confirmation of the book plan (host-only).
 * @param {string} root - workspace directory.
 * @param {{work: string}} input - work identity.
 * @returns {{workId: string, outline: object}} stored outline state.
 */
export function approveOutline(root, input) {
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const meta = metaOf(db)
      if (meta.outline_written_at === null) throw new StoryError('outline-required', '还没有全书计划：先 story_outline')
      const at = now()
      db.prepare('UPDATE meta SET outline_approved_at = ?, updated_at = ? WHERE id = 1').run(at, at)
      return { workId, outline: { writtenAt: meta.outline_written_at, approvedAt: at } }
    })
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Lifecycle: rename, delete, restore
// ---------------------------------------------------------------------------

/**
 * Rename a work (title and/or identity). An identity change moves the file; a
 * catalog failure restores both the meta row and the file location.
 * @param {string} root - workspace directory.
 * @param {{work: string, title?: string, workId?: string}} input - rename input.
 * @returns {{workId: string, title: string}} new identity.
 */
export function renameWork(root, input) {
  const oldId = String(input.work)
  const catalog = openCatalog(root)
  try {
    const row = activeWork(catalog, oldId)
    const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : row.title
    const nextId = typeof input.workId === 'string' && input.workId.trim() !== '' ? workIdOf(input.workId) : oldId
    const at = now()
    if (nextId !== oldId) {
      if (catalogRow(catalog, nextId) !== undefined || existsSync(workFile(root, nextId))) {
        throw new StoryError('work-exists', `作品已存在：${nextId}`)
      }
      const from = workFile(root, oldId)
      if (!existsSync(from)) throw new StoryError('work-not-found', `没有作品：${oldId}`)
      // The database must be self-contained before its file moves.
      const before = openWork(root, oldId)
      let previousMeta
      try {
        previousMeta = metaOf(before)
        checkpoint(before)
      } finally {
        before.close()
      }
      // A stale sidecar at the target would block the rename on Windows.
      removeDatabaseFiles(workFile(root, nextId))
      moveDatabaseFiles(from, workFile(root, nextId))
      const moved = openWork(root, nextId)
      try {
        transaction(moved, () => moved.prepare('UPDATE meta SET work_id = ?, title = ?, updated_at = ? WHERE id = 1')
          .run(nextId, title, at))
      } catch (error) {
        moved.close()
        moveDatabaseFiles(workFile(root, nextId), from)
        throw error
      }
      moved.close()
      try {
        transaction(catalog, () => {
          catalog.prepare('UPDATE works SET work_id = ?, title = ?, updated_at = ? WHERE work_id = ?')
            .run(nextId, title, at, oldId)
          catalog.prepare('UPDATE session_current SET work_id = ? WHERE work_id = ?').run(nextId, oldId)
          catalog.prepare('UPDATE proposals SET used_work_id = ? WHERE used_work_id = ?').run(nextId, oldId)
        })
      } catch (error) {
        const back = openWork(root, nextId)
        try {
          transaction(back, () => back.prepare('UPDATE meta SET work_id = ?, title = ?, updated_at = ? WHERE id = 1')
            .run(oldId, previousMeta.title, previousMeta.updated_at))
        } finally {
          back.close()
        }
        moveDatabaseFiles(workFile(root, nextId), from)
        throw error
      }
      return { workId: nextId, title }
    }
    const db = openWork(root, oldId)
    let previousMeta
    try {
      previousMeta = metaOf(db)
      transaction(db, () => db.prepare('UPDATE meta SET title = ?, updated_at = ? WHERE id = 1').run(title, at))
    } catch (error) {
      db.close()
      throw error
    }
    db.close()
    try {
      transaction(catalog, () => catalog.prepare('UPDATE works SET title = ?, updated_at = ? WHERE work_id = ?')
        .run(title, at, oldId))
    } catch (error) {
      const back = openWork(root, oldId)
      try {
        transaction(back, () => back.prepare('UPDATE meta SET title = ?, updated_at = ? WHERE id = 1')
          .run(previousMeta.title, previousMeta.updated_at))
      } finally {
        back.close()
      }
      throw error
    }
    return { workId: oldId, title }
  } finally {
    catalog.close()
  }
}

/**
 * Move a work into `.storycraft/trash/`, keeping it restorable.
 * @param {string} root - workspace directory.
 * @param {{work: string}} input - delete input.
 * @returns {{workId: string, path: string}} trashed location.
 */
export function deleteWork(root, input) {
  const workId = String(input.work)
  const catalog = openCatalog(root)
  try {
    activeWork(catalog, workId)
    const from = workFile(root, workId)
    if (!existsSync(from)) throw new StoryError('work-not-found', `没有作品：${workId}`)
    const db = openWork(root, workId)
    try {
      checkpoint(db)
    } finally {
      db.close()
    }
    mkdirSync(trashDir(root), { recursive: true })
    const target = trashFile(root, workId)
    if (existsSync(target)) {
      // A trash file without a catalog row belongs to manual recovery; never
      // erase it to make room for this deletion.
      let aside = join(trashDir(root), `${workId}-${Date.now()}.db`)
      while (existsSync(aside)) aside = join(trashDir(root), `${workId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.db`)
      moveDatabaseFiles(target, aside)
    } else {
      removeDatabaseFiles(target)
    }
    moveDatabaseFiles(from, target)
    try {
      transaction(catalog, () => catalog.prepare('UPDATE works SET trashed_at = ?, missing_at = NULL WHERE work_id = ?')
        .run(now(), workId))
    } catch (error) {
      moveDatabaseFiles(trashFile(root, workId), from)
      throw error
    }
    return { workId, path: `.storycraft/trash/${workId}.db` }
  } finally {
    catalog.close()
  }
}

/**
 * Restore the newest trashed copy of one work.
 * @param {string} root - workspace directory.
 * @param {{name: string}} input - work identity at trash time.
 * @returns {{workId: string}} restored identity.
 */
export function restoreWork(root, input) {
  const name = String(input.name ?? '').trim()
  if (name === '') throw new StoryError('invalid-work-id', '要恢复的作品名不能为空')
  const catalog = openCatalog(root)
  try {
    const row = catalogRow(catalog, name)
    if (row === undefined || row.trashed_at === null) throw new StoryError('work-not-found', `回收站里没有作品 ${name}`)
    const source = trashFile(root, name)
    if (!existsSync(source)) throw new StoryError('work-not-found', `回收站里没有作品 ${name}`)
    const target = workFile(root, name)
    if (existsSync(target)) throw new StoryError('work-exists', `已经有作品 ${name}`)
    removeDatabaseFiles(target)
    moveDatabaseFiles(source, target)
    try {
      transaction(catalog, () => catalog.prepare('UPDATE works SET trashed_at = NULL, missing_at = NULL, updated_at = ? WHERE work_id = ?')
        .run(now(), name))
    } catch (error) {
      moveDatabaseFiles(target, source)
      throw error
    }
    return { workId: name }
  } finally {
    catalog.close()
  }
}

// ---------------------------------------------------------------------------
// Chapter plans and bodies
// ---------------------------------------------------------------------------

/**
 * Write one chapter plan. A fresh plan is unapproved until the author confirms it.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, perspective: string, goal: string, obstacle: string, cost: string, turn: string}} input - plan fields.
 * @returns {object} result with a virtual artifact path.
 */
export function writePlan(root, input) {
  const number = chapterNumber(input.chapter)
  const fields = [input.perspective, input.goal, input.obstacle, input.cost, input.turn]
  if (fields.some(value => typeof value !== 'string' || value.trim() === '')) {
    throw new StoryError('plan-incomplete', '章纲需要视角、目标、阻力、代价、结尾变化')
  }
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = ensureChapter(db, number)
      if (stageOf(entry) === 'settled') {
        throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改章纲前先带 reopen 重写正文回退`)
      }
      const text = [`# 第 ${number} 章 章纲`, '',
        `- 视角：${input.perspective.trim()}`, `- 目标：${input.goal.trim()}`,
        `- 阻力：${input.obstacle.trim()}`, `- 代价：${input.cost.trim()}`,
        `- 结尾变化：${input.turn.trim()}`, ''].join('\n')
      const at = now()
      db.prepare(`INSERT INTO chapter_plans (number, text, written_at) VALUES (?, ?, ?)
        ON CONFLICT(number) DO UPDATE SET text = excluded.text, written_at = excluded.written_at`).run(number, text, at)
      db.prepare('UPDATE chapters SET plan_approved_at = NULL, updated_at = ? WHERE number = ?').run(at, number)
      touchMeta(db, at)
      return {
        workId,
        chapter: number,
        planApproved: false,
        artifact: { path: virtualPath(workId, `outline/${chapterStem(number)}.plan.md`) },
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Record the author's confirmation of one chapter plan (host-only).
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string}} input - target chapter.
 * @returns {{workId: string, entry: object}} the updated chapter entry.
 */
export function approveChapterPlan(root, input) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      const plan = db.prepare('SELECT 1 FROM chapter_plans WHERE number = ?').get(number)
      if (entry === undefined || plan === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
      const at = now()
      db.prepare('UPDATE chapters SET plan_approved_at = ?, updated_at = ? WHERE number = ?').run(at, at, number)
      touchMeta(db, at)
      return { workId, entry: { number, planApprovedAt: at } }
    })
  } finally {
    db.close()
  }
}

/**
 * Write a chapter body: first version, or a new revision when asked to rewrite.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, title?: string, body: string, rewrite?: boolean, reopen?: boolean, requirePlanApproval?: boolean}} input - body input.
 * @returns {object} result with a virtual artifact path.
 */
export function writeChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const body = String(input.body ?? '')
  if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const meta = metaOf(db)
      const entry = chapterRow(db, number)
      const plan = db.prepare('SELECT 1 FROM chapter_plans WHERE number = ?').get(number)
      if (entry === undefined || plan === undefined) {
        throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再写正文`)
      }
      if (input.requirePlanApproval === true && meta.plan_approval === 'required'
        && entry.current_revision === 0 && entry.plan_approved_at === null) {
        throw new StoryError('plan-not-approved', `第 ${number} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」后再写正文`)
      }
      const settled = stageOf(entry) === 'settled'
      if (settled && input.reopen !== true) {
        throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改正文请传 reopen: true`)
      }
      if (entry.current_revision > 0 && input.rewrite !== true && !(settled && input.reopen === true)) {
        throw new StoryError('chapter-exists', `第 ${number} 章已有正文；改稿请传 rewrite: true 生成新版本`)
      }
      const revision = entry.current_revision + 1
      const words = countWords(body)
      const at = now()
      db.prepare('INSERT INTO chapter_versions (number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(number, revision, body, words, at)
      db.prepare(`UPDATE chapters SET title = ?, status = 'written', stage = 'written',
        current_revision = ?, words = ?, plan_approved_at = CASE WHEN ? = 1 THEN NULL ELSE plan_approved_at END,
        updated_at = ? WHERE number = ?`)
        .run(String(input.title ?? entry.title), revision, words, revision === 1 ? 1 : 0, at, number)
      dropSearchDoc(db, `chapter:${number}:r${revision - 1}`)
      syncSearchDoc(db, `chapter:${number}:r${revision}`, 'chapter', `chapters/${chapterStem(number)}`, number, body)
      if (settled) {
        const seq = (db.prepare('SELECT max(seq) AS n FROM events').get()?.n ?? 0) + 1
        db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
          .run(seq, at, number, 'reopen', JSON.stringify({ kind: 'reopen' }))
      }
      touchMeta(db, at)
      return {
        workId,
        chapter: number,
        revision,
        words,
        reopened: settled && input.reopen === true,
        artifact: { path: virtualPath(workId, `chapters/${revision === 1 ? `${chapterStem(number)}.md` : `${chapterStem(number)}.r${revision}.md`}`), revision },
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Read one chapter body, its plan or its summary.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, view?: 'body'|'plan'|'summary', revision?: number}} input - read input.
 * @returns {{path: string, content: string, revision: number}} chapter text.
 */
export function readChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const manifest = readManifest(root, workId)
  const db = openWork(root, manifest.workId)
  try {
    const entry = chapterRow(db, number)
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    if (input.view === 'summary') {
      const row = db.prepare('SELECT text FROM summaries WHERE number = ?').get(number)
      if (row === undefined) throw new StoryError('summary-not-found', `第 ${number} 章还没有摘要`)
      return { path: virtualPath(workId, `summaries/${chapterStem(number)}.md`), content: row.text, revision: 0 }
    }
    if (input.view === 'plan') {
      const row = db.prepare('SELECT text FROM chapter_plans WHERE number = ?').get(number)
      if (row === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
      return { path: virtualPath(workId, `outline/${chapterStem(number)}.plan.md`), content: row.text, revision: 0 }
    }
    const revision = input.revision === undefined || input.revision === 0 ? entry.current_revision : Number(input.revision)
    if (revision <= 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文`)
    const row = db.prepare('SELECT body FROM chapter_versions WHERE number = ? AND revision = ?').get(number, revision)
    if (row === undefined) throw new StoryError('body-not-found', `第 ${number} 章没有版本 ${revision}`)
    return {
      path: virtualPath(workId, `chapters/${revision === 1 ? `${chapterStem(number)}.md` : `${chapterStem(number)}.r${revision}.md`}`),
      content: row.body,
      revision,
    }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Reviews and revision
// ---------------------------------------------------------------------------

/**
 * Persist one review round.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, problems: Array<{location: string, problem: string, suggestion: string}>}} input - findings.
 * @returns {object} result with a virtual artifact path.
 */
export function writeReview(root, input) {
  const number = chapterNumber(input.chapter)
  const problems = Array.isArray(input.problems) ? input.problems : []
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || entry.current_revision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能审稿`)
      if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改审稿要先带 reopen`)
      const round = (db.prepare('SELECT max(round) AS n FROM reviews WHERE number = ?').get(number)?.n ?? 0) + 1
      const lines = [`# 第 ${number} 章 审稿（第 ${round} 轮）`, '', `- 正文版本：${entry.current_revision}`, '']
      if (problems.length === 0) lines.push('- 清稿：无问题')
      const recorded = problems.map((problem, index) => {
        const id = `Q${index + 1}`
        const location = String(problem?.location ?? '').trim() || '未标注'
        const text = String(problem?.problem ?? '').trim()
        const suggestion = String(problem?.suggestion ?? '').trim() || '未给出建议'
        if (text === '') throw new StoryError('empty-problem', `${id} 缺少问题描述`)
        lines.push(`- [ ] ${id} :: ${location} :: ${text} :: ${suggestion}`)
        return { id, location, problem: text, suggestion, done: false }
      })
      lines.push('')
      const at = now()
      db.prepare('INSERT INTO reviews (number, round, text, revision, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(number, round, lines.join('\n'), entry.current_revision, at)
      db.prepare("UPDATE chapters SET status = 'reviewed', stage = 'reviewed', updated_at = ? WHERE number = ?").run(at, number)
      touchMeta(db, at)
      return {
        workId,
        chapter: number,
        round,
        problems: recorded,
        artifact: { path: virtualPath(workId, `reviews/${chapterStem(number)}.r${round}.md`) },
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Latest review of one chapter, accepting a work id, a manifest or a chapter entry.
 * @param {string} root - workspace directory.
 * @param {string|object} work - work id or manifest.
 * @param {number|string|object} chapter - chapter number or entry.
 * @returns {{round: number, text: string, revision?: number, path: string, items: object[]}|undefined} review.
 */
export function latestReview(root, work, chapter) {
  const workId = typeof work === 'string' ? work : work?.workId
  const number = chapterNumber(typeof chapter === 'object' && chapter !== null ? chapter.number : chapter)
  const db = openWork(root, workId)
  try {
    const row = latestReviewRow(db, number)
    if (row === undefined) return undefined
    return {
      round: row.round,
      text: row.text,
      revision: row.revision,
      path: virtualPath(workId, `reviews/${chapterStem(number)}.r${row.round}.md`),
      items: parseReview(row.text),
    }
  } finally {
    db.close()
  }
}

/**
 * Read the latest review of a chapter with its full items and round count.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {{path: string, round: number, items: object[], rounds: number}} review payload.
 */
export function readReview(root, work, chapter) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    if (chapterRow(db, number) === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    const row = latestReviewRow(db, number)
    const rounds = db.prepare('SELECT count(*) AS n FROM reviews WHERE number = ?').get(number).n
    if (row === undefined) return { path: '', round: 0, revision: 0, items: [], rounds }
    return {
      path: virtualPath(work, `reviews/${chapterStem(number)}.r${row.round}.md`),
      round: row.round,
      revision: row.revision,
      rounds,
      items: String(row.text).split(/\r?\n/).flatMap((line) => {
        const match = /^- \[( |x)\] (Q\d+) :: (.*?) :: (.*?) :: (.*)$/u.exec(line)
        return match === null
          ? []
          : [{ id: match[2], done: match[1] === 'x', location: match[3], problem: match[4], suggestion: match[5] }]
      }),
    }
  } finally {
    db.close()
  }
}

/**
 * Revise a chapter from its latest review.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, body: string, problemIds?: string[], mode?: string}} input - revision input.
 * @returns {object} result with a virtual artifact path.
 */
export function reviseChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const body = String(input.body ?? '')
  if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
  const mode = input.mode ?? 'patch'
  if (!['patch', 'polish', 'rewrite', 'deslop'].includes(mode)) {
    throw new StoryError('revise-mode-violation', `未知修订模式：${mode}`)
  }
  const problemIds = Array.isArray(input.problemIds) ? input.problemIds.map(String) : []
  if (mode === 'patch' && problemIds.length === 0) {
    throw new StoryError('missing-problems', 'patch 模式要指定至少一条问题')
  }
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || entry.current_revision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文`)
      if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改正文请传 reopen: true`)
      const review = latestReviewRow(db, number)
      if (review === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿：先 story_review`)
      // A patch answers the exact revision it read; broader modes may land on
      // the revision the review already saw.
      if (!reviewCovers(review, entry, mode !== 'patch')) {
        throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
      }
      const open = parseReview(review.text).filter(item => !item.done).map(item => item.id)
      const missing = problemIds.filter(id => !open.includes(id))
      if (missing.length > 0) throw new StoryError('problem-not-found', `问题不存在或已处理：${missing.join('、')}`)
      const current = currentVersion(db, entry)
      if (current.body === body) throw new StoryError('unchanged-body', '修订后的正文与当前版本相同')
      assertRevisionMode({ mode, chapter: number, oldBody: current.body, body })
      let text = review.text
      for (const id of problemIds) text = text.replace(new RegExp(`^- \\[ \\] ${id} ::`, 'mu'), `- [x] ${id} ::`)
      db.prepare('UPDATE reviews SET text = ? WHERE number = ? AND round = ?').run(text, number, review.round)
      const revision = entry.current_revision + 1
      const words = countWords(body)
      const at = now()
      db.prepare('INSERT INTO chapter_versions (number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(number, revision, body, words, at)
      db.prepare("UPDATE chapters SET status = 'revised', stage = 'revised', current_revision = ?, words = ?, last_revise_mode = ?, updated_at = ? WHERE number = ?")
        .run(revision, words, mode, at, number)
      dropSearchDoc(db, `chapter:${number}:r${revision - 1}`)
      syncSearchDoc(db, `chapter:${number}:r${revision}`, 'chapter', `chapters/${chapterStem(number)}`, number, body)
      touchMeta(db, at)
      return {
        workId,
        chapter: number,
        revision,
        words,
        problems: problemIds,
        resolved: problemIds,
        entry: { number, currentRevision: revision, words, stage: 'revised', lastReviseMode: mode },
        artifact: {
          path: virtualPath(workId, `chapters/${chapterStem(number)}.r${revision}.md`),
          revision,
        },
      }
    })
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Summaries, events and volumes
// ---------------------------------------------------------------------------

/**
 * Write a chapter summary. The single write owner for manual and delegated
 * summaries; {@link SUMMARY_MAX_CHARS} caps content and the receipt reports the
 * pre-truncation code-point count.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, text: string, ifAbsent?: boolean}} input - summary input.
 * @returns {{workId: string, chapter: number, chars: number, truncated: boolean, summaryRevision: number}} receipt.
 */
export function writeSummary(root, input) {
  const number = chapterNumber(input.chapter)
  const { text } = trimSummary(input.text)
  if (text === '') throw new StoryError('empty-summary', '摘要不能为空')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || entry.current_revision === 0) {
        throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能写摘要`)
      }
      if (input.ifAbsent === true) {
        const existing = db.prepare('SELECT text, revision FROM summaries WHERE number = ?').get(number)
        if (existing !== undefined
          && String(existing.text).trim() !== ''
          && existing.revision === entry.current_revision) {
          throw new StoryError('summary-exists', `第 ${number} 章当前版本已有摘要：作者的主动重写请走手动 story_summarize`)
        }
      }
      const points = [...text]
      const truncated = points.length > SUMMARY_MAX_CHARS
      const content = `${truncated ? points.slice(0, SUMMARY_MAX_CHARS).join('') : text}\n`
      const at = now()
      db.prepare(`INSERT INTO summaries (number, text, revision, written_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(number) DO UPDATE SET text = excluded.text, revision = excluded.revision, written_at = excluded.written_at`)
        .run(number, content, entry.current_revision, at)
      syncSearchDoc(db, `summary:${number}`, 'summary', `summaries/${chapterStem(number)}`, number, content)
      touchMeta(db, at)
      return { workId, chapter: number, chars: points.length, truncated, summaryRevision: entry.current_revision }
    })
  } finally {
    db.close()
  }
}

/**
 * Read one chapter summary.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {string|undefined} summary text.
 */
export function readSummary(root, work, chapter) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT text FROM summaries WHERE number = ?').get(number)?.text
  } finally {
    db.close()
  }
}

/**
 * Read one chapter's summary state on its own connection.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {{state: 'current'|'stale'|'missing', text: string|undefined, revision: number|null, currentRevision: number}} state.
 */
export function readSummaryState(root, work, chapter) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    return summaryStateOf(db, number)
  } finally {
    db.close()
  }
}

/** Summary states for every chapter of one work, ascending. */
export function listSummaryStates(root, work) {
  const db = openWork(root, work)
  try {
    return [...summaryStateMap(db)].map(([number, state]) => ({ number, ...state }))
  } finally {
    db.close()
  }
}

/** Every summary of one work, ascending. */
export function listSummaries(root, work) {
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT number, text FROM summaries ORDER BY number').all()
  } finally {
    db.close()
  }
}

/**
 * Append state events and return the folded counts.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, entities?: Array<{name: string, facts: string|string[]}>, hooks?: Array<{text: string, state: 'opened'|'used'|'resolved'}>}} input - state input.
 * @returns {object} result with counts and a virtual artifact path.
 */
export function foldState(root, input) {
  const number = chapterNumber(input.chapter)
  const entities = Array.isArray(input.entities) ? input.entities : []
  const hooks = Array.isArray(input.hooks) ? input.hooks : []
  if (entities.length === 0 && hooks.length === 0) throw new StoryError('empty-state', '定稿归档至少要给出一条人物事实或伏笔变化')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
      const foldedBefore = foldedOf(db)
      const openHooks = new Set(foldedBefore.hooks.filter(hook => hook.state !== 'resolved').map(hook => hook.text))
      const written = []
      for (const [index, entity] of entities.entries()) {
        const name = String(entity?.name ?? '').trim()
        const rawFacts = typeof entity?.facts === 'string' ? [entity.facts] : entity?.facts
        const facts = Array.isArray(rawFacts) ? rawFacts.map(fact => String(fact).trim()).filter(Boolean) : []
        if (name === '' || facts.length === 0) {
          throw new StoryError('invalid-entity',
            `第 ${index + 1} 条人物${name === '' ? '' : `（${name}）`}的 facts 必须是非空字符串或字符串数组`)
        }
        written.push({ kind: 'entity', name, facts })
      }
      for (const hook of hooks) {
        const text = String(hook?.text ?? '').trim()
        const state = String(hook?.state ?? '')
        if (text === '') throw new StoryError('invalid-hook', '伏笔需要非空描述')
        if (!['opened', 'used', 'resolved'].includes(state)) {
          throw new StoryError('invalid-hook-state', `伏笔状态只能是 opened/used/resolved，收到：${state}`)
        }
        if (state === 'used' && !openHooks.has(text)) throw new StoryError('hook-not-open', `没有可标记为已用的伏笔：${text}`)
        openHooks.add(text)
        written.push({ kind: 'hook', text, state })
      }
      const review = latestReviewRow(db, number)
      if (review === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿清单：先审稿与修订，再定稿`)
      const covers = reviewCovers(review, entry, true)
      const open = parseReview(review.text).filter(item => !item.done)
      if (open.length > 0) {
        throw new StoryError('review-required',
          `第 ${number} 章还有 ${open.length} 条未处理审稿：${open.map(item => item.id).join('、')}；先修订再定稿`)
      }
      if (!covers) throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
      if (isCleanReview(review) && review.revision !== entry.current_revision) {
        throw new StoryError('review-required', `第 ${number} 章的清稿审稿针对旧版本 r${review.revision}：先重新审稿`)
      }
      if (stageOf(entry) !== 'revised' && !isCleanReview(review)) {
        throw new StoryError('review-required',
          `第 ${number} 章还没走完修订（当前阶段：${stageOf(entry)}）：先 story_revise 提交改动，再定稿`)
      }
      const summaryState = summaryStateOf(db, number)
      if (summaryState.state === 'missing') {
        throw new StoryError('summary-required', `第 ${number} 章还没有摘要：先写摘要，再定稿`)
      }
      if (summaryState.state === 'stale') {
        throw new StoryError('summary-stale',
          `第 ${number} 章摘要针对旧版本 r${summaryState.revision ?? '?'}：先重写摘要，再定稿`)
      }
      let seq = (db.prepare('SELECT max(seq) AS n FROM events').get()?.n ?? 0) + 1
      const at = now()
      for (const event of written) {
        db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
          .run(seq, at, number, event.kind, JSON.stringify(event))
        syncSearchDoc(db, `event:${seq}`, event.kind, 'state/events', number, JSON.stringify(event))
        seq += 1
      }
      db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
        .run(seq, at, number, 'settle', JSON.stringify({ kind: 'settle' }))
      db.prepare("UPDATE chapters SET stage = 'settled', status = 'settled', updated_at = ? WHERE number = ?").run(at, number)
      touchMeta(db, at)
      const folded = foldedOf(db)
      return {
        workId,
        chapter: number,
        appended: written.length,
        seq,
        counts: {
          entities: entities.length,
          opened: folded.hooks.filter(hook => hook.state === 'opened').length,
          used: folded.hooks.filter(hook => hook.state === 'used').length,
          resolved: folded.hooks.filter(hook => hook.state === 'resolved').length,
          open: folded.hooks.filter(hook => hook.state !== 'resolved').length,
        },
        hooks: [...openHooks],
        artifact: { path: virtualPath(workId, 'state/events.jsonl') },
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Read the events of one work, optionally up to a chapter.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} [upToChapter] - highest chapter to include.
 * @returns {Array<object>} events.
 */
export function readEvents(root, work, upToChapter) {
  const db = openWork(root, work)
  try {
    const rows = upToChapter === undefined
      ? db.prepare('SELECT * FROM events ORDER BY seq').all()
      : db.prepare('SELECT * FROM events WHERE chapter <= ? ORDER BY seq').all(chapterNumber(upToChapter))
    return rows.map(row => ({ seq: row.seq, chapter: row.chapter, kind: row.kind, ...JSON.parse(row.payload) }))
  } finally {
    db.close()
  }
}

/**
 * Create or update one volume.
 * @param {string} root - workspace directory.
 * @param {{work: string, id?: string, title: string, from: number|string, to: number|string, summary?: string}} input - volume input.
 * @returns {{volumes: object[], volume: object}} the whole set and the written volume.
 */
export function writeVolume(root, input) {
  const id = String(input.id ?? '').trim()
  if (id === '') throw new StoryError('volume-invalid', '卷需要 id')
  const from = chapterNumber(input.from)
  const to = chapterNumber(input.to)
  if (to < from) throw new StoryError('volume-invalid', `卷 ${String(input.title ?? '')} 的起止章不合法：${from}–${to}`)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      for (const number of [from, to]) {
        if (chapterRow(db, number) === undefined) {
          throw new StoryError('chapter-not-found', `第 ${number} 章不在作品里，不能分卷`)
        }
      }
      const title = String(input.title ?? '').trim()
      if (title === '') throw new StoryError('volume-invalid', '卷需要一个标题')
      const others = db.prepare('SELECT * FROM volumes WHERE id != ?').all(id)
      for (const other of others) {
        if (from <= other.to_ch && other.from_ch <= to) {
          throw new StoryError('volume-overlap',
            `卷「${title}」(${from}–${to}) 与「${other.title}」(${other.from_ch}–${other.to_ch}) 重叠`)
        }
      }
      const summary = String(input.summary ?? '')
      db.prepare(`INSERT INTO volumes (id, title, from_ch, to_ch, summary) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, from_ch = excluded.from_ch, to_ch = excluded.to_ch, summary = excluded.summary`)
        .run(id, title, from, to, summary)
      syncSearchDoc(db, `volume:${id}`, 'volume', 'volumes', from, `${title} ${summary}`)
      touchMeta(db)
      return {
        volumes: db.prepare('SELECT * FROM volumes ORDER BY from_ch').all()
          .map(row => ({ id: row.id, title: row.title, from: row.from_ch, to: row.to_ch, summary: row.summary ?? '' })),
        volume: { id, title, from, to, summary },
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Read every volume of one work.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Array<object>} volumes, ascending by `from`.
 */
export function readVolumes(root, work) {
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT * FROM volumes ORDER BY from_ch').all()
      .map(row => ({ id: row.id, title: row.title, from: row.from_ch, to: row.to_ch, summary: row.summary ?? '' }))
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Truth files and chapter plans, read sides
// ---------------------------------------------------------------------------

/**
 * Write one bible entry; character cards also feed the search projection.
 * @param {string} root - workspace directory.
 * @param {{work: string, name: string, content: string}} input - entry input.
 * @returns {{workId: string, name: string, version: string}} receipt.
 */
export function writeBible(root, input) {
  const name = String(input.name ?? '').trim()
  if (name === '') throw new StoryError('bible-name-required', '真值需要 name')
  const content = String(input.content ?? '')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const version = contentVersion(content)
      const at = now()
      db.prepare(`INSERT INTO bible (name, content, version, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET content = excluded.content, version = excluded.version, updated_at = excluded.updated_at`)
        .run(name, content, version, at)
      if (name === 'characters') {
        dropSearchDoc(db, 'card:characters')
        syncSearchDoc(db, 'card:characters', 'card', 'bible/characters', 0, content)
      }
      touchMeta(db, at)
      return { workId, name, version }
    })
  } finally {
    db.close()
  }
}

/**
 * Read one bible entry.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} name - entry name.
 * @returns {{content: string, version: string, updated_at: string}|undefined} entry.
 */
export function readBibleEntry(root, work, name) {
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT content, version, updated_at FROM bible WHERE name = ?').get(String(name))
  } finally {
    db.close()
  }
}

/** Read every bible entry of one work. */
export function readBibleEntries(root, work) {
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT name, content, version, updated_at FROM bible ORDER BY name').all()
  } finally {
    db.close()
  }
}

/**
 * Read one work's truth entries as a name → content map.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Map<string, string>} truth content.
 */
export function readBibleMap(root, work) {
  return new Map(readBibleEntries(root, work).map(row => [row.name, row.content]))
}

/**
 * Read one work's events as the JSONL text the folding helpers consume.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {string} event log text.
 */
export function readEventsText(root, work) {
  const db = openWork(root, work)
  try {
    return eventsText(db)
  } finally {
    db.close()
  }
}

/**
 * Fold one work's event log into entities and hooks.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {{entities: object[], hooks: object[]}} folded state.
 */
export function readFoldedState(root, work) {
  return foldEvents(readEventsText(root, work))
}

/**
 * Read one chapter plan text.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {string|undefined} plan text.
 */
export function readPlan(root, work, chapter) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT text FROM chapter_plans WHERE number = ?').get(number)?.text
  } finally {
    db.close()
  }
}

/**
 * Every landed body of one work, every revision, ascending.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Array<{number: number, revision: number, body: string}>} versions.
 */
export function listBodies(root, work) {
  const db = openWork(root, work)
  try {
    return db.prepare('SELECT number, revision, body FROM chapter_versions ORDER BY number, revision').all()
  } finally {
    db.close()
  }
}

/**
 * Void one chapter's settlement without touching the body.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string}} input - reopen input.
 * @returns {{workId: string, chapter: number, stage: string, artifact: {path: string}}} receipt.
 */
export function reopenChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
      if (stageOf(entry) !== 'settled') {
        throw new StoryError('not-settled', `第 ${number} 章还没定稿（当前阶段：${stageOf(entry)}），不需要重开`)
      }
      const at = now()
      const seq = (db.prepare('SELECT max(seq) AS n FROM events').get()?.n ?? 0) + 1
      db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
        .run(seq, at, number, 'reopen', JSON.stringify({ kind: 'reopen' }))
      db.prepare("UPDATE chapters SET stage = 'written', status = 'written', updated_at = ? WHERE number = ?").run(at, number)
      touchMeta(db, at)
      return { workId, chapter: number, stage: 'written', artifact: { path: virtualPath(workId, 'state/events.jsonl') } }
    })
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Search projection
// ---------------------------------------------------------------------------

/**
 * Write one managed material copy, reusing an identical existing file.
 * @param {string} root - workspace directory.
 * @param {object} prepared - result of `prepareMaterial`.
 * @returns {{origin: string, path: string, created: boolean}} copy identity.
 */
export function writeManagedCopy(root, prepared, write = writeSync) {
  const dir = materialsDir(root)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    throw new StoryError('material-write-failed', `素材目录无法创建：${error.message}`)
  }
  for (let index = 0; index < 100; index += 1) {
    const name = index === 0
      ? `${prepared.hash.slice(0, 8)}-${prepared.fileName}`
      : `${prepared.hash.slice(0, 8)}-${index}-${prepared.fileName}`
    const path = join(dir, name)
    let fd
    let created = false
    try {
      fd = openSync(path, 'wx')
      created = true
      try {
        let offset = 0
        while (offset < prepared.buffer.length) {
          const written = write(fd, prepared.buffer, offset)
          if (!Number.isInteger(written) || written <= 0) {
            throw new StoryError('material-write-failed', '素材文件写入不完整')
          }
          offset += written
        }
      } finally {
        closeSync(fd)
        fd = undefined
      }
      return { origin: `materials/${name}`, path, created: true }
    } catch (error) {
      if (created) {
        if (fd !== undefined) {
          try {
            closeSync(fd)
          } catch {
            // Best effort while cleaning up a failed open/write.
          }
        }
        try {
          unlinkSync(path)
        } catch {
          // Leave an orphan only when even cleanup fails.
        }
      }
      if (error?.code !== 'EEXIST') {
        throw new StoryError('material-write-failed', `素材文件写入失败：${error.message}`)
      }
      try {
        if (readFileSync(path).equals(prepared.buffer)) return { origin: `materials/${name}`, path, created: false }
      } catch {
        // The file vanished between EEXIST and the comparison; try the next name.
      }
    }
  }
  throw new StoryError('material-write-failed', '素材文件名冲突过多')
}

/** Validate and normalize one material title. */
function materialTitle(value) {
  const title = String(value ?? '').trim()
  if ([...title].length > MATERIAL_TITLE_MAX) {
    throw new StoryError('material-title-too-long', `素材标题不能超过 ${MATERIAL_TITLE_MAX} 字`)
  }
  return title
}

/**
 * Import one uploaded material into a work. The managed copy is written inside
 * the write transaction after the hash probe; only a copy created by this call
 * is removed when the insert or index sync fails.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {{name: string, contentBase64: string, title?: string}} input - upload.
 * @returns {{material: object, duplicate: boolean}} metadata.
 */
export function importMaterial(root, work, input) {
  const prepared = prepareMaterial(input)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const existing = db.prepare('SELECT * FROM materials WHERE hash = ?').get(prepared.hash)
      if (existing !== undefined) return { material: materialMetadata(existing), duplicate: true }
      const copy = writeManagedCopy(root, prepared)
      try {
        const id = `mat-${prepared.hash.slice(0, 16)}`
        const at = now()
        try {
          db.prepare(`INSERT INTO materials (id, title, format, origin, bytes, hash, created_at, content, purpose)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, prepared.title, prepared.format, copy.origin, prepared.bytes, prepared.hash, at, prepared.content, prepared.purpose)
        } catch (error) {
          const raced = db.prepare('SELECT * FROM materials WHERE hash = ?').get(prepared.hash)
          if (raced !== undefined) {
            if (copy.created) {
              try {
                unlinkSync(copy.path)
              } catch {
                // The row is the authority; leave an orphan file for later cleanup.
              }
            }
            return { material: materialMetadata(raced), duplicate: true }
          }
          if (/PRIMARY KEY/iu.test(String(error?.message))) {
            throw new StoryError('material-id-conflict', '素材 id 冲突')
          }
          throw error
        }
        syncSearchDoc(db, `material:${id}`, 'material', `materials/${id}`, 0, prepared.content,
          materialIndexText(prepared.title, prepared.content))
        return {
          material: materialMetadata(db.prepare('SELECT * FROM materials WHERE id = ?').get(id)),
          duplicate: false,
        }
      } catch (error) {
        if (copy.created) {
          try {
            unlinkSync(copy.path)
          } catch {
            // Best effort: the row was rolled back anyway.
          }
        }
        throw error
      }
    })
  } finally {
    db.close()
  }
}

/**
 * List material metadata for one work.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} [purpose] - optional purpose filter.
 * @returns {object[]} metadata rows.
 */
export function listMaterials(root, work, purpose) {
  const clean = purpose === undefined ? undefined : normalizeMaterialPurpose(purpose)
  const db = openWork(root, work)
  try {
    const rows = clean === undefined
      ? db.prepare('SELECT * FROM materials ORDER BY created_at, id').all()
      : db.prepare('SELECT * FROM materials WHERE purpose = ? ORDER BY created_at, id').all(clean)
    return rows.map(materialMetadata)
  } finally {
    db.close()
  }
}

/**
 * Rename one material title and rebuild its search index; content, hash and origin stay unchanged.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} id - material id.
 * @param {string} title - new title.
 * @returns {object} updated metadata.
 */
export function renameMaterial(root, work, id, title) {
  const clean = materialTitle(title)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(String(id))
      if (row === undefined) throw new StoryError('material-not-found', `没有素材：${String(id)}`)
      db.prepare('UPDATE materials SET title = ? WHERE id = ?').run(clean, row.id)
      syncSearchDoc(db, `material:${row.id}`, 'material', `materials/${row.id}`, 0,
        row.content, materialIndexText(clean, row.content))
      return materialMetadata({ ...row, title: clean })
    })
  } finally {
    db.close()
  }
}

/**
 * Change one material purpose; content, hash, origin and index stay unchanged.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} id - material id.
 * @param {string} purpose - new purpose.
 * @returns {object} updated metadata.
 */
export function setMaterialPurpose(root, work, id, purpose) {
  const clean = normalizeMaterialPurpose(purpose)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(String(id))
      if (row === undefined) throw new StoryError('material-not-found', `没有素材：${String(id)}`)
      db.prepare('UPDATE materials SET purpose = ? WHERE id = ?').run(clean, row.id)
      return materialMetadata({ ...row, purpose: clean })
    })
  } finally {
    db.close()
  }
}

/**
 * Remove one material row and its search document; the managed file stays.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} id - material id.
 * @returns {{id: string}} removed id.
 */
export function deleteMaterial(root, work, id) {
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT id FROM materials WHERE id = ?').get(String(id))
      if (row === undefined) throw new StoryError('material-not-found', `没有素材：${String(id)}`)
      db.prepare('DELETE FROM materials WHERE id = ?').run(row.id)
      dropSearchDoc(db, `material:${row.id}`)
      return { id: row.id }
    })
  } finally {
    db.close()
  }
}

/**
 * Drop one search document and its FTS row.
 * @param {object} db - open work database.
 * @param {string} docId - document id.
 */
export function dropSearchDoc(db, docId) {
  const row = db.prepare('SELECT rowid, tokens FROM search_docs WHERE doc_id = ?').get(docId)
  if (row === undefined) return
  db.prepare("INSERT INTO search_fts(search_fts, rowid, tokens) VALUES('delete', ?, ?)").run(row.rowid, row.tokens)
  db.prepare('DELETE FROM search_docs WHERE doc_id = ?').run(docId)
}

/** Upsert one search document and its FTS row. */
function syncSearchDoc(db, docId, kind, source, chapter, body, indexText = body) {
  const tokens = searchTokens(indexText)
  dropSearchDoc(db, docId)
  db.prepare('INSERT INTO search_docs (doc_id, kind, source, chapter, body, tokens) VALUES (?, ?, ?, ?, ?, ?)')
    .run(docId, kind, source, chapter, body, tokens)
  const row = db.prepare('SELECT rowid FROM search_docs WHERE doc_id = ?').get(docId)
  db.prepare('INSERT INTO search_fts (rowid, tokens) VALUES (?, ?)').run(row.rowid, tokens)
}

/**
 * Search one work by FTS5.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} query - natural query.
 * @param {number} [limit] - result limit.
 * @returns {Array<object>} ranked documents.
 */
export function search(root, work, query, limit = 5) {
  const match = matchOf(query)
  if (match === '') return []
  const db = openWork(root, work)
  try {
    return queryDocs(db, { match, limit })
      .map(row => ({ id: row.id, kind: row.kind, source: row.source, chapter: row.chapter, body: row.body, score: row.score }))
  } finally {
    db.close()
  }
}

/**
 * Retrieve current summaries, unresolved hooks, closed volumes and material excerpts for context.
 * The SQL ranks first and limits second; post-filters use the same state rules
 * as the rest of the store, so stale summaries and reopened/resolved hooks do
 * not leak into a role context.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} query - query text.
 * @param {object} [options] - retrieval filter.
 * @param {number} [options.beforeChapter] - only material before this chapter.
 * @param {string[]} [options.kinds] - restrict kinds; unknown entries are ignored.
 * @returns {Array<{id: string, kind: string, source: string, sourceIds: string[], chapter: number, text: string, score: number}>} candidates: current summaries, unresolved hooks, volumes, and bounded material excerpts.
 */
export function searchMemory(root, work, query, options = {}) {
  const beforeChapter = Number.isInteger(options.beforeChapter) ? options.beforeChapter : undefined
  const requested = Array.isArray(options.kinds) ? options.kinds.filter(kind => MEMORY_KINDS.includes(kind)) : MEMORY_KINDS
  const kinds = [...new Set(requested)]
  if (kinds.length === 0) return []
  const tokens = queryTokens(query)
  const match = matchString(tokens)
  if (match === '') return []
  const db = openWork(root, work)
  try {
    const rows = queryDocs(db, {
      match,
      kinds,
      beforeChapter,
      limit: 200,
    })
    const materialRows = new Map()
    const materialIds = rows.filter(row => row.kind === 'material').map(row => row.id.slice('material:'.length))
    if (materialIds.length > 0) {
      const placeholders = materialIds.map(() => '?').join(', ')
      for (const row of db.prepare(`SELECT id, title, purpose FROM materials WHERE id IN (${placeholders})`).all(...materialIds)) {
        materialRows.set(`material:${row.id}`, row)
      }
    }
    const purposeFilter = Array.isArray(options.purposes)
      ? options.purposes.filter(purpose => MATERIAL_PURPOSES.includes(purpose))
      : undefined
    const reopened = new Map(db.prepare("SELECT chapter, max(seq) AS seq FROM events WHERE kind = 'reopen' GROUP BY chapter")
      .all().map(row => [row.chapter, row.seq]))
    const hookStates = new Map()
    for (const event of db.prepare("SELECT seq, chapter, payload FROM events WHERE kind = 'hook' ORDER BY seq").all()) {
      if (event.seq <= (reopened.get(event.chapter) ?? -1)) continue
      try {
        const payload = JSON.parse(event.payload)
        if (typeof payload?.text === 'string' && typeof payload?.state === 'string') {
          hookStates.set(payload.text, payload.state)
        }
      } catch {
        // A malformed historical event is ignored, not allowed to break context.
      }
    }
    const volumes = new Map(db.prepare('SELECT id, to_ch FROM volumes').all().map(row => [row.id, row.to_ch]))
    const candidates = []
    for (const row of rows) {
      const chapter = row.chapter
      if (beforeChapter !== undefined && (chapter === null || chapter >= beforeChapter)) continue
      if (row.kind === 'summary') {
        if (chapter === null || summaryStateOf(db, chapter).state !== 'current') continue
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter, text: row.body, score: -row.score,
        })
        continue
      }
      if (row.kind === 'hook') {
        const seq = Number(/^event:(\d+)$/u.exec(row.id)?.[1])
        if (!Number.isInteger(seq) || seq <= (reopened.get(chapter) ?? -1)) continue
        const event = db.prepare('SELECT chapter, payload FROM events WHERE seq = ?').get(seq)
        if (event === undefined) continue
        let payload
        try {
          payload = JSON.parse(event.payload)
        } catch {
          continue
        }
        if (typeof payload?.text !== 'string' || hookStates.get(payload.text) === 'resolved') continue
        candidates.push({
          id: row.id,
          kind: row.kind,
          source: row.source,
          sourceIds: ['state'],
          chapter,
          text: `${payload.text}（${payload.state ?? 'opened'}，第 ${chapter} 章）`,
          score: -row.score,
        })
        continue
      }
      if (row.kind === 'volume') {
        const id = row.id.startsWith('volume:') ? row.id.slice('volume:'.length) : undefined
        if (id === undefined || !volumes.has(id)) continue
        if (beforeChapter !== undefined && volumes.get(id) >= beforeChapter) continue
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter, text: row.body, score: -row.score,
        })
        continue
      }
      if (row.kind === 'material') {
        const material = materialRows.get(row.id)
        if (material === undefined) continue
        if (purposeFilter !== undefined && !purposeFilter.includes(material.purpose)) continue
        const titleExcerpt = [...material.title].slice(0, 60).join('')
        const excerpt = snippetFor(row.body, tokens, Math.max(80, 400 - [...titleExcerpt].length - 1))
        candidates.push({
          id: row.id,
          kind: row.kind,
          source: row.source,
          sourceIds: [row.id],
          chapter: 0,
          text: `${titleExcerpt}\n${excerpt}`.trim(),
          score: -row.score,
        })
      }
    }
    return candidates
  } finally {
    db.close()
  }
}

/** Document kinds exposed to role context retrieval. */
const MEMORY_KINDS = ['summary', 'hook', 'volume', 'material']

/** Query tokens; shared by search and context retrieval. */
function queryTokens(query) {
  return searchTokens(query).split(' ').filter(token => token !== '')
}

/** Quote and OR-join tokens for one FTS match. */
function matchString(tokens) {
  return tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ')
}

/** FTS match string for one query, or '' when the query has no tokens. */
function matchOf(query) {
  return matchString(queryTokens(query))
}

/** One FTS query with the shared projection, ordering and limit. */
function queryDocs(db, { match, kinds, beforeChapter, limit }) {
  const clauses = ['search_fts MATCH ?']
  const params = [match]
  if (Array.isArray(kinds) && kinds.length > 0) {
    clauses.push(`d.kind IN (${kinds.map(() => '?').join(', ')})`)
    params.push(...kinds)
  }
  if (Number.isInteger(beforeChapter)) {
    clauses.push('d.chapter < ?')
    params.push(beforeChapter)
  }
  params.push(limit)
  return db.prepare(`SELECT d.doc_id AS id, d.kind, d.source, d.chapter, d.body, bm25(search_fts) AS score
    FROM search_fts JOIN search_docs d ON d.rowid = search_fts.rowid
    WHERE ${clauses.join(' AND ')}
    ORDER BY score, d.chapter DESC, d.doc_id LIMIT ?`).all(...params)
}

// ---------------------------------------------------------------------------
// Export and backup
// ---------------------------------------------------------------------------

/** Export format version, independent of the work database schema version. */
const EXPORT_SCHEMA_VERSION = 6

/** Render the export manifest from the catalog row and the work database. */
function exportManifest(root, workId, catalogRowValue, db) {
  const meta = metaOf(db)
  const chapters = db.prepare('SELECT * FROM chapters ORDER BY number').all()
  const summaryStates = summaryStateMap(db)
  const materials = db.prepare('SELECT * FROM materials ORDER BY created_at, id').all()
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    title: catalogRowValue.title,
    form: catalogRowValue.form,
    tags: catalogRowValue.tags === null ? [] : JSON.parse(catalogRowValue.tags),
    wordRange: meta.word_min === null ? null : { min: meta.word_min, max: meta.word_max },
    planApproval: meta.plan_approval,
    outline: meta.outline_written_at === null ? null : {
      writtenAt: meta.outline_written_at,
      approvedAt: meta.outline_approved_at,
    },
    chapters: chapters.map(chapter => {
      const summary = summaryStateFrom(summaryStates, chapter.number)
      return {
        number: chapter.number,
        title: chapter.title,
        status: chapter.status,
        stage: chapter.stage,
        currentRevision: chapter.current_revision,
        words: chapter.words,
        planApprovedAt: chapter.plan_approved_at,
        summaryRevision: summary.revision,
        summaryStale: summary.state === 'stale',
      }
    }),
    materials: materials.map(row => ({
      id: row.id,
      title: row.title,
      format: row.format,
      purpose: row.purpose,
      bytes: row.bytes,
      hash: row.hash,
      origin: row.origin,
    })),
    book: { file: 'book.txt', format: 'txt' },
    epub: { file: 'book.epub', format: 'epub' },
  }
}

/** Collapse a title to one trimmed line. */
function oneLine(value) {
  return String(value ?? '').replace(/\r\n?|\n/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** One snapshot of current chapter revisions, shared by TXT and EPUB. */
function currentChapters(db) {
  return db.prepare('SELECT * FROM chapters WHERE current_revision > 0 ORDER BY number').all()
    .map(chapter => {
      const version = currentVersion(db, chapter)
      if (version === undefined) {
        throw new StoryError('export-failed', `第 ${chapter.number} 章缺少当前正文版本，无法导出`)
      }
      return { number: chapter.number, title: chapter.title, body: version.body }
    })
}

/** Render the single-file readable book from a chapter snapshot. */
function bookText(title, chapters) {
  const parts = [oneLine(title) || '未命名']
  for (const chapter of chapters) {
    const heading = oneLine(chapter.title)
    parts.push(`第 ${chapter.number} 章${heading === '' ? '' : ` ${heading}`}`)
    parts.push(String(chapter.body ?? '').replace(/\r\n?|\n/gu, '\n').replace(/\n+$/u, ''))
  }
  return `${parts.join('\n\n')}\n`
}

/** `ch-0007` / `ch-0007.r2`. */
function versionStem(number, revision) {
  return revision === 1 ? chapterStem(number) : `${chapterStem(number)}.r${revision}`
}

/**
 * Export one work as a directory tree. `manifest.json` is the export copy; the
 * catalog stays the title/form/tags authority.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} [destination] - target directory.
 * @returns {{directory: string, files: number}} export summary.
 */
export function exportWork(root, work, destination) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    try {
      const target = destination ?? join(exportsDir(root), row.work_id)
      if (destination === undefined && existsSync(target)) rmSync(target, { recursive: true, force: true })
      const files = []
      const put = (relative, data) => {
        const file = join(target, relative)
        mkdirSync(join(file, '..'), { recursive: true })
        if (typeof data === 'string') writeFileSync(file, data, 'utf8')
        else writeFileSync(file, data)
        files.push(relative)
      }
      const chapters = currentChapters(db)
      put('manifest.json', `${JSON.stringify(exportManifest(root, row.work_id, row, db), null, 2)}\n`)
      put('book.txt', bookText(row.title, chapters))
      put('book.epub', buildEpub({
        title: row.title,
        identifier: `urn:storycraft:${Buffer.from(row.work_id, 'utf8').toString('hex')}`,
        chapters,
      }))
      for (const version of db.prepare('SELECT * FROM chapter_versions ORDER BY number, revision').all()) {
        put(join('chapters', `${versionStem(version.number, version.revision)}.md`),
          version.body.endsWith('\n') ? version.body : `${version.body}\n`)
      }
      for (const plan of db.prepare('SELECT * FROM chapter_plans ORDER BY number').all()) {
        put(join('outline', `${chapterStem(plan.number)}.plan.md`), plan.text)
      }
      for (const summary of db.prepare('SELECT * FROM summaries ORDER BY number').all()) {
        put(join('summaries', `${chapterStem(summary.number)}.md`), summary.text)
      }
      for (const review of db.prepare('SELECT * FROM reviews ORDER BY number, round').all()) {
        put(join('reviews', `${chapterStem(review.number)}.r${review.round}.md`), review.text)
      }
      for (const entry of db.prepare('SELECT * FROM bible ORDER BY name').all()) {
        const name = entry.name === 'characters' ? 'characters.json' : `${entry.name}.md`
        put(join('bible', name), entry.content)
      }
      put('volumes.json', `${JSON.stringify(db.prepare('SELECT * FROM volumes ORDER BY from_ch').all(), null, 2)}\n`)
      put('state/events.jsonl', `${db.prepare('SELECT * FROM events ORDER BY seq').all()
        .map(event => JSON.stringify({ seq: event.seq, at: event.at, chapter: event.chapter, kind: event.kind, ...JSON.parse(event.payload) }))
        .join('\n')}\n`)
      for (const material of db.prepare('SELECT * FROM materials ORDER BY created_at, id').all()) {
        put(join('materials', `${material.id}.${material.format}`), material.content)
      }
      for (const proposal of catalog.prepare('SELECT * FROM proposals WHERE used_work_id = ? ORDER BY created_at').all(row.work_id)) {
        put(join('proposals', `${proposal.id}.json`), `${JSON.stringify({
          id: proposal.id,
          title: proposal.title,
          form: proposal.form,
          premise: proposal.premise,
          ...(proposal.characters === null ? {} : { characters: proposal.characters }),
          ...(proposal.conflict === null ? {} : { conflict: proposal.conflict }),
          ...(proposal.notes === null ? {} : { notes: proposal.notes }),
          createdAt: proposal.created_at,
          ...(proposal.used_at === null ? {} : { usedAt: proposal.used_at, workId: proposal.used_work_id }),
        }, null, 2)}\n`)
      }
      for (const relative of files) utimesSync(join(target, relative), EXPORT_MTIME, EXPORT_MTIME)
      return { directory: target, files: files.length }
    } finally {
      db.close()
    }
  } finally {
    catalog.close()
  }
}

/**
 * Export through a staging directory and swap it into place. The default
 * `exportWork` path stays untouched; this is the panel-only atomic route.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {object} [options] - test seam for rename/remove/export tree.
 * @returns {Promise<{directory: string, files: number}>} export result.
 */
export async function exportWorkAtomic(root, work, options = {}) {
  const rename = typeof options.rename === 'function' ? options.rename : renameSync
  const remove = typeof options.remove === 'function' ? options.remove : rmSync
  const write = typeof options.exportTree === 'function' ? options.exportTree : exportWork
  const key = `${root}\0${work}`
  const previous = exportLocks.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const tail = previous.then(() => gate)
  exportLocks.set(key, tail)
  await previous
  try {
    const directory = exportsDir(root)
    try {
      mkdirSync(directory, { recursive: true })
    } catch (error) {
      throw new StoryError('export-failed', `导出目录无法创建：${error instanceof Error ? error.message : String(error)}`)
    }
    const token = createHash('sha256').update(String(work)).digest('hex').slice(0, 12)
    const target = join(directory, String(work))
    const stamp = Date.now()
    const stage = join(directory, `.tmp-${token}-${stamp}-${randomUUID().slice(0, 8)}`)
    const backup = join(directory, `.bak-${token}-${stamp}-${randomUUID().slice(0, 8)}`)
    const cleanup = path => {
      try {
        remove(path, { recursive: true, force: true })
      } catch {
        // Cleanup is best effort; it must not mask the original error.
      }
    }
    const fail = (message, cause) => new StoryError('export-failed', `${message}${cause === undefined ? '' : `：${cause}`}`)

    // A previous swap may have crashed between target→backup and stage→target.
    if (!existsSync(target)) {
      let entries
      try {
        entries = readdirSync(directory)
      } catch (error) {
        throw fail('导出目录无法读取', error instanceof Error ? error.message : String(error))
      }
      const backups = entries.filter(name => name.startsWith(`.bak-${token}-`)).sort()
      const last = backups.at(-1)
      if (last !== undefined) {
        try {
          rename(join(directory, last), target)
        } catch (error) {
          throw fail('恢复上次导出备份失败', error instanceof Error ? error.message : String(error))
        }
      }
    }

    let result
    try {
      result = write(root, work, stage)
    } catch (error) {
      cleanup(stage)
      if (error instanceof StoryError) throw error
      throw fail('导出写入失败', error instanceof Error ? error.message : String(error))
    }

    let movedOld = false
    if (existsSync(target)) {
      try {
        rename(target, backup)
        movedOld = true
      } catch (error) {
        cleanup(stage)
        throw fail('导出替换前备份旧目录失败', error instanceof Error ? error.message : String(error))
      }
    }
    try {
      rename(stage, target)
    } catch (error) {
      cleanup(stage)
      if (movedOld) {
        try {
          rename(backup, target)
        } catch (restoreError) {
          throw new StoryError('export-rollback-failed',
            `导出替换失败且旧导出恢复失败，备份保留在 ${backup}：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`)
        }
      }
      throw fail('导出替换失败', error instanceof Error ? error.message : String(error))
    }
    if (movedOld) cleanup(backup)
    return { directory: target, files: result.files }
  } finally {
    release()
    if (exportLocks.get(key) === tail) exportLocks.delete(key)
  }
}

/**
 * Copy one work's database to a backup file with an integrity check.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} [destination] - backup file.
 * @returns {Promise<{file: string, integrity: string}>} backup result.
 */
export async function backupWork(root, work, destination) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    try {
      const file = destination ?? join(backupsDir(root), `${row.work_id}-${Date.now()}.db`)
      try {
        await backupTo(db, file)
      } catch (error) {
        if (error?.code === 'db-corrupt') throw error
        throw new StoryError('backup-failed', `备份失败：${error.message}`)
      }
      const copy = openDatabase(file, '备份文件无法读取', { readOnly: true })
      try {
        return { file, integrity: integrityCheck(copy) }
      } finally {
        copy.close()
      }
    } finally {
      db.close()
    }
  } finally {
    catalog.close()
  }
}

// ---------------------------------------------------------------------------
// Proposals and session pointers (catalog)
// ---------------------------------------------------------------------------

/**
 * Create an ideation proposal in the catalog.
 * @param {string} root - workspace directory.
 * @param {{title: string, form?: string, premise: string, characters?: string, conflict?: string, notes?: string}} input - proposal.
 * @returns {{proposal: object}} stored proposal.
 */
export function createProposal(root, input) {
  const catalog = openCatalog(root)
  try {
    return transaction(catalog, () => {
      const title = String(input.title ?? '').trim()
      if (title === '') throw new StoryError('proposal-invalid', '提案需要作品标题')
      const form = input.form === undefined ? 'longform' : String(input.form)
      if (!WORK_FORMS.includes(form)) throw new StoryError('proposal-invalid', `提案形态不合法：${form}`)
      const premise = String(input.premise ?? '').trim()
      if (premise === '') throw new StoryError('proposal-invalid', '提案需要一句话前提或核心冲突')
      const exists = catalog.prepare('SELECT 1 FROM works WHERE title = ? AND trashed_at IS NULL').get(title)
      if (exists !== undefined) throw new StoryError('work-exists', `作品已存在：${title}`)
      pruneProposalRows(catalog, PROPOSAL_TTL_MS)
      const id = `p-${randomUUID().slice(0, 8)}`
      const at = now()
      catalog.prepare(`INSERT INTO proposals (id, title, form, premise, characters, conflict, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, title, form, premise,
        input.characters ?? null, input.conflict ?? null, input.notes ?? null, at,
      )
      return { id, title, form, premise, createdAt: at }
    })
  } finally {
    catalog.close()
  }
}

/**
 * Read one proposal.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 * @returns {object} proposal.
 */
export function readProposal(root, id) {
  const catalog = openCatalog(root, { create: false })
  const row = catalog?.prepare('SELECT * FROM proposals WHERE id = ?').get(String(id))
  catalog?.close()
  if (row === undefined) throw new StoryError('proposal-not-found', `没有提案：${String(id)}`)
  return {
    id: row.id, title: row.title, form: row.form, premise: row.premise,
    ...(row.characters === null ? {} : { characters: row.characters }),
    ...(row.conflict === null ? {} : { conflict: row.conflict }),
    ...(row.notes === null ? {} : { notes: row.notes }),
    createdAt: row.created_at,
    ...(row.used_at === null ? {} : { usedAt: row.used_at, usedWorkId: row.used_work_id }),
  }
}

/**
 * Mark a proposal as used by a work.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 * @param {string} workId - the work it produced.
 * @returns {{id: string, workId: string}} receipt.
 */
export function markProposalUsed(root, id, workId) {
  const catalog = openCatalog(root)
  try {
    return transaction(catalog, () => {
      catalog.prepare('UPDATE proposals SET used_at = ?, used_work_id = ? WHERE id = ?').run(now(), String(workId), String(id))
      return { id, workId }
    })
  } finally {
    catalog.close()
  }
}

/**
 * List proposals, newest first.
 * @param {string} root - workspace directory.
 * @returns {Array<object>} proposals.
 */
export function listProposals(root) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return []
  try {
    return catalog.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all().map(row => ({
      id: row.id,
      title: row.title,
      form: row.form,
      premise: row.premise,
      ...(row.characters === null ? {} : { characters: row.characters }),
      ...(row.conflict === null ? {} : { conflict: row.conflict }),
      ...(row.notes === null ? {} : { notes: row.notes }),
      createdAt: row.created_at,
      ...(row.used_at === null ? {} : { usedAt: row.used_at, workId: row.used_work_id }),
    }))
  } finally {
    catalog.close()
  }
}

/**
 * Remove one proposal.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 */
export function deleteProposal(root, id) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return
  try {
    transaction(catalog, () => catalog.prepare('DELETE FROM proposals WHERE id = ?').run(String(id)))
  } finally {
    catalog.close()
  }
}

/**
 * Delete unused proposals older than a TTL (caller owns the transaction).
 * @param {object} catalog - open catalog.
 * @param {number} ttlMs - age threshold.
 * @returns {number} rows removed.
 */
function pruneProposalRows(catalog, ttlMs) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString()
  return catalog.prepare('DELETE FROM proposals WHERE used_at IS NULL AND created_at < ?').run(cutoff).changes
}

/**
 * Prune unused proposals older than the TTL.
 * @param {string} root - workspace directory.
 * @param {number} ttlMs - age threshold.
 * @returns {{removed: number}} removal count.
 */
export function pruneProposals(root, ttlMs = PROPOSAL_TTL_MS) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return { removed: 0 }
  try {
    return transaction(catalog, () => ({ removed: pruneProposalRows(catalog, ttlMs) }))
  } finally {
    catalog.close()
  }
}

/**
 * Persist one session's current work without touching other rows.
 * @param {string} root - workspace directory.
 * @param {string} sessionId - session identity.
 * @param {string} workId - work identity.
 * @returns {{sessionId: string, workId: string}} stored pointer.
 */
export function setSessionCurrent(root, sessionId, workId) {
  const catalog = openCatalog(root)
  try {
    transaction(catalog, () => {
      catalog.prepare(`INSERT INTO session_current (session_id, work_id, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET work_id = excluded.work_id, updated_at = excluded.updated_at`)
        .run(sessionId, workId, now())
    })
    return { sessionId, workId }
  } finally {
    catalog.close()
  }
}

/**
 * Clear one session's current work without touching other rows.
 * @param {string} root - workspace directory.
 * @param {string} sessionId - session identity.
 * @returns {{removed: boolean}} whether a row was removed.
 */
export function clearSessionCurrent(root, sessionId) {
  const catalog = openCatalog(root)
  try {
    const result = transaction(catalog, () => catalog.prepare('DELETE FROM session_current WHERE session_id = ?').run(sessionId))
    return { removed: Number(result.changes) > 0 }
  } finally {
    catalog.close()
  }
}

/**
 * Read the session→work map.
 * @param {string} root - workspace directory.
 * @returns {Record<string, string>} map, empty when the catalog is absent.
 */
export function readSessionCurrent(root) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return {}
  try {
    const out = {}
    for (const row of catalog.prepare('SELECT session_id, work_id FROM session_current').all()) {
      if (typeof row.work_id === 'string' && row.work_id !== '') out[row.session_id] = row.work_id
    }
    return out
  } finally {
    catalog.close()
  }
}
