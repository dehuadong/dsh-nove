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

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  backupTo, checkpoint, createWorkDatabase, exportsDir, integrityCheck, WORK_SCHEMA_VERSION,
  moveDatabaseFiles, openCatalog, openDatabase, openWork, removeDatabaseFiles, transaction,
  trashDir, trashFile, workFile, worksDir, backupsDir,
} from './db.js'
import {
  StoryError, WORK_FORMS, chapterNumber, chapterStem, countWords, foldEvents, formOf, now,
  parseReview, planApprovalPolicy, stageOf, unitOf, workIdOf,
} from './domain.js'
import { critique } from './critique.js'

/** Catalog schema version recorded on every work row. */
export { WORK_SCHEMA_VERSION as SCHEMA_VERSION } from './db.js'

/** How long an unused proposal is kept before the next proposal write prunes it. */
export const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Fixed mtime of export files, so directory copies stay reproducible. */
const EXPORT_MTIME = new Date('2000-01-01T00:00:00.000Z')

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Virtual path of one work, as actions and routes report it. */
export function virtualWorkPath(workId) {
  return `works/${workId}`
}

/** Virtual path of one artifact inside a work. */
function virtualPath(workId, relative) {
  return `works/${workId}/${String(relative).replaceAll('\\', '/')}`
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

/** The newest review row of one chapter. */
function latestReviewRow(db, number) {
  return db.prepare('SELECT * FROM reviews WHERE number = ? ORDER BY round DESC LIMIT 1').get(number)
}

/** The current body row of one chapter. */
function currentVersion(db, chapter) {
  return db.prepare('SELECT * FROM chapter_versions WHERE number = ? AND revision = ?')
    .get(chapter.number, chapter.current_revision)
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
              .run(name, content, randomUUID(), at)
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
 * @returns {{missing: string[], orphans: string[], trash: string[]}} reconciliation report.
 */
export function reconcileWorks(root) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return { missing: [], orphans: [], trash: [] }
  try {
    const rows = catalog.prepare('SELECT work_id, trashed_at, missing_at FROM works').all()
    const known = new Set(rows.map(row => row.work_id))
    const missing = []
    try {
      transaction(catalog, () => {
        for (const row of rows) {
          const file = row.trashed_at === null ? workFile(root, row.work_id) : trashFile(root, row.work_id)
          const present = existsSync(file)
          if (!present) {
            if (row.missing_at === null) {
              catalog.prepare('UPDATE works SET missing_at = ? WHERE work_id = ?').run(now(), row.work_id)
            }
            if (row.trashed_at === null) missing.push(row.work_id)
          } else if (row.missing_at !== null) {
            catalog.prepare('UPDATE works SET missing_at = NULL WHERE work_id = ?').run(row.work_id)
          }
        }
      })
    } catch {
      // Another writer holds the catalog; the next read reconciles again. The
      // listing itself must stay readable.
    }
    const orphans = []
    if (existsSync(worksDir(root))) {
      for (const name of readdirSync(worksDir(root))) {
        if (!name.endsWith('.db')) continue
        if (!known.has(name.slice(0, -3))) orphans.push(name)
      }
    }
    const trash = existsSync(trashDir(root))
      ? readdirSync(trashDir(root)).filter(name => name.endsWith('.db'))
      : []
    return { missing, orphans, trash }
  } finally {
    catalog.close()
  }
}

/**
 * List active works, newest activity first.
 * @param {string} root - workspace directory.
 * @returns {Array<object>} work summaries.
 */
export function listWorks(root) {
  reconcileWorks(root)
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return []
  try {
    const rows = catalog.prepare('SELECT * FROM works WHERE trashed_at IS NULL AND missing_at IS NULL').all()
    const works = []
    for (const row of rows) {
      let db
      try {
        db = openWork(root, row.work_id)
      } catch {
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
  reconcileWorks(root)
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
    const summaryRows = new Set(db.prepare('SELECT number FROM summaries').all().map(row => row.number))
    const chapters = manifest.chapters.map(chapter => {
      const review = latestReviewRow(db, chapter.number)
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
        hasSummary: summaryRows.has(chapter.number),
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
      title: manifest.title,
      chapters: manifest.chapters.map(chapter => ({
        number: chapter.number,
        status: chapter.status,
        stage: stageOf(chapter),
        revision: chapter.currentRevision,
        words: chapter.words,
      })),
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
    const summaryOf = number => db.prepare('SELECT text FROM summaries WHERE number = ?').get(number)?.text
    const chapters = manifest.chapters
    const last = chapters.length === 0 ? undefined : chapters[chapters.length - 1]
    const chapter = last === undefined ? 1 : last.number
    const outline = manifest.outline
    const step = (() => {
      if (last === undefined && outline?.approvedAt === undefined) {
        const reason = outline === undefined || outline.writtenAt === undefined
          ? '还没有全书计划：先写主线、卷划分与结局方向，等作者确认'
          : '全书计划等作者确认：确认后才能写第 1 章章纲'
        return { chapter, stage: 'planned', action: 'story_outline', reason, missing: ['outline'] }
      }
      if (last === undefined) {
        return { chapter, stage: 'planned', action: 'story_plan', reason: '还没有任何章节：先写第 1 章章纲', missing: ['outline'] }
      }
      const stage = stageOf(last)
      const hasBody = last.currentRevision > 0
      if (stage === 'settled') {
        const summary = summaryOf(last.number)
        if (summary === undefined || summary.trim() === '') {
          return {
            chapter: last.number, stage, action: 'story_summarize',
            reason: `第 ${last.number} 章已定稿但没有摘要：先补摘要，后面几章的写前上下文才用得上`, missing: ['summary'],
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
        return { chapter: next, stage: 'planned', action: 'story_plan', reason: `第 ${last.number} 章已定稿：写第 ${next} 章章纲`, missing: ['outline'] }
      }
      if (!hasPlan(last.number)) {
        if (outline?.approvedAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_outline',
            reason: '全书计划等作者确认：先在面板点「确认全书计划」，再写章纲', missing: ['outline'],
          }
        }
        return { chapter: last.number, stage, action: 'story_plan', reason: `第 ${last.number} 章缺章纲`, missing: ['outline'] }
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
      const candidate = latestReviewRow(db, last.number)
      const cover = candidate !== undefined && (
        candidate.revision === last.currentRevision || candidate.revision === last.currentRevision - 1)
      if (!cover) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      const open = parseReview(candidate.text).filter(item => !item.done)
      if (open.length > 0) {
        return {
          chapter: last.number, stage, action: 'story_revise',
          reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map(item => item.id),
        }
      }
      if (stage !== 'revised') {
        return { chapter: last.number, stage, action: 'story_revise', reason: `第 ${last.number} 章审稿条目已处理完，但还没提交修订`, missing: ['revision'] }
      }
      const summary = summaryOf(last.number)
      if (summary === undefined || summary.trim() === '') {
        return {
          chapter: last.number, stage, action: 'story_summarize',
          reason: `第 ${last.number} 章已修订：先写摘要，再定稿`, missing: ['summary'],
        }
      }
      return { chapter: last.number, stage, action: 'story_state', reason: `第 ${last.number} 章已修订，定稿`, missing: [] }
    })()
    return { workId: manifest.workId, ...step, form: formOf(manifest), unit: unitOf(formOf(manifest)) }
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
        transaction(catalog, () => catalog.prepare('UPDATE works SET work_id = ?, title = ?, updated_at = ? WHERE work_id = ?')
          .run(nextId, title, at, oldId))
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
    removeDatabaseFiles(trashFile(root, workId))
    moveDatabaseFiles(from, trashFile(root, workId))
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
  if (problems.length === 0) throw new StoryError('empty-review', '问题清单为空：审稿至少要给出一条问题')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || entry.current_revision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能审稿`)
      if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改审稿要先带 reopen`)
      const round = (db.prepare('SELECT max(round) AS n FROM reviews WHERE number = ?').get(number)?.n ?? 0) + 1
      const lines = [`# 第 ${number} 章 审稿（第 ${round} 轮）`, '', `- 正文版本：${entry.current_revision}`, '']
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
    if (row === undefined) return { path: '', round: 0, items: [], rounds }
    return {
      path: virtualPath(work, `reviews/${chapterStem(number)}.r${row.round}.md`),
      round: row.round,
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
      const covers = review.revision === entry.current_revision
        || (mode !== 'patch' && review.revision === entry.current_revision - 1)
      if (!covers) throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
      const open = parseReview(review.text).filter(item => !item.done).map(item => item.id)
      const missing = problemIds.filter(id => !open.includes(id))
      if (missing.length > 0) throw new StoryError('problem-not-found', `问题不存在或已处理：${missing.join('、')}`)
      const current = currentVersion(db, entry)
      if (current.body === body) throw new StoryError('unchanged-body', '修订后的正文与当前版本相同')
      const oldWords = countWords(current.body)
      const newWords = countWords(body)
      const delta = oldWords === 0 ? 1 : Math.abs(newWords - oldWords) / oldWords
      if (mode === 'patch' && delta > 0.2) {
        throw new StoryError('revise-mode-violation', `局部修补的字数变化 ${(delta * 100).toFixed(0)}% 超过 20%：改用 polish 或 rewrite`)
      }
      if (mode === 'polish' && delta > 0.4) {
        throw new StoryError('revise-mode-violation', `润色的字数变化 ${(delta * 100).toFixed(0)}% 超过 40%：改用 rewrite`)
      }
      if (mode === 'deslop') {
        const before = critique(current.body).aiPhrases.count
        const after = critique(body).aiPhrases.count
        if (before > 0 && after >= before) {
          throw new StoryError('revise-mode-violation', `去 AI 味修订没有减少命中的腔调词（${before} → ${after}）`)
        }
      }
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
 * Write a chapter summary (already capped by the caller).
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, text: string}} input - summary input.
 * @returns {{workId: string, chapter: number, chars: number}} receipt.
 */
export function writeSummary(root, input) {
  const number = chapterNumber(input.chapter)
  const text = String(input.text ?? '').trim()
  if (text === '') throw new StoryError('empty-summary', '摘要不能为空')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      ensureChapter(db, number)
      const at = now()
      db.prepare(`INSERT INTO summaries (number, text, written_at) VALUES (?, ?, ?)
        ON CONFLICT(number) DO UPDATE SET text = excluded.text, written_at = excluded.written_at`).run(number, text, at)
      syncSearchDoc(db, `summary:${number}`, 'summary', `summaries/${chapterStem(number)}`, number, text)
      touchMeta(db, at)
      return { workId, chapter: number, chars: text.length }
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
      const covers = review.revision === entry.current_revision || review.revision === entry.current_revision - 1
      const open = parseReview(review.text).filter(item => !item.done)
      if (open.length > 0) {
        throw new StoryError('review-required',
          `第 ${number} 章还有 ${open.length} 条未处理审稿：${open.map(item => item.id).join('、')}；先修订再定稿`)
      }
      if (!covers) throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
      if (stageOf(entry) !== 'revised') {
        throw new StoryError('review-required',
          `第 ${number} 章还没走完修订（当前阶段：${stageOf(entry)}）：先 story_revise 提交改动，再定稿`)
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
      const version = randomUUID()
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
 * Tokenize text for FTS5: CJK bigrams + unigrams, latin words.
 * @param {string} text - source text.
 * @returns {string} space-separated tokens.
 */
export function searchTokens(text) {
  const tokens = []
  for (const match of String(text).matchAll(/[\u4e00-\u9fa5]+/gu)) {
    const run = match[0]
    for (let index = 0; index < run.length; index += 1) {
      if (index + 1 < run.length) tokens.push(run.slice(index, index + 2))
      tokens.push(run[index])
    }
  }
  for (const match of String(text).matchAll(/[A-Za-z][A-Za-z0-9_-]+/gu)) tokens.push(match[0].toLowerCase())
  return tokens.join(' ')
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
function syncSearchDoc(db, docId, kind, source, chapter, body) {
  const tokens = searchTokens(body)
  dropSearchDoc(db, docId)
  db.prepare('INSERT INTO search_docs (doc_id, kind, source, chapter, body, tokens) VALUES (?, ?, ?, ?, ?, ?)')
    .run(docId, kind, source, chapter, body, tokens)
  const row = db.prepare('SELECT rowid FROM search_docs WHERE doc_id = ?').get(docId)
  db.prepare('INSERT INTO search_fts (rowid, tokens) VALUES (?, ?)').run(row.rowid, tokens)
}

/** Rebuild the FTS index from `search_docs` (used after a schema-level import). */
export function rebuildSearchIndex(root, work) {
  const db = openWork(root, work)
  try {
    transaction(db, () => {
      db.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
    })
  } finally {
    db.close()
  }
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
  const tokens = searchTokens(query).split(' ').filter(token => token !== '')
  if (tokens.length === 0) return []
  const db = openWork(root, work)
  try {
    const match = tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ')
    return db.prepare(`SELECT d.doc_id AS id, d.kind, d.source, d.chapter, d.body, bm25(search_fts) AS score
      FROM search_fts JOIN search_docs d ON d.rowid = search_fts.rowid
      WHERE search_fts MATCH ? ORDER BY score, d.chapter DESC, d.doc_id LIMIT ?`)
      .all(match, limit)
      .map(row => ({ id: row.id, kind: row.kind, source: row.source, chapter: row.chapter, body: row.body, score: row.score }))
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Export and backup
// ---------------------------------------------------------------------------

/** Render the export manifest from the catalog row and the work database. */
function exportManifest(root, workId, catalogRowValue, db) {
  const meta = metaOf(db)
  const chapters = db.prepare('SELECT * FROM chapters ORDER BY number').all()
  return {
    schemaVersion: 1,
    title: catalogRowValue.title,
    form: catalogRowValue.form,
    tags: catalogRowValue.tags === null ? [] : JSON.parse(catalogRowValue.tags),
    wordRange: meta.word_min === null ? null : { min: meta.word_min, max: meta.word_max },
    planApproval: meta.plan_approval,
    outline: meta.outline_written_at === null ? null : {
      writtenAt: meta.outline_written_at,
      approvedAt: meta.outline_approved_at,
    },
    chapters: chapters.map(chapter => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      stage: chapter.stage,
      currentRevision: chapter.current_revision,
      words: chapter.words,
      planApprovedAt: chapter.plan_approved_at,
    })),
  }
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
      const put = (relative, text) => {
        const file = join(target, relative)
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, text, 'utf8')
        files.push(relative)
      }
      put('manifest.json', `${JSON.stringify(exportManifest(root, row.work_id, row, db), null, 2)}\n`)
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
      for (const proposal of catalog.prepare('SELECT * FROM proposals ORDER BY created_at').all()) {
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
      const exists = catalog.prepare('SELECT 1 FROM works WHERE title = ? AND trashed_at IS NULL').get(title)
      if (exists !== undefined) throw new StoryError('work-exists', `作品已存在：${title}`)
      const cutoff = new Date(Date.now() - PROPOSAL_TTL_MS).toISOString()
      catalog.prepare('DELETE FROM proposals WHERE used_at IS NULL AND created_at < ?').run(cutoff)
      const id = `p-${randomUUID().slice(0, 8)}`
      const at = now()
      catalog.prepare(`INSERT INTO proposals (id, title, form, premise, characters, conflict, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, title, String(input.form ?? 'longform'), String(input.premise ?? ''),
        input.characters ?? null, input.conflict ?? null, input.notes ?? null, at,
      )
      return { id, title, form: input.form ?? 'longform', premise: input.premise ?? '', createdAt: at }
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
 * Prune unused proposals older than the TTL.
 * @param {string} root - workspace directory.
 * @param {number} ttlMs - age threshold.
 * @returns {{removed: number}} removal count.
 */
export function pruneProposals(root, ttlMs = PROPOSAL_TTL_MS) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return { removed: 0 }
  try {
    return transaction(catalog, () => {
      const cutoff = new Date(Date.now() - ttlMs).toISOString()
      const result = catalog.prepare('DELETE FROM proposals WHERE used_at IS NULL AND created_at < ?').run(cutoff)
      return { removed: result.changes }
    })
  } finally {
    catalog.close()
  }
}

/**
 * Persist the whole session→work map (replaces previous rows).
 * @param {string} root - workspace directory.
 * @param {Record<string, string>} entries - session id → work id.
 * @returns {{count: number}} stored count.
 */
export function replaceSessionCurrent(root, entries) {
  const catalog = openCatalog(root)
  try {
    return transaction(catalog, () => {
      catalog.prepare('DELETE FROM session_current').run()
      const at = now()
      for (const [sessionId, workId] of Object.entries(entries ?? {})) {
        if (typeof sessionId !== 'string' || typeof workId !== 'string') continue
        catalog.prepare('INSERT INTO session_current (session_id, work_id, updated_at) VALUES (?, ?, ?)')
          .run(sessionId, workId, at)
      }
      return { count: Object.keys(entries ?? {}).length }
    })
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
