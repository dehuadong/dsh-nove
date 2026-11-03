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
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import type { Database } from './storage/db.ts'
import type { ArtifactRow, BibleRow, ChapterRow, ChapterVersionRow, EventRow, MaterialRow, MetaRow, VolumeRow, WorkRow } from './store-rows.ts'

/**
 * Revision rounds one chapter may consume before the author has to decide.
 *
 * A reviewer can always find five more observations, so "keep revising until
 * clean" never converges on a real link (#50 acceptance: 5/5/2/5 over four
 * rounds, 2840 words against a 3000 ceiling). The cap turns that loop into an
 * author decision instead of a token sink.
 */

/** Revisions spent on this chapter so far (revision 1 is the first draft). */





import {
  backupTo, checkpoint, createWorkDatabase, exportsDir, integrityCheck, WORK_SCHEMA_VERSION,
  materialsDir, moveDatabaseFiles, openCatalog, openDatabase, openWork, removeDatabaseFiles, touchMeta, transaction,
  trashDir, trashFile, workFile, worksDir, backupsDir,
} from './storage/db.ts'
import { MATERIAL_PURPOSES, MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from './materials.ts'
import { chapterRemap } from './chapter-edit.ts'
import { filterChapters, filterWorks, workStatus, type ChapterFilters, type WorkFilters } from './work-filters.ts'
import { buildEpub } from './epub.ts'
import { snippetFor } from './retrieval.ts'
import { materialIndexText, searchTokens } from './search-text.ts'
import { dropSearchDoc, syncSearchDoc } from './search-index.ts'
import { STATE_LIMITS, applyFactOp, applyHookOp, mintHookId, projectState } from './state-projection.ts'

export { searchTokens }
import {
  StoryError, SUMMARY_FIELDS, SUMMARY_MAX_CHARS, WORK_FORMS, chapterNumber, chapterStem, contentVersion, countWords,
  formOf, now, planApprovalPolicy, stageOf, summaryAdmissible, trimSummary, unitOf, workIdOf,
} from './domain.ts'
import { assertRevisionMode } from './revision.ts'
import { INITIAL_HOOKS_HEADING, assertHookTransition, validateArtifactRecord, validateHook, validateInitialHooks } from './artifact-contract.ts'
import {
  artifactRevision, deleteArtifactOnDb, dropRoleCardsOnDb, FOUNDATION_DOCUMENTS, indexTiersOf, latestRoleCardsOnDb, putArtifactOnDb, remapChapterArtifacts, renderChapterMemo, renderFoundationContent,
  writeChapterMemoOnDb, writeChapterObservationsOnDb, writeChapterSummaryOnDb, writeTextArtifactOnDb, readTextArtifactOnDb,
} from './artifact-store.ts'
import { reviewInputOf } from './review-binding.ts'
import { methodForStep } from './skill-routing.ts'
import { callSummary } from './telemetry.ts'
import { MAX_REVISION_ROUNDS, revisionRounds } from './storage/types.ts'
import type {
  WriteChapterInput,
  ReadChapterInput,
  WriteReviewInput,
  ReviseChapterInput,
  WriteSummaryInput,
} from './storage/types.ts'
export * from './storage/types.ts'

import {
  PROPOSAL_TTL_MS,
  EXPORT_MTIME,
  exportLocks,
  virtualWorkPath,
  virtualPath,
  catalogRow,
  activeWork,
  requireCatalog,
  metaOf,
  chapterRow,
  ensureChapter,
  planApprovalState,
  assertPlanApproved,
  latestSummaryContent,
  parseSummaryContent,
  summaryStateOf,
  latestSummaryRows,
  summaryStateMap,
  summaryStateFrom,
  reviewRecords,
  latestReviewRow,
  openObservations,
  foundationRevisionOf,
  foundationApprovedAt,
  outlineRevisionOf,
  outlineApprovedAt,
  planMemoFrom,
  methodFor,
  approvalReasonOf,
  approvalSourceOf,
  foundationSummaryOf,
  askFor,
  currentVersion,
  reviewCovers,
  isCleanReview,
  openProblemCountByChapter,
  eventsText,
  eventsOf,
  foldedOf,
  DEFAULT_BIBLE,
  FOUNDATION_STAGE_ARTIFACTS,
} from './storage/repositories/shared.ts'

import {
  TRUTH_ARTIFACTS,
} from './storage/repositories/bible.ts'

import {
  invalidateStateDraftOnDb,
  readEvents,
  exportSummaryRows,
} from './storage/repositories/state.ts'

import {
  renderReviewMarkdown,
} from './storage/repositories/reviews.ts'



export * from './storage/repositories/shared.ts'

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
            if (name === 'characters') {
              db.prepare('INSERT INTO bible (name, content, version, updated_at) VALUES (?, ?, ?, ?)')
                .run(name, content, contentVersion(content), at)
              continue
            }
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
function delegateOf(step: any, last: any, candidate: any) {
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
// Foundation production: architect stages land validated artifacts; the author
// confirms the finished set from the panel. Stages are derived from the registry
// so a rerun or a manual edit cannot desync the state.
// ---------------------------------------------------------------------------

/** Architect state stages in order. */
export const FOUNDATION_STAGES = ['frame', 'rules', 'hooks', 'roles', 'cards']

/** Normal architect dispatch is one foundation bundle; manual stages remain for repair. */
export const FOUNDATION_DISPATCH_STAGES = ['foundation']
export const FOUNDATION_WRITE_STAGES = ['design', 'frame', 'rules', 'hooks', 'roles', 'cards']


/** Every index person has exactly one card, and the card tier matches. */
function foundationCardsComplete(db: any): boolean {
  const index = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'roles:index' ORDER BY rowid DESC LIMIT 1").get()
  if (index === undefined) return false
  const tiers = indexTiersOf(JSON.parse(String(index.content)))
  if (tiers.size === 0) return false
  const seen = new Map<string, string>()
  for (const row of latestRoleCardsOnDb(db)) {
    const card = JSON.parse(String(row.content))
    const name = String(card?.name ?? '')
    if (seen.has(name)) return false
    seen.set(name, String(card?.tier ?? ''))
  }
  if (seen.size !== tiers.size) return false
  for (const [name, tier] of tiers) {
    if (seen.get(name) !== tier) return false
  }
  return true
}

/** Derived foundation state of one open work. */
function foundationStateOf(db: any) {
  const has = (artifactId: any) => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? LIMIT 1').get(artifactId) !== undefined
  const stages = {
    frame: FOUNDATION_STAGE_ARTIFACTS.frame.every(has),
    rules: FOUNDATION_STAGE_ARTIFACTS.rules.every(has),
    hooks: FOUNDATION_STAGE_ARTIFACTS.hooks.every(has),
    roles: FOUNDATION_STAGE_ARTIFACTS.roles.every(has),
    cards: foundationCardsComplete(db),
  }
  const complete = FOUNDATION_STAGES.every(stage => (stages as Record<string, boolean>)[stage] === true)
  const nextStage = FOUNDATION_STAGES.find(stage => (stages as Record<string, boolean>)[stage] !== true)
  const dispatchStage = complete ? undefined : FOUNDATION_DISPATCH_STAGES[0]
  return {
    stages,
    complete,
    ...(nextStage === undefined ? {} : { nextStage }),
    ...(dispatchStage === undefined ? {} : { dispatchStage }),
    ...(foundationApprovedAt(db) === undefined ? {} : { approvedAt: foundationApprovedAt(db) }),
    ...(metaOf(db).foundation_approved_source === null ? {} : { approvedSource: metaOf(db).foundation_approved_source }),
    ...(metaOf(db).foundation_approved_reason === null ? {} : { approvedReason: metaOf(db).foundation_approved_reason }),
  }
}

/** Read the derived foundation state of one work. */
export function readFoundationState(root: any, work: any) {
  const db = openWork(root, work)
  try {
    return foundationStateOf(db)
  } finally {
    db.close()
  }
}

/**
 * Land one architect stage atomically.
 * All artifacts are validated before any write; a rerun appends revisions and
 * clears the author's foundation confirmation.
 * @param {string} root - workspace directory.
 * @param {{work: string, stage: string, payload: object}} input - stage payload.
 * @returns {{workId: string, stage: string, artifacts: object[], foundation: object}} receipt.
 */
/**
 * Tokens from the accepted proposal that a foundation should mention.
 *
 * The proposal is the author contract: a frame that names none of its premise
 * words or characters was generated from something else, so it must not land.
 * @returns deduplicated tokens; empty when the work has no accepted proposal.
 */
/** The accepted proposal of one work, when the catalog has it. */
export function acceptedProposalOf(root: any, workId: string): { premise: string, characters: string } | undefined {
  let catalog: ReturnType<typeof openCatalog>
  try {
    catalog = openCatalog(root, { create: false })
  } catch {
    throw new StoryError('foundation-mismatch', '读不到提案，无法校验基础设定', '先确认作品库可读，再重试')
  }
  if (catalog === undefined) {
    throw new StoryError('foundation-mismatch', '读不到提案，无法校验基础设定', '先确认作品库可读，再重试')
  }
  try {
    const row = catalog.prepare('SELECT premise, characters FROM proposals WHERE used_work_id = ? ORDER BY created_at DESC LIMIT 1').get(workId)
    if (row === undefined) return undefined
    return { premise: String(row.premise ?? ''), characters: String(row.characters ?? '[]') }
  } finally {
    catalog.close()
  }
}
function proposalTokensOf(root: any, workId: string): string[] {
  const proposal = acceptedProposalOf(root, workId)
  if (proposal === undefined) return []
  const tokens: string[] = []
  for (const part of proposal.premise.split(/[，。；、：！？\s“”"（）()]+/u)) {
    const chars = [...part]
    if (chars.length >= 2) tokens.push(part)
    for (let index = 0; index + 3 <= chars.length; index += 1) tokens.push(chars.slice(index, index + 3).join(''))
  }
  try {
    const list = JSON.parse(proposal.characters === '' ? '[]' : proposal.characters)
    if (Array.isArray(list)) {
      for (const item of list) {
        const name = typeof item === 'string' ? item : item?.name
        if (typeof name === 'string' && [...name].length >= 2) tokens.push(name)
      }
    }
  } catch {
    // characters are optional
  }
  return [...new Set(tokens)]
}

/** Escape one hook table cell so the readable projection stays a valid table. */
function hooksTableCell(value: any): string {
  return String(value ?? '').replace(/\r?\n/gu, ' ').replace(/\|/gu, '\\|').trim()
}

/** Render the architect seed as the readable table stored in `bible:hooks`. */
export function renderInitialHooksMarkdown(hooks: ReadonlyArray<any>): string {
  const head = '| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 | text |'
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- |'
  const rows = hooks.map(hook => `| ${[
    hook.hookId, '开篇', hook.type, 'deferred', '开篇', hook.expectedPayoff, hook.notes, hook.text,
  ].map(hooksTableCell).join(' | ')} |`)
  return [INITIAL_HOOKS_HEADING, '', head, rule, ...rows, ''].join('\n')
}

/** The `bible:hooks` payload: the seed fields plus their readable table. */
function initialHooksArtifact(hooks: ReadonlyArray<any>) {
  return { hooks: hooks.map(hook => ({ ...hook })), markdown: renderInitialHooksMarkdown(hooks) }
}

/** Latest architect seed, read from `bible:hooks`; empty when never seeded. */
function initialHooksSeedOf(db: any): any[] {
  const row = db.prepare("SELECT content_type, content FROM artifacts WHERE artifact_id = 'bible:hooks' ORDER BY rowid DESC LIMIT 1").get()
  if (row === undefined) return []
  try {
    const content = row.content_type === 'json' ? JSON.parse(String(row.content)) : undefined
    return Array.isArray(content?.hooks) ? content.hooks : []
  } catch {
    return []
  }
}

/**
 * Plant the architect's initial hooks in the v2 event log at chapter 0.
 *
 * Settlement may only create `open` hooks inside a written chapter; the
 * architect plants promises before any chapter exists, so this path writes the
 * seed directly with `deferred`. Re-seeding diffs by hookId: changed metadata is
 * upserted (the current status is kept), a removed seed is superseded, a new
 * seed is created. Events are never deleted: chapter hookOps refer to ids.
 * The caller owns the transaction and therefore the rollback.
 */
function seedFoundationHooksOnDb(db: any, input: { hooks: ReadonlyArray<any>, previous: ReadonlyArray<any>, at: string }): number {
  const state = foldedOf(db)
  // A hook id belongs to the seed when its first upsert landed at chapter 0;
  // chapter-minted ids come from settlement at chapter >= 1. Ownership is read
  // from the event log, not the latest artifact, so a removed seed stays known.
  const seedIds = new Set<string>()
  for (const event of eventsOf(db)) {
    if (event.kind === 'hook' && event.op === 'upsert' && Number(event.chapter) === 0 && event.hook !== undefined) {
      seedIds.add(String(event.hook.hookId))
    }
  }
  const previousIds = new Set(input.previous.map((hook: any) => String(hook?.hookId ?? '')))
  const nextIds = new Set(input.hooks.map((hook: any) => String(hook.hookId)))
  for (const hook of input.hooks) {
    const current = state.hooks.find((item: any) => String(item.hookId) === String(hook.hookId))
    if (current === undefined) continue
    if (!seedIds.has(String(hook.hookId))) {
      throw new StoryError(
        'foundation-hooks-conflict',
        `初始伏笔 id 与已有伏笔冲突：${hook.hookId}`,
        '换一个 hookId；章节内的伏笔由结算铸造，不能复用',
      )
    }
    if (current.status === 'superseded') {
      throw new StoryError(
        'foundation-hooks-retired',
        `初始伏笔 id 已退役：${hook.hookId}`,
        '换一个 hookId；被移除的初始伏笔不能复活',
      )
    }
  }
  let seq = Number((db.prepare('SELECT max(seq) AS n FROM events').get() as { n?: number } | undefined)?.n ?? 0)
  const push = (payload: any): void => {
    seq += 1
    const text = JSON.stringify(payload)
    db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
      .run(seq, input.at, 0, 'hook', text)
    syncSearchDoc(db, `event:${seq}`, 'hook', 'state/events', 0, text)
  }
  let written = 0
  for (const hook of input.hooks) {
    const current = state.hooks.find((item: any) => String(item.hookId) === String(hook.hookId))
    const record = validateHook({
      hookId: hook.hookId,
      startChapter: current?.startChapter ?? 0,
      type: hook.type,
      status: current?.status ?? 'deferred',
      lastAdvancedChapter: current?.lastAdvancedChapter ?? 0,
      expectedPayoff: hook.expectedPayoff,
      notes: hook.notes,
      text: hook.text,
      dependsOn: current?.dependsOn ?? [],
      ...(current?.paysOffInArc === undefined ? {} : { paysOffInArc: current.paysOffInArc }),
    })
    if (current !== undefined) {
      const unchanged = ['type', 'expectedPayoff', 'notes', 'text']
        .every(key => String(current[key] ?? '') === String(record[key] ?? ''))
      if (unchanged) continue
    }
    push({ op: 'upsert', hook: record })
    written += 1
  }
  for (const hookId of previousIds) {
    if (nextIds.has(hookId)) continue
    const current = state.hooks.find((item: any) => String(item.hookId) === hookId)
    if (current === undefined || current.status === 'superseded') continue
    assertHookTransition(String(current.status), 'superseded')
    push({ op: 'supersede', hookId, chapter: 0 })
    written += 1
  }
  return written
}

export function writeFoundationStage(root: any, input: any) {
  const workId = String(input.work)
  const stage = String(input.stage)
  if (!FOUNDATION_WRITE_STAGES.includes(stage)) throw new StoryError('foundation-stage-invalid', `未知的 foundation stage：${stage}`)
  const payload = input.payload ?? {}
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const state = foundationStateOf(db)
      if (stage !== 'frame' && stage !== 'design' && state.stages.frame !== true) {
        throw new StoryError('foundation-order', '先生成 frame（故事框架/卷图/当前焦点），再生成后续阶段')
      }
      if (stage === 'cards' && state.stages.roles !== true) {
        throw new StoryError('foundation-order', '先生成 roles 索引，再生成角色卡')
      }
      const at = now()
      const record = (artifactId: any, kind: any, content: any, source: any) => {
        const value = {
          workId,
          artifactId,
          kind,
          revisionId: artifactRevision(content),
          content,
          provenance: 'generated',
          createdAt: at,
        }
        const envelope = validateArtifactRecord(value)
        return { envelope, source, text: renderFoundationContent(content) }
      }
      let records
      /** Architect seed to plant after the artifacts land. */
      let seed: { hooks: any[], previous: any[] } | undefined
      if (stage === 'design') {
        const tokens = proposalTokensOf(root, workId)
        const frameText = `${String(payload.storyFrame ?? '')}\n${String(payload.volumeMap ?? '')}\n${String(payload.currentFocus ?? '')}`
        if (tokens.length > 0 && !tokens.some(token => frameText.includes(token))) {
          throw new StoryError('foundation-mismatch', '基础设定与提案没有一处对得上：提案里的关键人物或前提没有出现在故事框架里', '按提案重写基础设定，或先说明为什么改方向')
        }
        const focus = String(payload.currentFocus ?? '')
        if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
        const protagonist = String(payload.bookRules?.protagonist?.name ?? '').trim()
        const rulesFrameText = String(payload.storyFrame ?? '')
        if (protagonist !== '') {
          const proposal = acceptedProposalOf(root, workId)
          const known = new Set<string>()
          try {
            const list = JSON.parse(proposal?.characters ?? '[]')
            for (const item of Array.isArray(list) ? list : []) {
              const name = typeof item === 'string' ? item : item?.name
              if (typeof name === 'string' && name !== '') known.add(name)
            }
          } catch {}
          const frameNamesSomeone = [...known].some(name => rulesFrameText.includes(name))
          if (rulesFrameText !== '' && frameNamesSomeone && !rulesFrameText.includes(protagonist)) {
            throw new StoryError('foundation-inconsistent', `作品规则的主角「${protagonist}」没有出现在故事框架里`, '按框架改规则里的主角名；确实要换主角时，先说明为什么改方向')
          }
        }
        records = [
          record('bible:story_frame', 'story_frame', String(payload.storyFrame ?? ''), 'foundation/story_frame'),
          record('bible:volume_map', 'volume_map', String(payload.volumeMap ?? ''), 'foundation/volume_map'),
          record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
          record('bible:book_rules', 'book_rules', payload.bookRules, 'foundation/book_rules'),
          record('roles:index', 'role_index', payload.rolesIndex, 'foundation/roles/index'),
        ]
      } else if (stage === 'frame') {
        const tokens = proposalTokensOf(root, workId)
        const frameText = `${String(payload.storyFrame ?? '')}\n${String(payload.volumeMap ?? '')}\n${String(payload.currentFocus ?? '')}`
        if (tokens.length > 0 && !tokens.some(token => frameText.includes(token))) {
          throw new StoryError('foundation-mismatch', '基础设定与提案没有一处对得上：提案里的关键人物或前提没有出现在故事框架里', '按提案重写基础设定，或先说明为什么改方向')
        }
        const focus = String(payload.currentFocus ?? '')
        if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
        records = [
          record('bible:story_frame', 'story_frame', String(payload.storyFrame ?? ''), 'foundation/story_frame'),
          record('bible:volume_map', 'volume_map', String(payload.volumeMap ?? ''), 'foundation/volume_map'),
          record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
        ]
      } else if (stage === 'rules') {
        // The frame carries the protagonist the author confirmed; a rules-stage
        // name that never appears there means the stages drifted apart.
        const protagonist = String(payload.bookRules?.protagonist?.name ?? '').trim()
        if (protagonist !== '') {
          const frame = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:story_frame' ORDER BY rowid DESC LIMIT 1").get()
          const frameText = frame === undefined ? '' : String(frame.content)
          // Only judge when the frame actually names proposal people; a frame that
          // names nobody gives the guard nothing to compare against.
          const proposal = acceptedProposalOf(root, workId)
          const known = new Set<string>()
          try {
            const list = JSON.parse(proposal?.characters ?? '[]')
            for (const item of Array.isArray(list) ? list : []) {
              const name = typeof item === 'string' ? item : item?.name
              if (typeof name === 'string' && name !== '') known.add(name)
            }
          } catch {
            // A malformed proposal list is not this guard's to report.
          }
          const frameNamesSomeone = [...known].some(name => frameText.includes(name))
          if (frameText !== '' && frameNamesSomeone && !frameText.includes(protagonist)) {
            throw new StoryError(
              'foundation-inconsistent',
              `作品规则的主角「${protagonist}」没有出现在故事框架里`,
              '按框架改规则里的主角名；确实要换主角时，先说明为什么改方向',
            )
          }
        }
        records = [record('bible:book_rules', 'book_rules', payload.bookRules, 'foundation/book_rules')]
      } else if (stage === 'roles') {
        records = [record('roles:index', 'role_index', payload.rolesIndex, 'foundation/roles/index')]
      } else if (stage === 'hooks') {
        const hooks = validateInitialHooks(payload.pendingHooks)
        seed = { hooks, previous: initialHooksSeedOf(db) }
        records = [record('bible:hooks', 'hooks', initialHooksArtifact(hooks), 'foundation/hooks')]
      } else {
        const cards = Array.isArray(payload.roleCards) ? payload.roleCards : []
        if (cards.length === 0) throw new StoryError('artifact-invalid', '角色卡至少需要一张')
        const index = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'roles:index' ORDER BY rowid DESC LIMIT 1").get()
        const tiers = index === undefined ? new Map<string, string>() : indexTiersOf(JSON.parse(String(index.content)))
        if (tiers.size === 0) throw new StoryError('artifact-invalid', '还没有 roles 索引：先跑 roles 阶段')
        const names = new Set()
        const slugs = new Set()
        records = cards.map((card: any) => {
          const name = String(card?.name ?? '')
          if (!tiers.has(name)) {
            throw new StoryError('artifact-invalid', `角色卡 ${name} 不在 roles 索引里`)
          }
          if (card?.tier !== tiers.get(name)) {
            throw new StoryError('artifact-invalid', `角色卡 ${name} 的 tier 必须等于索引里的 ${tiers.get(name)}`)
          }
          const slug = String(card?.slug ?? '').trim()
          if (names.has(name) || slugs.has(slug)) {
            throw new StoryError('artifact-invalid', `角色卡重复：${name}/${slug}`)
          }
          names.add(name)
          slugs.add(slug)
          return record(`role:${slug}`, 'role_card', card, `foundation/roles/${slug}`)
        })
        for (const [name] of tiers) {
          if (!names.has(name)) throw new StoryError('artifact-invalid', `角色卡缺少索引人物：${name}`)
        }
        // Name is the identity; a rerun with a new slug replaces the old card in
        // the same transaction so one person never has two cards.
        const existingCards = latestRoleCardsOnDb(db)
        const slugByName = new Map<string, string>(cards.map((item: any) => [String(item?.name ?? ''), String(item?.slug ?? '').trim()]))
        const nameBySlug = new Map<string, string>(cards.map((item: any) => [String(item?.slug ?? '').trim(), String(item?.name ?? '')]))
        for (const row of existingCards) {
          let old: any
          try { old = JSON.parse(String(row.content)) } catch { continue }
          const oldName = String(old?.name ?? '')
          const oldSlug = String(old?.slug ?? '')
          if (slugs.has(oldSlug) && nameBySlug.get(oldSlug) !== oldName) {
            throw new StoryError('artifact-invalid', `slug 已被其他姓名占用：${oldSlug}`)
          }
          if (names.has(oldName) && String(row.artifact_id) !== `role:${slugByName.get(oldName) ?? ''}`) {
            // Same person moved to a new slug: the old card is replaced.
            deleteArtifactOnDb(db, String(row.artifact_id))
          }
        }
      }
      let anyWritten = false
      const artifacts = records.map(({ envelope, source, text }: any) => {
        const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
          .get(envelope.artifactId, envelope.revisionId)
        if (existing === undefined) {
          putArtifactOnDb(db, envelope, { search: { docId: envelope.artifactId, kind: envelope.kind, source, text } })
          anyWritten = true
        }
        return { artifactId: envelope.artifactId, revisionId: envelope.revisionId, kind: envelope.kind }
      })
      if (stage === 'roles' || stage === 'design') {
        // The index is the person list and the tier authority; stale cards go.
        dropRoleCardsOnDb(db, indexTiersOf(payload.rolesIndex))
      }
      if (seed !== undefined) {
        seedFoundationHooksOnDb(db, { hooks: seed.hooks, previous: seed.previous, at })
      }
      return { workId, stage, artifacts, foundation: foundationStateOf(db) }
    })
  } finally {
    db.close()
  }
}

/** Land all four architect phases in one transaction; any failure leaves no artifact. */
export function writeFoundationBundle(root: any, input: any) {
  const workId = String(input.work)
  const phases = input.phases ?? {}
  const outline = phases.outline ?? {}
  const details = phases.details ?? {}
  const castIndex = phases.cast_index ?? {}
  const cardPhase = phases.cards ?? {}
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const at = now()
      const record = (artifactId: any, kind: any, content: any, source: any) => {
        const value = {
          workId, artifactId, kind,
          revisionId: artifactRevision(content), content, provenance: 'generated', createdAt: at,
        }
        return { envelope: validateArtifactRecord(value), source, text: renderFoundationContent(content) }
      }
      const initialHooks = validateInitialHooks(details.pendingHooks)
      const previousHooks = initialHooksSeedOf(db)
      const frameText = `${String(outline.storyFrame ?? '')}\n${String(outline.volumeMap ?? '')}\n${String(outline.currentFocus ?? '')}`
      const tokens = proposalTokensOf(root, workId)
      if (tokens.length > 0 && !tokens.some(token => frameText.includes(token))) {
        throw new StoryError('foundation-mismatch', '基础设定与提案没有一处对得上：提案里的关键人物或前提没有出现在故事框架里', '按提案重写基础设定，或先说明为什么改方向')
      }
      const focus = String(outline.currentFocus ?? '')
      if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
      const protagonist = String(details.bookRules?.protagonist?.name ?? '').trim()
      const rulesFrameText = String(outline.storyFrame ?? '')
      if (protagonist !== '') {
        const proposal = acceptedProposalOf(root, workId)
        const known = new Set<string>()
        try {
          const list = JSON.parse(proposal?.characters ?? '[]')
          for (const item of Array.isArray(list) ? list : []) {
            const name = typeof item === 'string' ? item : item?.name
            if (typeof name === 'string' && name !== '') known.add(name)
          }
        } catch {}
        if (rulesFrameText !== '' && [...known].some(name => rulesFrameText.includes(name)) && !rulesFrameText.includes(protagonist)) {
          throw new StoryError('foundation-inconsistent', `作品规则的主角「${protagonist}」没有出现在故事框架里`, '按框架改规则里的主角名；确实要换主角时，先说明为什么改方向')
        }
      }
      const baseRecords = [
        record('bible:story_frame', 'story_frame', String(outline.storyFrame ?? ''), 'foundation/story_frame'),
        record('bible:volume_map', 'volume_map', String(outline.volumeMap ?? ''), 'foundation/volume_map'),
        record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
        record('bible:book_rules', 'book_rules', details.bookRules, 'foundation/book_rules'),
        record('bible:hooks', 'hooks', initialHooksArtifact(initialHooks), 'foundation/hooks'),
        record('roles:index', 'role_index', castIndex.rolesIndex, 'foundation/roles/index'),
      ]
      const tiers = indexTiersOf(castIndex.rolesIndex)
      const cards = Array.isArray(cardPhase.roleCards) ? cardPhase.roleCards : []
      if (cards.length === 0) throw new StoryError('artifact-invalid', '角色卡至少需要一张')
      const names = new Set<string>()
      const slugs = new Set<string>()
      const cardRecords = cards.map((card: any) => {
        const name = String(card?.name ?? '')
        if (!tiers.has(name)) throw new StoryError('artifact-invalid', `角色卡 ${name} 不在 roles 索引里`)
        if (card?.tier !== tiers.get(name)) throw new StoryError('artifact-invalid', `角色卡 ${name} 的 tier 必须等于索引里的 ${tiers.get(name)}`)
        const slug = String(card?.slug ?? '').trim()
        if (names.has(name) || slugs.has(slug)) throw new StoryError('artifact-invalid', `角色卡重复：${name}/${slug}`)
        names.add(name); slugs.add(slug)
        return record(`role:${slug}`, 'role_card', card, `foundation/roles/${slug}`)
      })
      for (const [name] of tiers) if (!names.has(name)) throw new StoryError('artifact-invalid', `角色卡缺少索引人物：${name}`)
      const existingCards = latestRoleCardsOnDb(db)
      const slugByName = new Map<string, string>(cards.map((item: any) => [String(item?.name ?? ''), String(item?.slug ?? '').trim()]))
      const nameBySlug = new Map<string, string>(cards.map((item: any) => [String(item?.slug ?? '').trim(), String(item?.name ?? '')]))
      for (const row of existingCards) {
        let old: any
        try { old = JSON.parse(String(row.content)) } catch { continue }
        const oldName = String(old?.name ?? '')
        const oldSlug = String(old?.slug ?? '')
        if (slugs.has(oldSlug) && nameBySlug.get(oldSlug) !== oldName) {
          throw new StoryError('artifact-invalid', `slug 已被其他姓名占用：${oldSlug}`)
        }
        if (names.has(oldName) && String(row.artifact_id) !== `role:${slugByName.get(oldName) ?? ''}`) {
          deleteArtifactOnDb(db, String(row.artifact_id))
        }
      }
      const artifacts = []
      for (const item of baseRecords) {
        if (db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?').get(item.envelope.artifactId, item.envelope.revisionId) === undefined) {
          putArtifactOnDb(db, item.envelope, { search: { docId: item.envelope.artifactId, kind: item.envelope.kind, source: item.source, text: item.text } })
        }
        artifacts.push({ artifactId: item.envelope.artifactId, revisionId: item.envelope.revisionId, kind: item.envelope.kind })
      }
      dropRoleCardsOnDb(db, tiers)
      for (const item of cardRecords) {
        if (db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?').get(item.envelope.artifactId, item.envelope.revisionId) === undefined) {
          putArtifactOnDb(db, item.envelope, { search: { docId: item.envelope.artifactId, kind: item.envelope.kind, source: item.source, text: item.text } })
        }
        artifacts.push({ artifactId: item.envelope.artifactId, revisionId: item.envelope.revisionId, kind: item.envelope.kind })
      }
      seedFoundationHooksOnDb(db, { hooks: initialHooks, previous: previousHooks, at })
      const foundation = foundationStateOf(db)
      if (!foundation.complete) throw new StoryError('foundation-incomplete', '基础设定 bundle 写入后仍不完整')
      return { workId, stage: 'foundation', artifacts, foundation }
    })
  } finally { db.close() }
}

/** Author confirmation of a complete foundation; panel-only in the product. */
export function approveFoundation(root: any, input: any) {
  const db = openWork(root, String(input.work))
  try {
    return transaction(db, () => {
      const state = foundationStateOf(db)
      if (state.complete !== true) throw new StoryError('foundation-incomplete', 'foundation 还没生成完整：先跑完 foundation（框架/规则/初始伏笔/角色索引/角色卡）')
      const at = now()
      const source = approvalSourceOf(input)
      db.prepare('UPDATE meta SET foundation_approved_at = ?, foundation_approved_revision = ?, foundation_approved_source = ?, foundation_approved_reason = ?, updated_at = ? WHERE id = 1').run(at, foundationRevisionOf(db), source, approvalReasonOf(input), at)
      return { workId: String(input.work), approvedAt: at, foundation: foundationStateOf(db) }
    })
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
export function nextStep(root: any, work: any) {
  const manifest = readManifest(root, work)
  const plannerDelegate = formOf(manifest) === 'longform' ? { delegate: { role: 'planner' } } : {}
  const db = openWork(root, manifest.workId)
  try {
    const hasPlan = (number: any) => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(`plan:${number}`) !== undefined
    const summaryOf = (number: any) => summaryStateOf(db, number)
    const chapters = manifest.chapters
    // A reopened earlier chapter must be finished before later ones; otherwise the
  // flow keeps targeting the last chapter as before.
  const reopened = new Set<number>()
  for (const event of db.prepare("SELECT chapter, kind FROM events WHERE kind IN ('reopen', 'settle') ORDER BY seq").all()) {
    if (event.chapter === null || event.chapter === undefined) continue
    if (event.kind === 'reopen') reopened.add(Number(event.chapter))
    else reopened.delete(Number(event.chapter))
  }
  const reopenedChapter = chapters.find((entry: any) => reopened.has(entry.number) && entry.stage !== 'settled')
  const last = chapters.length === 0 ? undefined : (reopenedChapter ?? chapters[chapters.length - 1])
    const chapter = last === undefined ? 1 : last.number
    const outline = manifest.outline
    let candidate
    const step = (() => {
      if (last === undefined) {
        if (outline === undefined || outline.writtenAt === undefined) {
          if (formOf(manifest) === 'longform') {
            const foundation = foundationStateOf(db)
            if (foundation.complete !== true) {
              const dispatchStage = foundation.dispatchStage
              return {
                chapter, stage: 'planned', action: 'story_architect', foundationStage: dispatchStage,
                reason: `还没有基础设定（${dispatchStage}）：让 architect 生成故事框架、规则与角色，再写全书计划`,
                missing: [`foundation:${dispatchStage}`],
              }
            }
            if (foundation.approvedAt === undefined) {
              return {
                chapter, stage: 'planned', action: 'story_architect',
                reason: '基础设定已生成，等作者确认（面板「基础设定」或会话里的 story_approve），再写全书计划',
                blocked: ['foundation-approval'],
              }
            }
          }
          return {
            chapter, stage: 'planned', action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向，等作者确认', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter, stage: 'planned', action: 'story_plan',
            reason: '全书计划等作者确认：在面板点「确认全书计划」，然后写第 1 章章纲',
            blocked: ['outline-approval'],
          }
        }
        return { chapter, stage: 'planned', action: 'story_plan', reason: '还没有任何章节：先写第 1 章章纲', missing: [], ...plannerDelegate }
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
        if (outline === undefined || outline.writtenAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_plan',
            reason: '全书计划等作者确认：先在面板点「确认全书计划」，再写下一章章纲', blocked: ['outline-approval'],
          }
        }
        return { chapter: next, stage: 'planned', action: 'story_plan', reason: `第 ${last.number} 章已定稿：写第 ${next} 章章纲`, missing: [], ...plannerDelegate }
      }
      if (!hasPlan(last.number)) {
        if (outline === undefined || outline.writtenAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_plan',
            reason: '全书计划等作者确认：在面板点「确认全书计划」，再写章纲', blocked: ['outline-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_plan', reason: `第 ${last.number} 章缺章纲`, missing: [], ...plannerDelegate }
      }
      if (!hasBody) {
        if (planApprovalPolicy(manifest) === 'required' && last.planApproved !== true) {
          return {
            chapter: last.number, stage, action: 'story_write',
            reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」，然后写正文`,
            missing: ['body'], blocked: ['plan-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_write', reason: `第 ${last.number} 章已有章纲，写正文`, missing: ['body'] }
      }
      // An unconfirmed plan wins over any chapter step: revising or re-reviewing
      // under a plan the author has not accepted would write against a draft.
      if (hasPlan(last.number) && planApprovalPolicy(manifest) === 'required' && last.planApproved !== true) {
        return {
          chapter: last.number, stage, action: 'story_plan',
          reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」`,
          missing: [], blocked: ['plan-approval'],
        }
      }
      if (stage === 'written') {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      candidate = latestReviewRow(db, last.number)
      if (!reviewCovers(candidate, last)) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      if (isCleanReview(candidate) && candidate.revision !== last.currentRevision) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章的清稿审稿针对旧版本 r${candidate.revision}：先重新审稿`, missing: ['review'] }
      }
      const blocked = {}
      const open = openObservations(candidate)
      if (open.length > 0) {
        const rounds = revisionRounds(last.currentRevision)
        if (rounds >= MAX_REVISION_ROUNDS) {
          return {
            chapter: last.number, stage, action: 'story_revise',
            reason: `第 ${last.number} 章已修订 ${rounds} 轮（上限 ${MAX_REVISION_ROUNDS}），仍有 ${open.length} 条未处理审稿：请作者裁决（接受当前版本，或说明继续修订）`,
            missing: open.map((item: any) => item.id),
            ...blocked,
            blocked: ['revision-limit', ...((blocked as { blocked?: string[] }).blocked ?? [])],
          }
        }
        return {
          chapter: last.number, stage, action: 'story_revise',
          reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map((item: any) => item.id), ...blocked,
        }
      }
      const draftRow = db.prepare("SELECT content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(last.number)
      const draft = draftRow === undefined ? undefined : JSON.parse(String(draftRow.content))
      const draftCurrent = draft !== undefined && Number(draft.revision) === Number(last.currentRevision)
      if (draftCurrent && draft.ready !== true) {
        return {
          chapter: last.number, stage, action: 'story_apply_draft',
          reason: `第 ${last.number} 章的状态草案等作者确认：接受草案或先改状态`,
          missing: [],
        }
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
      if (draftCurrent && draft.ready === true) {
        return {
          chapter: last.number, stage, action: 'story_finalize',
          reason: `第 ${last.number} 章状态已就绪：定稿（应用草案并入账）`,
          missing: [],
        }
      }
      return { chapter: last.number, stage, action: 'story_settle', reason: isCleanReview(candidate) ? `第 ${last.number} 章清稿审稿无问题：结算状态` : `第 ${last.number} 章已修订：结算状态`, missing: [] }
    })()
    const delegate = delegateOf(step, last, candidate)
    const method = methodFor(step, formOf(manifest))
    const planMemo = (step.blocked ?? []).includes('plan-approval')
      ? planMemoFrom(db, step.chapter)
      : undefined
    const foundationSummary = (step.blocked ?? []).includes('foundation-approval') ? foundationSummaryOf(db) : undefined
    const ask = askFor(step, last, candidate, planMemo, foundationSummary)
    return {
      workId: manifest.workId,
      ...step,
      form: formOf(manifest),
      unit: unitOf(formOf(manifest)),
      ...(delegate === undefined ? {} : { delegate }),
      ...(ask === undefined ? {} : { ask }),
      ...(method === undefined ? {} : { method }),
    }
  } finally {
    db.close()
  }
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




// ---------------------------------------------------------------------------
// Truth files and chapter plans, read sides
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Truth files: characters stay in the bible table; the four editable text
// entries are artifacts (world/style/intent) plus the approved book plan
// (outline). They share one read/write surface here.
// ---------------------------------------------------------------------------



/**
 * Read one work's events as the JSONL text the folding helpers consume.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {string} event log text.
 */
export function readEventsText(root: any, work: any) {
  const db = openWork(root, work)
  try {
    return eventsText(db)
  } finally {
    db.close()
  }
}

/**
 * Project one work's event log into hooks and facts.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {{beforeChapter?: number}} [options] - project only events before this target chapter.
 * @returns {{hooks: object[], facts: object[]}} projected state.
 */
export function readFoldedState(root: any, work: any, options: { beforeChapter?: number } = {}) {
  const before = Number.isInteger(options.beforeChapter) ? Number(options.beforeChapter) : undefined
  if (before === undefined) return projectState(readEvents(root, work))
  if (before <= 1) return projectState([])
  const events = readEvents(root, work, before - 1)
  const reopened = new Map(events
    .filter(event => event.kind === 'reopen')
    .map(event => [event.chapter, event.seq]))
  return projectState(events.filter(event => event.seq > Number(reopened.get(event.chapter) ?? -1)))
}

/**
 * Read one chapter plan text.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {string|undefined} plan text.
 */
export function readPlan(root: any, work: any, chapter: any) {
  const memo = readPlanMemo(root, work, chapter)
  return memo === undefined ? undefined : renderChapterMemo(memo)
}

/**
 * Read one chapter plan memo without round-tripping through rendered Markdown.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {object|undefined} structured memo.
 */
export function readPlanMemo(root: any, work: any, chapter: any) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    const row = db.prepare(`SELECT content_type, content FROM artifacts
      WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${number}`)
    if (row === undefined) return undefined
    if (row.content_type !== 'json') throw new StoryError('artifact-invalid', `plan:${number} 不是结构化 memo`)
    try {
      return JSON.parse(String(row.content))
    } catch {
      throw new StoryError('artifact-invalid', `plan:${number} 的 memo JSON 无法解析`)
    }
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
export function listBodies(root: any, work: any) {
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
export function reopenChapter(root: any, input: any) {
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
      const seq = Number((db.prepare('SELECT max(seq) AS n FROM events').get() as { n: number } | undefined)?.n ?? 0) + 1
      db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
        .run(seq, at, number, 'reopen', JSON.stringify({ kind: 'reopen', revision: entry.current_revision }))
      db.prepare("UPDATE chapters SET stage = 'written', status = 'written', updated_at = ? WHERE number = ?").run(at, number)
      invalidateStateDraftOnDb(db, number)
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

/** Rewrite chapter/summary/event search documents for one remap. */
function rewriteChapterDocs(db: any, mapping: any) {
  if (mapping.size === 0) {
    db.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
    return
  }
  const rows = db.prepare(`SELECT rowid, doc_id, kind, chapter, source FROM search_docs
    WHERE kind IN ('chapter', 'summary') OR doc_id LIKE 'event:%'`).all()
  const changed = rows.filter((row: any) => mapping.has(row.chapter))
  for (const row of changed) {
    db.prepare('UPDATE search_docs SET doc_id = ? WHERE rowid = ?').run(`tmp:${row.rowid}`, row.rowid)
  }
  for (const row of changed) {
    const next = mapping.get(row.chapter)
    let docId = row.doc_id
    let source = row.source
    if (row.kind === 'chapter') {
      docId = row.doc_id.replace(/^chapter:\d+:/u, `chapter:${next}:`)
      source = `chapters/${chapterStem(next)}`
    } else if (row.kind === 'summary') {
      docId = `summary:${next}`
      source = `summaries/${chapterStem(next)}`
    }
    db.prepare('UPDATE search_docs SET doc_id = ?, source = ?, chapter = ? WHERE rowid = ?')
      .run(docId, source, next, row.rowid)
  }
  db.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
}

/** Apply one old→new map to every chapter-number reference. */
function applyChapterMapping(db: any, mapping: any) {
  if (mapping.size === 0) return
  db.exec('PRAGMA defer_foreign_keys = ON')
  for (const table of ['chapters', 'chapter_versions']) {
    for (const [oldNumber, newNumber] of mapping) {
      db.prepare(`UPDATE ${table} SET number = ? WHERE number = ?`).run(-newNumber, oldNumber)
    }
    db.exec(`UPDATE ${table} SET number = -number WHERE number < 0`)
  }
  for (const [oldNumber, newNumber] of mapping) {
    db.prepare('UPDATE events SET chapter = ? WHERE chapter = ?').run(-newNumber, oldNumber)
  }
  db.exec('UPDATE events SET chapter = -chapter WHERE chapter < 0')
  for (const [oldNumber, newNumber] of mapping) {
    if (oldNumber === newNumber) continue
    db.prepare('UPDATE chapters SET plan_approved_at = NULL, plan_revision = NULL WHERE number = ?').run(newNumber)
  }
}

/** Volumes whose endpoints no longer exist or whose range is invalid. */
function staleVolumesOf(db: any) {
  const keys = new Set(db.prepare('SELECT number FROM chapters').all().map((row: any) => row.number))
  return db.prepare('SELECT id, from_ch, to_ch FROM volumes ORDER BY from_ch').all()
    .filter((row: any) => !keys.has(row.from_ch) || !keys.has(row.to_ch) || row.from_ch > row.to_ch)
    .map((row: any) => row.id)
}

/** All existing chapter numbers, sorted. */
function chapterKeys(db: any) {
  return db.prepare('SELECT number FROM chapters ORDER BY number').all().map((row: any) => row.number)
}

/**
 * Delete one chapter and renumber survivors by rank.
 * @param {string} root - workspace.
 * @param {string} work - work id.
 * @param {number|string} chapter - chapter number.
 * @param {{confirm?: boolean, beforeCommit?: Function}} [options] - confirmation/test seam.
 * @returns {Promise<object>} edit receipt.
 */
/** Drop the drafts of the given chapters and reset only their readiness. */
function dropStateDraftsForOnDb(db: any, numbers: number[]): void {
  const unique = [...new Set(numbers.filter(number => Number.isInteger(number)))]
  if (unique.length === 0) return
  const placeholders = unique.map(() => '?').join(', ')
  for (const row of db.prepare(`SELECT artifact_id FROM artifacts WHERE kind = 'state_draft' AND scope_chapter IN (${placeholders})`).all(...unique)) {
    dropSearchDoc(db, String(row.artifact_id))
  }
  db.prepare(`DELETE FROM artifacts WHERE kind = 'state_draft' AND scope_chapter IN (${placeholders})`).run(...unique)
  db.prepare(`UPDATE chapters SET state_ready_revision = 0 WHERE number IN (${placeholders})`).run(...unique)
}

export async function deleteChapter(root: any, work: any, chapter: any, options: any = {}) {
  const number = chapterNumber(chapter)
  if (options.confirm !== true) throw new StoryError('chapter-delete-unconfirmed', '删除章节需要确认')
  const probe = openWork(root, work)
  let keys
  let mapping
  try {
    keys = chapterKeys(probe)
    if (!keys.includes(number)) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    mapping = chapterRemap(keys, { type: 'delete', chapter: number })
    const affected = [number, ...[...mapping.entries()].filter(([oldNumber, newNumber]) => oldNumber !== newNumber).map(([oldNumber]) => oldNumber)]
    const settled = probe.prepare(`SELECT stage FROM chapters WHERE number IN (${affected.map(() => '?').join(', ')})`).all(...affected)
    if (settled.some(row => row.stage === 'settled')) throw new StoryError('chapter-settled', '受影响章节中有已定稿章：先 reopen 再删/移')
  } finally {
    probe.close()
  }
  await backupWork(root, work, { materials: false })
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const oldMax = Number(db.prepare('SELECT max(seq) AS seq FROM events').get()?.seq ?? 0)
      db.prepare('DELETE FROM chapters WHERE number = ?').run(number)
      db.prepare('DELETE FROM events WHERE chapter = ?').run(number)
      for (const row of db.prepare("SELECT doc_id AS docId FROM search_docs WHERE (kind IN ('chapter', 'summary') AND chapter = ?) OR (doc_id LIKE 'event:%' AND chapter = ?)").all(number, number) as { docId: string }[]) {
        dropSearchDoc(db, row.docId)
      }
      applyChapterMapping(db, mapping)
      remapChapterArtifacts(db, { mapping, deleted: [number] })
      const movedPairs = [...mapping.entries()].filter(([oldNumber, newNumber]) => newNumber !== undefined && oldNumber !== newNumber)
      dropStateDraftsForOnDb(db, [number, ...movedPairs.flat()])
      rewriteChapterDocs(db, mapping)
      const survivors = chapterKeys(db)
      db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
        .run(oldMax + 1, now(), survivors.length === 0 ? 0 : 1, 'chapter-edit', JSON.stringify({ deleted: number }))
      touchMeta(db)
      if (typeof options.beforeCommit === 'function') options.beforeCommit(db)
      return {
        changed: true,
        deleted: number,
        chapters: survivors,
        staleVolumes: staleVolumesOf(db),
        backup: true,
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Move one chapter to its adjacent rank neighbor.
 * @param {string} root - workspace.
 * @param {string} work - work id.
 * @param {number|string} from - chapter number.
 * @param {number|string} to - adjacent chapter number.
 * @param {{beforeCommit?: Function}} [options] - test seam.
 * @returns {Promise<object>} edit receipt.
 */
export async function moveChapter(root: any, work: any, from: any, to: any, options: any = {}) {
  const source = chapterNumber(from)
  const target = chapterNumber(to)
  const db = openWork(root, work)
  try {
    const keys = chapterKeys(db)
    if (!keys.includes(source) || !keys.includes(target)) throw new StoryError('chapter-not-found', '要移动的章节不存在')
    if (source === target) return { changed: false, chapters: keys, staleVolumes: [] }
    const fromIndex = keys.indexOf(source)
    const toIndex = keys.indexOf(target)
    if (Math.abs(fromIndex - toIndex) !== 1) {
      throw new StoryError('chapter-edit-target-invalid', '只能移动到相邻章')
    }
    const staged = db.prepare('SELECT stage FROM chapters WHERE number IN (?, ?)').all(source, target)
    if (staged.some(row => row.stage === 'settled')) throw new StoryError('chapter-settled', '受影响章节中有已定稿章：先 reopen 再删/移')
    const mapping = chapterRemap(keys, { type: 'move', from: source, to: target })
    await backupWork(root, work, { materials: false })
    return transaction(db, () => {
      applyChapterMapping(db, mapping)
      remapChapterArtifacts(db, { mapping })
      const movedPairs = [...mapping.entries()].filter(([oldNumber, newNumber]) => newNumber !== undefined && oldNumber !== newNumber)
      dropStateDraftsForOnDb(db, movedPairs.flat())
      rewriteChapterDocs(db, mapping)
      touchMeta(db)
      if (typeof options.beforeCommit === 'function') options.beforeCommit(db)
      return {
        changed: true,
        chapters: chapterKeys(db),
        staleVolumes: staleVolumesOf(db),
      }
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


// ---------------------------------------------------------------------------
// Export and backup
// ---------------------------------------------------------------------------

/** Export format version, independent of the work database schema version. */
const EXPORT_SCHEMA_VERSION = 6

/** Render the export manifest from the catalog row and the work database. */
function exportManifest(root: any, workId: any, catalogRowValue: any, db: any) {
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
      approvedAt: outlineApprovedAt(db) ?? null,
    },
    chapters: chapters.map((chapter: any) => {
      const summary = summaryStateFrom(summaryStates, chapter.number)
      return {
        number: chapter.number,
        title: chapter.title,
        status: chapter.status,
        stage: chapter.stage,
        currentRevision: chapter.current_revision,
        words: chapter.words,
        planApprovedAt: planApprovalState(db, chapter.number).approved ? chapter.plan_approved_at : null,
        planRevision: chapter.plan_revision,
        provenance: chapter.provenance,
        summaryRevision: summary.revision,
        summaryStale: summary.state === 'stale',
      }
    }),
    materials: materials.map((row: any) => ({
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
function oneLine(value: any) {
  return String(value ?? '').replace(/\r\n?|\n/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** One snapshot of current chapter revisions, shared by TXT and EPUB. */
function currentChapters(db: any) {
  return db.prepare('SELECT * FROM chapters WHERE current_revision > 0 ORDER BY number').all()
    .map((chapter: any) => {
      const version = currentVersion(db, chapter)
      if (version === undefined) {
        throw new StoryError('export-failed', `第 ${chapter.number} 章缺少当前正文版本，无法导出`)
      }
      return { number: chapter.number, title: chapter.title, body: version.body }
    })
}

/** Render the single-file readable book from a chapter snapshot. */
function bookText(title: any, chapters: any) {
  const parts = [oneLine(title) || '未命名']
  for (const chapter of chapters) {
    const heading = oneLine(chapter.title)
    parts.push(`第 ${chapter.number} 章${heading === '' ? '' : ` ${heading}`}`)
    parts.push(String(chapter.body ?? '').replace(/\r\n?|\n/gu, '\n').replace(/\n+$/u, ''))
  }
  return `${parts.join('\n\n')}\n`
}

/** `ch-0007` / `ch-0007.r2`. */
function versionStem(number: any, revision: any) {
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
export function exportWork(root: string, work: unknown, destination?: string): any {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    try {
      const target = destination ?? join(exportsDir(root), row.work_id)
      if (destination === undefined && existsSync(target)) rmSync(target, { recursive: true, force: true })
      const files: any = []
      const put = (relative: any, data: any) => {
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
          String(version.body).endsWith('\n') ? String(version.body) : `${String(version.body)}\n`)
      }
      for (const memo of db.prepare(`SELECT a.artifact_id, a.content FROM artifacts a
        JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts
          WHERE kind = 'plan' GROUP BY artifact_id) latest ON a.rowid = latest.rowid
        WHERE a.kind = 'plan' AND a.scope_chapter IS NOT NULL ORDER BY a.scope_chapter`).all()) {
        const chapter = Number(String(memo.artifact_id).slice('plan:'.length))
        let content
        try {
          content = JSON.parse(String(memo.content))
        } catch {
          throw new StoryError('artifact-invalid', `${memo.artifact_id} 的 memo JSON 无法解析`)
        }
        put(join('outline', `${chapterStem(chapter)}.plan.md`), renderChapterMemo(content))
      }
      for (const summary of exportSummaryRows(db)) {
        put(join('summaries', `${chapterStem(summary.number)}.md`), summary.text)
      }
      for (const row of db.prepare(`SELECT artifact_id, content FROM artifacts
        WHERE kind = 'review' ORDER BY scope_chapter, rowid`).all()) {
        const match = /^review:(\d+):r(\d+):(\d+)$/u.exec(String(row.artifact_id))
        if (match === null) continue
        const number = Number(match[1])
        const content = JSON.parse(String(row.content))
        put(join('reviews', `${chapterStem(number)}.r${Number(match[3])}.json`), `${JSON.stringify(content, null, 2)}\n`)
        put(join('reviews', `${chapterStem(number)}.r${Number(match[3])}.md`), renderReviewMarkdown(number, {
          round: Number(match[3]),
          revision: Number(match[2]),
          observations: Array.isArray(content.observations) ? content.observations : [],
        }))
      }
      const characters = db.prepare('SELECT content FROM bible WHERE name = ?').get('characters')
      if (characters !== undefined) put(join('bible', 'characters.json'), String(characters.content))
      for (const [name, truth] of Object.entries(TRUTH_ARTIFACTS)) {
        const entry = readTextArtifactOnDb(db, truth.artifactId)
        if (entry === undefined) continue
        if (name === 'plan') put(join('outline', 'plan.md'), entry.content)
        else put(join('bible', `${name}.md`), entry.content)
      }
      for (const [name, document] of Object.entries(FOUNDATION_DOCUMENTS)) {
        const row = db.prepare('SELECT content_type, content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
          .get(document.artifactId)
        if (row === undefined) continue
        const content = row.content_type === 'json' ? JSON.parse(String(row.content)) : String(row.content)
        const file = name === 'roles_index' ? null : `foundation/${name}.md`
        if (file !== null) put(file, renderFoundationContent(content))
      }
      const focus = readTextArtifactOnDb(db, 'bible:current_focus')
      if (focus !== undefined) put(join('foundation', 'current_focus.md'), focus.content)
      const hooksDocument = db.prepare('SELECT content_type, content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
        .get('bible:hooks')
      if (hooksDocument !== undefined) {
        // The seed snapshot; current hooks stay in state/events.jsonl.
        const content = hooksDocument.content_type === 'json' ? JSON.parse(String(hooksDocument.content)) : String(hooksDocument.content)
        put(join('foundation', 'hooks.md'), `${renderFoundationContent(content).trimEnd()}\n`)
      }
      const rolesIndex = db.prepare(`SELECT content_type, content FROM artifacts
        WHERE artifact_id = 'roles:index' ORDER BY rowid DESC LIMIT 1`).get()
      if (rolesIndex !== undefined) {
        const content = rolesIndex.content_type === 'json' ? JSON.parse(String(rolesIndex.content)) : String(rolesIndex.content)
        put(join('foundation', 'roles', 'index.json'), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
      }
      const roleCards = db.prepare(`SELECT a.artifact_id, a.content_type, a.content FROM artifacts a
        JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts
          WHERE kind = 'role_card' GROUP BY artifact_id) latest ON a.rowid = latest.rowid
        ORDER BY a.artifact_id`).all()
      for (const row of roleCards) {
        const slug = String(row.artifact_id).slice('role:'.length)
        const content = row.content_type === 'json' ? JSON.parse(String(row.content)) : String(row.content)
        const text = typeof content === 'object' && content !== null && typeof content.markdown === 'string'
          ? content.markdown
          : (typeof content === 'string' ? content : JSON.stringify(content))
        put(join('foundation', 'roles', `${slug}.md`), text)
      }
      put('volumes.json', `${JSON.stringify(db.prepare('SELECT * FROM volumes ORDER BY from_ch').all(), null, 2)}\n`)
      put('state/events.jsonl', `${db.prepare('SELECT * FROM events ORDER BY seq').all()
        .map(event => JSON.stringify({ seq: event.seq, at: event.at, chapter: event.chapter, kind: event.kind, ...JSON.parse(String(event.payload)) }))
        .join('\n')}\n`)
      for (const material of db.prepare('SELECT * FROM materials ORDER BY created_at, id').all()) {
        if (material.format === 'epub' || material.format === 'pdf') {
          const source = join(root, '.storycraft', String(material.origin))
          if (!existsSync(source)) throw new StoryError('material-origin-missing', `素材 ${material.id} 的原文件不存在：${material.origin}`)
          const data = readFileSync(source)
          if (createHash('sha256').update(data).digest('hex') !== String(material.hash)) {
            throw new StoryError('material-origin-corrupt', `素材 ${material.id} 的原文件校验失败`)
          }
          put(join('materials', `${material.id}.${material.format}`), data)
        } else {
          put(join('materials', `${material.id}.${material.format}`), String(material.content))
        }
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
export async function exportWorkAtomic(root: string, work: unknown, options: any = {}): Promise<any> {
  const rename = typeof options.rename === 'function' ? options.rename : renameSync
  const remove = typeof options.remove === 'function' ? options.remove : rmSync
  const write = typeof options.exportTree === 'function' ? options.exportTree : exportWork
  const key = `${root}\0${work}`
  const previous = exportLocks.get(key) ?? Promise.resolve()
  let release!: (value?: unknown) => void
  const gate = new Promise(resolve => { release = resolve })
  const tail = previous.then(() => gate)
  exportLocks.set(key, tail)
  await previous
  try {
    const directory = exportsDir(root)
    try {
      mkdirSync(directory, { recursive: true })
    } catch (error: any) {
      throw new StoryError('export-failed', `导出目录无法创建：${error instanceof Error ? error.message : String(error)}`)
    }
    const token = createHash('sha256').update(String(work)).digest('hex').slice(0, 12)
    const target = join(directory, String(work))
    const stamp = Date.now()
    const stage = join(directory, `.tmp-${token}-${stamp}-${randomUUID().slice(0, 8)}`)
    const backup = join(directory, `.bak-${token}-${stamp}-${randomUUID().slice(0, 8)}`)
    const cleanup = (path: any) => {
      try {
        remove(path, { recursive: true, force: true })
      } catch {
        // Cleanup is best effort; it must not mask the original error.
      }
    }
    const fail = (message: any, cause: any) => new StoryError('export-failed', `${message}${cause === undefined ? '' : `：${cause}`}`)

    // A previous swap may have crashed between target→backup and stage→target.
    if (!existsSync(target)) {
      let entries
      try {
        entries = readdirSync(directory)
      } catch (error: any) {
        throw fail('导出目录无法读取', error instanceof Error ? error.message : String(error))
      }
      const backups = entries.filter(name => name.startsWith(`.bak-${token}-`)).sort()
      const last = backups.at(-1)
      if (last !== undefined) {
        try {
          rename(join(directory, last), target)
        } catch (error: any) {
          throw fail('恢复上次导出备份失败', error instanceof Error ? error.message : String(error))
        }
      }
    }

    let result
    try {
      result = write(root, work, stage)
    } catch (error: any) {
      cleanup(stage)
      if (error instanceof StoryError) throw error
      throw fail('导出写入失败', error instanceof Error ? error.message : String(error))
    }

    let movedOld = false
    if (existsSync(target)) {
      try {
        rename(target, backup)
        movedOld = true
      } catch (error: any) {
        cleanup(stage)
        throw fail('导出替换前备份旧目录失败', error instanceof Error ? error.message : String(error))
      }
    }
    try {
      rename(stage, target)
    } catch (error: any) {
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

/** Escape one literal string for a backup filename pattern. */
function escapeBackup(value: any) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Exact backup filename filter for one work: <workId>-<digits>.db. */
function backupPattern(workId: any) {
  return new RegExp(`^${escapeBackup(workId)}-(\\d+)\\.db$`, 'u')
}

const BACKUP_MATERIALS_SUFFIX = '.materials.zip'

/** Sidecar path for one DB backup file. */
function backupMaterialsFile(file: string) {
  return `${file}${BACKUP_MATERIALS_SUFFIX}`
}

/** Validate and resolve a materials origin without leaving `.storycraft`. */
function materialOriginPath(root: any, origin: any) {
  if (typeof origin !== 'string' || !/^materials\/[^/\\]+$/u.test(origin) || ['.', '..'].includes(basename(origin))) {
    throw new StoryError('backup-material-origin-missing', `素材 origin 不合法：${String(origin)}`)
  }
  return join(root, '.storycraft', origin)
}

/** Material rows needed for one explicit backup. */
function backupMaterialRows(db: any) {
  return db.prepare('SELECT id, format, origin, bytes, hash FROM materials ORDER BY id').all() as Array<{
    id: string, format: string, origin: string, bytes: number, hash: string,
  }>
}

/** Build and atomically write the materials sidecar; null when there are no materials. */
async function writeMaterialsSidecar(root: any, workId: string, file: string, rows: any[]) {
  if (rows.length === 0) return undefined
  const zip = new JSZip()
  const entries: any[] = []
  const names = new Set<string>()
  for (const row of rows) {
    const source = materialOriginPath(root, row.origin)
    if (!existsSync(source)) throw new StoryError('backup-material-missing', `素材 ${row.id} 的原文件不存在：${row.origin}`)
    const data = readFileSync(source)
    if (data.length !== Number(row.bytes) || createHash('sha256').update(data).digest('hex') !== String(row.hash)) {
      throw new StoryError('backup-material-corrupt', `素材 ${row.id} 的原文件校验失败`)
    }
    const name = basename(String(row.origin))
    if (names.has(name)) throw new StoryError('backup-material-duplicate', `素材文件名重复：${name}`)
    names.add(name)
    zip.file(`materials/${name}`, data)
    entries.push({ id: row.id, format: row.format, origin: row.origin, bytes: Number(row.bytes), hash: row.hash })
  }
  zip.file('manifest.json', JSON.stringify({
    formatVersion: 1,
    schemaVersion: WORK_SCHEMA_VERSION,
    workId,
    createdAt: now(),
    materials: entries,
  }))
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const sidecar = backupMaterialsFile(file)
  const temp = `${sidecar}.tmp`
  writeFileSync(temp, data)
  renameSync(temp, sidecar)
  return { file: sidecar, bytes: data.length, materials: { count: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) } }
}

/** Read and validate a sidecar without writing anything. */
async function readMaterialsSidecar(root: any, workId: string, sidecar: string, expectedRows: any[] = []) {
  const zip = await JSZip.loadAsync(readFileSync(sidecar))
  const manifestEntry = zip.file('manifest.json')
  if (manifestEntry === null) throw new StoryError('backup-material-corrupt', '素材备份缺少 manifest')
  let manifest: any
  try {
    manifest = JSON.parse(await manifestEntry.async('string'))
  } catch {
    throw new StoryError('backup-material-corrupt', '素材备份 manifest 无法解析')
  }
  if (manifest?.formatVersion !== 1 || manifest?.schemaVersion !== WORK_SCHEMA_VERSION || manifest.workId !== workId) {
    throw new StoryError('backup-material-corrupt', '素材备份的格式、schema 或作品不匹配')
  }
  if (!Array.isArray(manifest.materials)) throw new StoryError('backup-material-corrupt', '素材备份 manifest 缺少 materials')
  const expected = new Set(['manifest.json'])
  const expectedById = new Map(expectedRows.map(row => [row.id, row]))
  const materials: Array<{ origin: string, data: Buffer }> = []
  for (const entry of manifest.materials) {
    const expectedRow = expectedById.get(entry?.id)
    if (expectedRows.length > 0 && (expectedRow === undefined
      || Number(expectedRow.bytes) !== Number(entry?.bytes)
      || expectedRow.hash !== String(entry?.hash)
      || expectedRow.origin !== String(entry?.origin)
      || expectedRow.format !== String(entry?.format))) {
      throw new StoryError('backup-material-corrupt', `素材备份与数据库不一致：${String(entry?.id)}`)
    }
    const origin = String(entry?.origin ?? '')
    materialOriginPath(root, origin)
    const name = `materials/${basename(origin)}`
    if (expected.has(name)) throw new StoryError('backup-material-corrupt', `素材备份重复：${name}`)
    expected.add(name)
    const handle = zip.file(name)
    if (handle === null) throw new StoryError('backup-material-corrupt', `素材备份缺少：${name}`)
    const data = await handle.async('nodebuffer')
    if (data.length !== Number(entry.bytes) || createHash('sha256').update(data).digest('hex') !== String(entry.hash)) {
      throw new StoryError('backup-material-corrupt', `素材备份校验失败：${name}`)
    }
    materials.push({ origin, data })
  }
  if (expectedRows.length > 0 && materials.length !== expectedRows.length) {
    throw new StoryError('backup-material-corrupt', '素材备份数量与数据库不一致')
  }
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]?.dir === true) continue
    if (!expected.has(name)) throw new StoryError('backup-material-corrupt', `素材备份含未登记文件：${name}`)
  }
  return materials
}

/** List one work's backup files, newest first. */
function backupFiles(root: any, workId: any) {
  const directory = backupsDir(root)
  let names
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  const pattern = backupPattern(workId)
  return names
    .filter(name => pattern.test(name))
    .sort()
    .reverse()
    .map(name => {
      const file = join(directory, name)
      const info = statSync(file)
      const materialsFile = backupMaterialsFile(file)
      const materialsBytes = existsSync(materialsFile) ? statSync(materialsFile).size : 0
      return {
        file, name, token: pattern.exec(name)![1], bytes: info.size,
        materialsFile: existsSync(materialsFile) ? materialsFile : undefined,
        materialsBytes,
        createdAt: info.mtime.toISOString(),
      }
    })
}

/** Read just the manifest summary from a sidecar. */
async function sidecarSummary(file: string, workId: string) {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const entry = zip.file('manifest.json')
  if (entry === null) throw new StoryError('backup-material-corrupt', '素材备份缺少 manifest')
  const manifest = JSON.parse(await entry.async('string'))
  if (manifest?.formatVersion !== 1 || manifest?.schemaVersion !== WORK_SCHEMA_VERSION || manifest.workId !== workId) {
    throw new StoryError('backup-material-corrupt', '素材备份的格式、schema 或作品不匹配')
  }
  if (!Array.isArray(manifest?.materials)) throw new StoryError('backup-material-corrupt', '素材备份 manifest 缺少 materials')
  return {
    count: manifest.materials.length,
    bytes: manifest.materials.reduce((sum: number, item: any) => sum + Number(item?.bytes ?? 0), 0),
  }
}

/** Count material rows stored in one backup DB without touching the live work. */
function backupMaterialCount(file: string) {
  const db = openDatabase(file, '备份文件无法读取', { readOnly: true })
  try {
    return Number(db.prepare('SELECT count(*) AS count FROM materials').get()?.count ?? 0)
  } finally {
    db.close()
  }
}

/** List a work's backups with stable ids for routes/UI. */
export async function listBackups(root: any, work: any) {
  const workId = String(work)
  pruneOrphanSidecars(root, workId)
  const out = []
  for (const entry of backupFiles(root, workId)) {
    let materials
    let incomplete = false
    let corrupt = false
    let noMaterials = false
    if (entry.materialsFile !== undefined) {
      try {
        materials = await sidecarSummary(entry.materialsFile, workId)
      } catch {
        corrupt = true
      }
    } else {
      try {
        if (backupMaterialCount(entry.file) > 0) incomplete = true
        else noMaterials = true
      } catch {
        incomplete = true
      }
    }
    out.push({
      backupId: `backup:${workId}:${entry.token}`,
      file: entry.file,
      bytes: entry.bytes + entry.materialsBytes,
      createdAt: entry.createdAt,
      ...(materials === undefined ? {} : { materials }),
      ...(incomplete ? { incomplete: true } : {}),
      ...(corrupt ? { corrupt: true } : {}),
      ...(noMaterials ? { noMaterials: true } : {}),
    })
  }
  return out
}

/** Resolve a backupId without crossing into another work's files. */
function resolveBackupFile(root: any, workId: any, backupId: any) {
  const prefix = `backup:${workId}:`
  if (typeof backupId !== 'string' || !backupId.startsWith(prefix)) throw new StoryError('backup-not-found', '没有这个备份')
  const token = backupId.slice(prefix.length)
  if (!/^\d+$/u.test(token)) throw new StoryError('backup-not-found', '没有这个备份')
  const file = join(backupsDir(root), `${workId}-${token}.db`)
  if (!existsSync(file)) throw new StoryError('backup-not-found', '没有这个备份')
  const materialsFile = backupMaterialsFile(file)
  return { file, token, materialsFile: existsSync(materialsFile) ? materialsFile : undefined }
}

/** Run one function under the per-work lock shared with export. */
async function withWorkLock(root: any, work: any, fn: any) {
  const key = `${root}\0${work}`
  const previous = exportLocks.get(key) ?? Promise.resolve()
  let release!: (value?: unknown) => void
  const gate = new Promise(resolve => { release = resolve })
  const tail = previous.then(() => gate)
  exportLocks.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (exportLocks.get(key) === tail) exportLocks.delete(key)
  }
}

/** Remove sidecars whose DB partner is gone. */
function pruneOrphanSidecars(root: any, workId: any) {
  const directory = backupsDir(root)
  let names
  try {
    names = readdirSync(directory)
  } catch {
    return
  }
  const pattern = backupPattern(workId)
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const name of names) {
    if (name.startsWith(String(workId) + '-') && name.endsWith(BACKUP_MATERIALS_SUFFIX + '.tmp')) {
      const path = join(directory, name)
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
      } catch {
        // Swap/delete race: the next list retries.
      }
      continue
    }
    if (!name.startsWith(String(workId) + '-') || !name.endsWith(BACKUP_MATERIALS_SUFFIX)) continue
    const base = name.slice(0, -BACKUP_MATERIALS_SUFFIX.length)
    if (!pattern.test(base)) continue
    if (!existsSync(join(directory, base))) unlinkSync(join(directory, name))
  }
}

/** Delete old panel-created backups, keeping the newest `keep` files. */
export function pruneBackups(root: any, workId: any, keep: any) {
  pruneOrphanSidecars(root, workId)
  if (keep === 0) return { removed: [] }
  const files = backupFiles(root, workId)
  const removed = []
  for (const entry of files.slice(keep)) {
    unlinkSync(entry.file)
    if (entry.materialsFile !== undefined) unlinkSync(entry.materialsFile)
    removed.push(entry.name)
  }
  return { removed }
}

/** Create a backup and apply the panel retention policy. */
export async function createBackup(root: any, work: any, keep: any = 10) {
  const limit = keep === 0 ? 0 : Number(keep)
  if (![0, 5, 10, 20].includes(limit)) throw new StoryError('backup-keep-invalid', '保留策略只允许 5/10/20/不清理')
  return withWorkLock(root, work, async () => {
    const result = await backupWork(root, work)
    const pruned = pruneBackups(root, work, limit)
    return { ...result, pruned: pruned.removed.length }
  })
}

/** Delete one backup file, never the work database. */
export async function deleteBackup(root: any, work: any, backupId: any) {
  return withWorkLock(root, work, async () => {
    const target = resolveBackupFile(root, work, backupId)
    unlinkSync(target.file)
    if (target.materialsFile !== undefined) unlinkSync(target.materialsFile)
    return { backupId }
  })
}

/**
 * Restore one backup over the current work, with an automatic DB-only safety backup.
 * Materials are validated against the staged DB and written before the DB swap.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} backupId - backup identity.
 * @param {{corruptCurrent?: boolean}} [options] - internal diagnostic path.
 * @returns {Promise<{workId: string, restoredBackup: string, safetyBackup: string|undefined, corrupt: boolean, hasMaterials: boolean, materialsRestored: number}>} receipt.
 */
export async function restoreBackup(root: any, work: any, backupId: any, options: any = {}) {
  const workId = String(work)
  const catalog = requireCatalog(root)
  let row
  try {
    row = catalogRow(catalog, workId)
  } finally {
    catalog.close()
  }
  if (row === undefined || row.trashed_at !== null) throw new StoryError('work-not-found', `没有作品：${workId}`)
  const target = resolveBackupFile(root, workId, backupId)
  const stage = join(worksDir(root), `.${workId}-restore-${randomUUID().slice(0, 8)}.db`)
  const safety = join(backupsDir(root), `.safety-${workId}-${Date.now()}.db`)
  const hiddenCorrupt = join(backupsDir(root), `.corrupt-${workId}-${Date.now()}.db`)

  return withWorkLock(root, workId, async () => {
    copyFileSync(target.file, stage)
    let expectedMaterials: any[] = []
    try {
      const copy = openDatabase(stage, '备份无法读取')
      try {
        const version = Number(copy.prepare('PRAGMA user_version').get()?.user_version ?? 0)
        if (version !== WORK_SCHEMA_VERSION) {
          throw new StoryError('backup-invalid', `备份 schema v${version} 不是支持的 v${WORK_SCHEMA_VERSION}`)
        }
        if (integrityCheck(copy) !== 'ok') throw new StoryError('backup-invalid', '备份文件不完整')
        expectedMaterials = backupMaterialRows(copy)
      } finally {
        copy.close()
      }
    } catch (error: any) {
      removeDatabaseFiles(stage)
      if (error instanceof StoryError) throw error
      throw new StoryError('backup-invalid', `备份无法恢复：${error.message}`)
    }

    let materials: Array<{ origin: string, data: Buffer }> = []
    if (target.materialsFile !== undefined) {
      try {
        materials = await readMaterialsSidecar(root, workId, target.materialsFile, expectedMaterials)
      } catch (error: any) {
        removeDatabaseFiles(stage)
        throw error instanceof StoryError ? error : new StoryError('backup-material-corrupt', `素材备份无法恢复：${error.message}`)
      }
    }
    if (materials.length > 0) {
      const temps: string[] = []
      try {
        mkdirSync(materialsDir(root), { recursive: true })
        for (const material of materials) {
          const destination = join(materialsDir(root), basename(material.origin))
          const temp = `${destination}.${randomUUID().slice(0, 8)}.tmp`
          temps.push(temp)
          writeFileSync(temp, material.data)
          renameSync(temp, destination)
        }
      } catch (error: any) {
        for (const temp of temps) if (existsSync(temp)) unlinkSync(temp)
        removeDatabaseFiles(stage)
        throw new StoryError('backup-material-write-failed', `素材恢复失败：${error.message}`)
      }
    }

    let corrupt = options.corruptCurrent === true
    let safetyBackup
    try {
      if (!corrupt) {
        try {
          safetyBackup = (await backupWork(root, workId, { materials: false })).file
        } catch (error: any) {
          if (error?.code !== 'db-corrupt') throw error
          corrupt = true
        }
      }
      const current = workFile(root, workId)
      if (!corrupt) {
        const db = openWork(root, workId)
        try {
          checkpoint(db)
        } finally {
          db.close()
        }
        moveDatabaseFiles(current, safety)
      } else {
        moveDatabaseFiles(current, hiddenCorrupt)
      }
      try {
        moveDatabaseFiles(stage, current)
      } catch (error: any) {
        if (corrupt) moveDatabaseFiles(hiddenCorrupt, current)
        else moveDatabaseFiles(safety, current)
        throw new StoryError('backup-rollback-failed', `恢复失败且回滚失败：${error.message}`)
      }
      const verify = openWork(root, workId)
      try {
        if (integrityCheck(verify) !== 'ok') throw new StoryError('backup-invalid', '恢复后的作品库不完整')
      } catch (error: any) {
        verify.close()
        moveDatabaseFiles(current, stage)
        if (corrupt) moveDatabaseFiles(hiddenCorrupt, current)
        else moveDatabaseFiles(safety, current)
        removeDatabaseFiles(stage)
        throw new StoryError('backup-invalid', `恢复后校验失败：${error.message}`)
      }
      verify.close()
      const at = now()
      const db = openWork(root, workId)
      try {
        db.prepare('UPDATE meta SET updated_at = ? WHERE id = 1').run(at)
      } finally {
        db.close()
      }
      if (!corrupt && existsSync(safety)) removeDatabaseFiles(safety)
      return {
        workId,
        restoredBackup: backupId,
        safetyBackup,
        corrupt,
        hasMaterials: target.materialsFile !== undefined,
        materialsRestored: materials.length,
      }
    } finally {
      if (existsSync(stage)) removeDatabaseFiles(stage)
    }
  })
}

/**
 * Copy one work's database, and explicitly its material originals, to a backup.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string|{materials?: boolean}} [destinationOrOptions] - backup file or options.
 * @param {{materials?: boolean}} [extra] - options when the third argument is a file.
 * @returns {Promise<{file: string, integrity: string, materialsFile?: string, materials?: {count: number, bytes: number}}>} backup result.
 */
export async function backupWork(root: any, work: any, destinationOrOptions: any = undefined, extra: any = {}) {
  const destination = typeof destinationOrOptions === 'string' ? destinationOrOptions : undefined
  const options = destinationOrOptions === undefined ? (extra ?? {}) : typeof destinationOrOptions === 'string' ? extra : destinationOrOptions
  const withMaterials = options.materials !== false
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    let file: string | undefined
    let sidecar: any
    try {
      file = destination
      if (file === undefined) {
        let stamp = Date.now()
        do {
          file = join(backupsDir(root), `${row.work_id}-${stamp}.db`)
          stamp += 1
        } while (existsSync(file))
      }
      try {
        await backupTo(db, file)
        const rows = withMaterials ? backupMaterialRows(db) : []
        sidecar = await writeMaterialsSidecar(root, row.work_id, file, rows)
        if (sidecar === undefined && destination !== undefined) {
          const stale = backupMaterialsFile(file)
          if (existsSync(stale)) unlinkSync(stale)
        }
      } catch (error: any) {
        if (error?.code === 'db-corrupt') throw error
        if (error instanceof StoryError) throw error
        throw new StoryError('backup-failed', `备份失败：${error.message}`)
      }
      const copy = openDatabase(file, '备份文件无法读取', { readOnly: true })
      try {
        return {
          file,
          integrity: integrityCheck(copy),
          ...(sidecar === undefined ? {} : { materialsFile: sidecar.file, materials: sidecar.materials }),
        }
      } finally {
        copy.close()
      }
    } catch (error: any) {
      try {
        if (file !== undefined) {
          if (existsSync(file)) removeDatabaseFiles(file)
          const sidecarPath = backupMaterialsFile(file)
          if (existsSync(sidecarPath)) unlinkSync(sidecarPath)
          const temp = `${sidecarPath}.tmp`
          if (existsSync(temp)) unlinkSync(temp)
        }
      } catch {
        // Cleanup is best effort; the backup error below is authoritative.
      }
      throw error
    } finally {
      db.close()
    }
  } finally {
    catalog.close()
  }
}

