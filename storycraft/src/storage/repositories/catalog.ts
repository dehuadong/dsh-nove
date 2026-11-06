import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import type { Database } from '../db.ts'
import {
  backupTo, checkpoint, createWorkDatabase, exportsDir, integrityCheck, WORK_SCHEMA_VERSION,
  materialsDir, moveDatabaseFiles, openCatalog, openDatabase, openWork, removeDatabaseFiles, touchMeta, transaction,
  trashDir, trashFile, workFile, worksDir, backupsDir,
} from '../db.ts'
import { MATERIAL_PURPOSES, MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from '../../materials.ts'
import { chapterRemap } from '../../chapter-edit.ts'
import { filterChapters, filterWorks, workStatus, type ChapterFilters, type WorkFilters } from '../../work-filters.ts'
import { buildEpub } from '../../epub.ts'
import { snippetFor } from '../../retrieval.ts'
import { materialIndexText, searchTokens } from '../../search-text.ts'
import { dropSearchDoc, syncSearchDoc } from '../../search-index.ts'
import { STATE_LIMITS, applyFactOp, applyHookOp, mintHookId, projectState } from '../../state-projection.ts'
import {
  StoryError, SUMMARY_FIELDS, SUMMARY_MAX_CHARS, WORK_FORMS, chapterNumber, chapterStem, contentVersion, countWords,
  formOf, now, planApprovalPolicy, stageOf, summaryAdmissible, trimSummary, unitOf, workIdOf,
} from '../../domain.ts'
import { assertRevisionMode } from '../../revision.ts'
import { INITIAL_HOOKS_HEADING, assertHookTransition, validateArtifactRecord, validateHook, validateInitialHooks } from '../../artifact-contract.ts'
import {
  artifactRevision, deleteArtifactOnDb, dropRoleCardsOnDb, FOUNDATION_DOCUMENTS, indexTiersOf, latestRoleCardsOnDb, putArtifactOnDb, remapChapterArtifacts, renderChapterMemo, renderFoundationContent,
  writeChapterMemoOnDb, writeChapterObservationsOnDb, writeChapterSummaryOnDb, writeTextArtifactOnDb, readTextArtifactOnDb,
} from '../../artifact-store.ts'
import { reviewInputOf } from '../../review-binding.ts'
import { methodForStep } from '../../skill-routing.ts'
import { callSummary } from '../../telemetry.ts'
import {
  catalogRow,
  metaOf,
  outlineApprovedAt,
  requireCatalog,
  DEFAULT_BIBLE,
  virtualWorkPath,
  openProblemCountByChapter,
  summaryStateMap,
  latestReviewRow,
  summaryStateFrom,
  openObservations,
  foldedOf,
  outlineRevisionOf,
  approvalSourceOf,
  approvalReasonOf,
  activeWork,
} from './shared.ts'
import {
  TRUTH_ARTIFACTS,
} from './bible.ts'
import {
  foundationStateOf,
} from './foundation.ts'

// ---------------------------------------------------------------------------
// Work manifest and listing
// ---------------------------------------------------------------------------

/**
 * Read one work manifest from the catalog and its work database.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} manifest.
 */
export function readManifest(root: string, work: unknown): any {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    try {
      const meta = metaOf(db)
      const chapters = db.prepare('SELECT * FROM chapters ORDER BY number').all()
      const memos = new Map(db.prepare("SELECT artifact_id, revision_id FROM artifacts WHERE kind = 'plan' ORDER BY rowid")
        .all().map(row => [row.artifact_id, row.revision_id]))
      const drafts = new Map()
      for (const row of db.prepare("SELECT content FROM artifacts WHERE kind = 'state_draft' ORDER BY rowid").all()) {
        const draft = JSON.parse(String(row.content))
        drafts.set(Number(draft.chapter), draft)
      }
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
            ...(outlineApprovedAt(db) === undefined ? {} : { approvedAt: outlineApprovedAt(db) }),
    ...(meta.outline_approved_source === null ? {} : { approvedSource: meta.outline_approved_source }),
    ...(meta.outline_approved_reason === null ? {} : { approvedReason: meta.outline_approved_reason }),
          },
        }),
        foundation: foundationStateOf(db),
        chapters: chapters.map(chapter => {
          const memoRevision = memos.get(`plan:${chapter.number}`)
          return {
            number: chapter.number,
            id: chapterStem(Number(chapter.number)),
            title: chapter.title,
            status: chapter.status,
            stage: chapter.stage,
            currentRevision: chapter.current_revision,
            words: chapter.words,
            planApproved: chapter.plan_approved_at !== null
              && memoRevision !== undefined && chapter.plan_revision === memoRevision,
            ...(chapter.plan_approved_at === null ? {} : { planApprovedAt: chapter.plan_approved_at }),
    ...(chapter.plan_approved_source === null ? {} : { planApprovedSource: chapter.plan_approved_source }),
    ...(chapter.plan_approved_reason === null ? {} : { planApprovedReason: chapter.plan_approved_reason }),
            ...(chapter.plan_revision == null ? {} : { planRevision: chapter.plan_revision }),
            provenance: chapter.provenance ?? 'generated',
            stateReadyRevision: Number(chapter.state_ready_revision ?? 0),
            stateDraftReady: drafts.get(Number(chapter.number))?.ready === true
              && Number(drafts.get(Number(chapter.number))?.revision) === Number(chapter.current_revision),
            ...(chapter.last_revise_mode === null ? {} : { lastReviseMode: chapter.last_revise_mode }),
            updatedAt: chapter.updated_at,
          }
        }),
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

/** The workspace's fixed form, if it has been initialized. */
export function readWorkspaceForm(root: any): { form: string, presetId?: string } | undefined {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return undefined
  const row = catalog.prepare('SELECT form, preset_id AS presetId FROM workspace WHERE id = 1').get() as { form: string, presetId: string | null } | undefined
  if (row === undefined) return undefined
  return { form: row.form, ...(row.presetId === null ? {} : { presetId: row.presetId }) }
}

/** Fix the workspace form on first use; later calls must match it. */
export function ensureWorkspaceForm(root: any, form: string, presetId?: string): string {
  const catalog = requireCatalog(root)
  const row = catalog.prepare('SELECT form FROM workspace WHERE id = 1').get() as { form: string } | undefined
  if (row !== undefined) {
    if (row.form !== form) {
      throw new StoryError('workspace-form-mismatch',
        `工作区形态是 ${row.form}，当前预设要求 ${form}：换工作区或换预设`)
    }
    return row.form
  }
  transaction(catalog, () => {
    catalog.prepare('INSERT INTO workspace (id, form, preset_id, created_at) VALUES (1, ?, ?, ?)')
      .run(form, presetId ?? null, now())
  })
  return form
}

/**
 * Create a work: the database file first, then the catalog row. A failed
 * catalog insert removes the file, so a half-created work never survives.
 * @param {string} root - workspace directory.
 * @param {{title: string, workId?: string, form?: string, wordRange?: {min: number, max: number}, tags?: string[]}} input - creation input.
 * @returns {{workId: string, path: string, manifest: object}} created work.
 */
export function initWork(root: string, input: any): any {
  const title = String(input.title ?? '').trim()
  if (title === '') throw new StoryError('invalid-title', '作品需要标题')
  const form = input.form === undefined ? 'longform' : String(input.form)
  if (!(WORK_FORMS as readonly string[]).includes(form)) throw new StoryError('form-invalid', `作品形态只能是 ${WORK_FORMS.join(' / ')}：收到 ${String(input.form)}`)
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
  const catalog = requireCatalog(root)
  try {
    if (catalogRow(catalog, workId) !== undefined) throw new StoryError('work-exists', `作品已存在：${workId}`)
    if (existsSync(workFile(root, workId))) throw new StoryError('work-exists', `作品已存在：${workId}`)
    const at = now()
    const tags = Array.isArray(input.tags) ? input.tags.map((tag: any) => String(tag)) : undefined
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
            const truth = (TRUTH_ARTIFACTS as Record<string, any>)[name]
            writeTextArtifactOnDb(db, {
              work: workId, artifactId: truth.artifactId, kind: truth.kind, content, createdAt: at,
            })
            if (truth.kind !== 'outline') {
              syncSearchDoc(db, truth.artifactId, truth.kind, `bible/${name}`, 0, content)
            }
          }
        })
      } finally {
        db.close()
      }
      transaction(catalog, () => {
        catalog.prepare(`INSERT INTO works (work_id, title, form, tags, schema_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(workId, title, form, tags === undefined ? null : JSON.stringify(tags), WORK_SCHEMA_VERSION, at, at)
      })
    } catch (error: any) {
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
export function reconcileWorks(root: any) {
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
export function ensureReconciled(root: any) {
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
  } catch (error: any) {
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
export function listWorks(root: string, options: WorkFilters = {}): any[] {
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
      } catch (error: any) {
        // Keep a broken work visible so the panel can explain it,
        // instead of silently dropping it from the list.
        const code = error?.code ?? 'work-open-failed'
        works.push({
          workId: row.work_id,
          title: row.title,
          form: formOf(row),
          chapters: null,
          writtenChapters: null,
          latestChapter: null,
          latestStage: null,
          openProblems: null,
          updatedAt: row.updated_at,
          degraded: true,
          schemaVersion: row.schema_version,
          openError: {
            code,
            message: error instanceof Error ? error.message : String(error),
            retryable: code === 'work-busy',
          },
        })
        continue
      }
      try {
        const meta = metaOf(db)
        const chapters = db.prepare('SELECT number, current_revision, stage FROM chapters ORDER BY number').all()
        let openProblems = 0
        for (const current of openProblemCountByChapter(db).values()) openProblems += current
        works.push({
          workId: row.work_id,
          title: row.title,
          form: formOf(row),
          chapters: chapters.length,
          writtenChapters: chapters.filter((chapter: any) => Number(chapter.current_revision) > 0).length,
          latestChapter: chapters.length === 0 ? 0 : chapters[chapters.length - 1].number,
          latestStage: chapters.length === 0 ? null : stageOf(chapters[chapters.length - 1]),
          openProblems,
          updatedAt: meta.updated_at,
        })
      } finally {
        db.close()
      }
    }
    const withStatus = works.map(work => ({ ...work, status: workStatus(work) }))
    return filterWorks(withStatus.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))), options)
  } finally {
    catalog.close()
  }
}

/**
 * List trashed works, newest first.
 * @param {string} root - workspace directory.
 * @returns {Array<{workId: string, title: string, trashedAt: string, path: string}>} trash entries.
 */
export function listTrash(root: string): any[] {
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
export function readWork(root: string, work: unknown, options: ChapterFilters = {}): any {
  const manifest = readManifest(root, work)
  const db = openWork(root, manifest.workId)
  try {
    const planRows = new Set(db.prepare(`SELECT scope_chapter FROM artifacts
      WHERE kind = 'plan' AND scope_chapter IS NOT NULL`).all().map(row => row.scope_chapter))
    const summaryStates = summaryStateMap(db)
    const chapters = manifest.chapters.map((chapter: any) => {
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
        planApproved: chapter.planApproved === true,
        ...(chapter.planRevision === undefined ? {} : { planRevision: chapter.planRevision }),
        provenance: chapter.provenance,
        hasSummary: summary.state === 'current',
        summaryRevision: summary.revision,
        summaryStale: summary.state === 'stale',
        stateReadyRevision: Number(chapter.state_ready_revision ?? 0),
        reviewRound: review?.round ?? 0,
        openProblems: openObservations(review).length,
        updatedAt: chapter.updatedAt,
      }
    })
    const folded = foldedOf(db)
    const eventCount = (db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n
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
      chapterMatches: filterChapters(chapters, options),
      state: {
        facts: folded.facts,
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
export function status(root: any, work: any) {
  const manifest = readManifest(root, work)
  const db = openWork(root, manifest.workId)
  try {
    const folded = foldedOf(db)
    const summaryStates = summaryStateMap(db)
    let openProblems = 0
    for (const current of openProblemCountByChapter(db).values()) openProblems += current
    const written = manifest.chapters.filter((chapter: any) => chapter.currentRevision > 0)
    return {
      workId: manifest.workId,
      calls: callSummary(root, manifest.workId),
      planApproval: planApprovalPolicy(manifest),
      outline: manifest.outline === undefined
        ? null
        : {
            ...(manifest.outline.writtenAt === undefined ? {} : { writtenAt: manifest.outline.writtenAt }),
            ...(manifest.outline.approvedAt === undefined ? {} : { approvedAt: manifest.outline.approvedAt }),
          },
      title: manifest.title,
      chapters: manifest.chapters.map((chapter: any) => {
        const summary = summaryStateFrom(summaryStates, chapter.number)
        return {
          number: chapter.number,
          status: chapter.status,
          stage: stageOf(chapter),
          revision: chapter.currentRevision,
          words: chapter.words,
          ...(chapter.planRevision === undefined ? {} : { planRevision: chapter.planRevision }),
          provenance: chapter.provenance,
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
      facts: folded.facts.filter(fact => fact.validUntilChapter === null).length,
      hooks: {
        open: folded.hooks.filter(hook => hook.status === 'open').length,
        progressing: folded.hooks.filter(hook => hook.status === 'progressing').length,
        deferred: folded.hooks.filter(hook => hook.status === 'deferred').length,
        resolved: folded.hooks.filter(hook => hook.status === 'resolved').length,
        superseded: folded.hooks.filter(hook => hook.status === 'superseded').length,
        unresolved: folded.hooks.filter(hook => ['open', 'progressing', 'deferred'].includes(hook.status)).length,
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
export function delegateOf(step: any, last: any, candidate: any) {
  if (step.action === 'story_architect') {
    if (Array.isArray(step.blocked) && step.blocked.length > 0) return undefined
    if (step.foundationStage === undefined) return undefined
    return { role: 'architect', stage: step.foundationStage }
  }
  const role = ({ story_write: 'writer', story_review: 'reviewer', story_revise: 'reviser', story_summarize: 'summarizer' } as Record<string, string>)[step.action]
  if (role === undefined) return undefined
  const missing = Array.isArray(step.missing) ? step.missing : []
  const blocked = Array.isArray(step.blocked) ? step.blocked : []
  if (missing.includes('outline') || missing.includes('plan-approval') || missing.includes('revision')
    || blocked.length > 0) return undefined
  if (role === 'reviser' && (last === undefined || candidate === undefined || candidate.revision !== last.currentRevision)) {
    return undefined
  }
  if (role === 'summarizer') {
    return summaryAdmissible(last, candidate) ? { role } : undefined
  }
  return { role }
}
// ---------------------------------------------------------------------------
// Settings and the book plan
// ---------------------------------------------------------------------------

/**
 * Update the word range, plan-approval policy and optional chapter token cap.
 * @param {string} root - workspace directory.
 * @param {{work: string, wordRange?: {min: number, max: number}|null, planApproval?: 'required'|'off'|null, maxChapterTokens?: number|null}} input - settings.
 * @returns {object} stored settings.
 */
export function updateSettings(root: any, input: any) {
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
      const cap = input.maxChapterTokens === null ? null : input.maxChapterTokens ?? meta.max_chapter_tokens
      if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) throw new StoryError('chapter-token-limit-invalid', '单章 token 上限必须是正整数')
      db.prepare('UPDATE meta SET word_min = ?, word_max = ?, plan_approval = ?, max_chapter_tokens = ?, updated_at = ? WHERE id = 1')
        .run(min, max, policy, cap, now())
      return {
        workId,
        planApproval: policy,
        ...(min === null ? {} : { wordRange: { min, max } }),
        maxChapterTokens: cap,
      }
    })
  } finally {
    db.close()
  }
}

/** Read the optional per-chapter token cap; absent means unlimited. */
export function maxChapterTokensOf(root: string, work: string): number | null {
  const db = openWork(root, work)
  try {
    const row = db.prepare('SELECT max_chapter_tokens AS cap FROM meta WHERE id = 1').get() as { cap?: number | null } | undefined
    return typeof row?.cap === 'number' ? row.cap : null
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
export function writeOutline(root: any, input: any) {
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
      const written = writeTextArtifactOnDb(db, {
        work: workId, artifactId: 'outline', kind: 'outline', content: text, createdAt: at,
      })
      if (written.created) {
        syncSearchDoc(db, 'outline', 'outline', 'outline/plan', 0, written.content)
      }
      // The fingerprint decides validity: writing a new revision makes the old
    // confirmation fail the revision check without clearing it here.
    db.prepare('UPDATE meta SET outline_written_at = ?, updated_at = ? WHERE id = 1').run(at, at)
      return { workId, outline: { writtenAt: at, revision: written.revisionId } }
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
export function approveOutline(root: any, input: any) {
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const meta = metaOf(db)
      if (meta.outline_written_at === null) throw new StoryError('outline-required', '还没有全书计划：先 story_outline')
      const at = now()
      const revision = outlineRevisionOf(db)
      const source = approvalSourceOf(input)
      db.prepare('UPDATE meta SET outline_approved_at = ?, outline_approved_revision = ?, outline_approved_source = ?, outline_approved_reason = ?, updated_at = ? WHERE id = 1').run(at, revision ?? null, source, approvalReasonOf(input), at)
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
export function renameWork(root: any, input: any) {
  const oldId = String(input.work)
  const catalog = requireCatalog(root)
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
      } catch (error: any) {
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
      } catch (error: any) {
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
    } catch (error: any) {
      db.close()
      throw error
    }
    db.close()
    try {
      transaction(catalog, () => catalog.prepare('UPDATE works SET title = ?, updated_at = ? WHERE work_id = ?')
        .run(title, at, oldId))
    } catch (error: any) {
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
export function deleteWork(root: any, input: any) {
  const workId = String(input.work)
  const catalog = requireCatalog(root)
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
      transaction(catalog, () => {
        catalog.prepare('UPDATE works SET trashed_at = ?, missing_at = NULL WHERE work_id = ?').run(now(), workId)
        // A deleted work cannot stay bound to a session: the pointer would be dead.
        catalog.prepare('DELETE FROM session_current WHERE work_id = ?').run(workId)
      })
    } catch (error: any) {
      moveDatabaseFiles(trashFile(root, workId), from)
      throw error
    }
    return { workId, path: `.storycraft/trash/${workId}.db` }
  } finally {
    catalog.close()
  }
}

/**
 * Permanently remove one trashed work and its catalog row.
 * @param {string} root - workspace directory.
 * @param {{work: string}} input - trashed work.
 * @returns {{workId: string}} removed identity.
 */
export function purgeTrash(root: any, input: any) {
  const workId = String(input.work ?? '')
  const catalog = requireCatalog(root)
  try {
    const row = catalogRow(catalog, workId)
    if (row === undefined || row.trashed_at === null) throw new StoryError('work-not-found', `回收站里没有作品 ${workId}`)
    const target = trashFile(root, workId)
    if (existsSync(target)) removeDatabaseFiles(target)
    transaction(catalog, () => catalog.prepare('DELETE FROM works WHERE work_id = ?').run(workId))
    return { workId }
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
export function restoreWork(root: any, input: any) {
  const name = String(input.name ?? '').trim()
  if (name === '') throw new StoryError('invalid-work-id', '要恢复的作品名不能为空')
  const catalog = requireCatalog(root)
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
    } catch (error: any) {
      moveDatabaseFiles(target, source)
      throw error
    }
    return { workId: name }
  } finally {
    catalog.close()
  }
}



