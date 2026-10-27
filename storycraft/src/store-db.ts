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
import { join } from 'node:path'
import type { Database } from './db.ts'
import type { ArtifactRow, BibleRow, ChapterRow, ChapterVersionRow, EventRow, MaterialRow, MetaRow, VolumeRow, WorkRow } from './store-rows.ts'

export interface WriteChapterInput {
  work: string
  chapter: number | string
  title?: string
  body: string
  rewrite?: boolean
  reopen?: boolean
  requirePlanApproval?: boolean
}

export interface ReadChapterInput {
  work: string
  chapter: number | string
  view?: 'body' | 'plan' | 'summary' | 'review'
  revision?: number
}

export interface WriteReviewInput {
  work: string
  chapter: number | string
  observations: Array<Record<string, any>>
}

export interface ReviseChapterInput {
  work: string
  chapter: number | string
  body: string
  mode?: string
  reopen?: boolean
}

export interface WriteSummaryInput {
  work: string
  chapter: number | string
  revision?: number
  text?: string
}
import {
  backupTo, checkpoint, createWorkDatabase, exportsDir, integrityCheck, WORK_SCHEMA_VERSION,
  materialsDir, moveDatabaseFiles, openCatalog, openDatabase, openWork, removeDatabaseFiles, touchMeta, transaction,
  trashDir, trashFile, workFile, worksDir, backupsDir,
} from './db.ts'
import { MATERIAL_PURPOSES, MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from './materials.ts'
import { chapterRemap } from './chapter-edit.ts'
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
import { validateArtifactRecord } from './artifact-contract.ts'
import {
  artifactRevision, FOUNDATION_DOCUMENTS, putArtifactOnDb, remapChapterArtifacts, renderChapterMemo, renderFoundationContent,
  writeChapterMemoOnDb, writeChapterObservationsOnDb, writeChapterSummaryOnDb, writeTextArtifactOnDb, readTextArtifactOnDb,
} from './artifact-store.ts'

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
export function virtualWorkPath(workId: string): string {
  return `works/${workId}`
}

/** Virtual path of one artifact inside a work. */
export function virtualPath(workId: string, relative: string): string {
  return `${virtualWorkPath(workId)}/${String(relative).replaceAll('\\', '/')}`
}

/** One catalog row, or undefined. */
function catalogRow(db: Database, workId: unknown): WorkRow | undefined {
  return db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(workId)) as WorkRow | undefined
}

/** The catalog row of an active work, or `work-not-found`. */
function activeWork(db: Database, workId: unknown): WorkRow {
  const row = catalogRow(db, workId)
  if (row === undefined || row.trashed_at !== null) throw new StoryError('work-not-found', `没有作品：${String(workId)}`)
  return row
}

/** Read `meta`, the single row of one work database. */
function requireCatalog(root: string): Database {
  const catalog = openCatalog(root)
  if (catalog === undefined) throw new StoryError('db-corrupt', '作品目录无法打开')
  return catalog
}

function metaOf(db: Database): MetaRow {
  const row = db.prepare('SELECT * FROM meta WHERE id = 1').get() as MetaRow | undefined
  if (row === undefined) throw new StoryError('db-corrupt', '作品库缺少 meta 行')
  return row
}

/** Whether one chapter exists. */
function chapterRow(db: Database, number: number): ChapterRow | undefined {
  return db.prepare('SELECT * FROM chapters WHERE number = ?').get(number) as ChapterRow | undefined
}

/** Insert a planned chapter row when absent. */
function ensureChapter(db: Database, number: number): ChapterRow | undefined {
  const existing = chapterRow(db, number)
  if (existing !== undefined) return existing
  db.prepare('INSERT INTO chapters (number, updated_at) VALUES (?, ?)').run(number, now())
  return chapterRow(db, number)
}

/**
 * Whether the author's plan confirmation still covers the current memo.
 *
 * A chapter without a memo uses the legacy confirmation (the plan text action);
 * once `plan:<n>` exists, the confirmed revision must be its latest revision.
 */
function planGateSatisfied(db: any, entry: any) {
  return planApprovalState(db, entry.number).approved
}

/** Non-throwing approval state for read paths and next-step derivation. */
export interface PlanApprovalState { required: boolean, approved: boolean, blocked: boolean, hasMemo: boolean }

export function planApprovalState(db: Database, chapter: unknown): PlanApprovalState {
  const number = chapterNumber(chapter)
  const entry = db.prepare('SELECT * FROM chapters WHERE number = ?').get(number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const required = metaOf(db).plan_approval === 'required'
  const memo = db.prepare(`SELECT revision_id FROM artifacts
    WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${number}`)
  if (!required) return { required: false, approved: true, blocked: false, hasMemo: memo !== undefined }
  if (memo === undefined) return { required: true, approved: false, blocked: false, hasMemo: false }
  const approved = entry.plan_approved_at !== null && entry.plan_revision === memo.revision_id
  return { required: true, approved, blocked: !approved, hasMemo: true }
}

/** Throwing approval gate for write/revise paths. */
export function assertPlanApproved(db: Database, chapter: unknown): void {
  const state = planApprovalState(db, chapter)
  if (!state.hasMemo) throw new StoryError('plan-not-found', `第 ${chapterNumber(chapter)} 章还没有章纲`)
  if (state.blocked) throw new StoryError('plan-not-approved', `第 ${chapterNumber(chapter)} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」`)
}

/**
 * Latest ChapterSummary content of one chapter, parsed from `summary:<n>`.
 * @param {import('node:sqlite').DatabaseSync} db - open work database.
 * @param {number} number - chapter number.
 * @returns {object|undefined} summary content, or undefined when absent.
 */
function latestSummaryContent(db: Database, number: number): any {
  const row = db.prepare('SELECT content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(`summary:${number}`)
  return row === undefined ? undefined : parseSummaryContent(String(row.content), `summary:${number}`)
}

/** Parse one stored summary JSON; a malformed row is reported by id. */
function parseSummaryContent(text: string, artifactId: string): any {
  try {
    const content = JSON.parse(text)
    return content !== null && typeof content === 'object' ? content : undefined
  } catch {
    throw new StoryError('artifact-invalid', `${artifactId} 的 summary JSON 无法解析`)
  }
}

/** Derive the summary state from chapter revision and summary content. */
function summaryStateOfContent(content: any, currentRevision: number): { state: 'current' | 'stale' | 'missing', text: string | undefined, revision: number | null, currentRevision: number } {
  const revision = Number(content?.bodyRevision)
  const text = typeof content?.rawText === 'string' ? content.rawText : undefined
  if (content === undefined || text === undefined || text.trim() === '' || !Number.isInteger(revision)) {
    return { state: 'missing', text, revision: null, currentRevision }
  }
  const state: 'current' | 'stale' = revision === currentRevision ? 'current' : 'stale'
  return { state, text, revision, currentRevision }
}

/**
 * Current/stale/missing summary state for one chapter, on the caller's handle.
 * The summary artifact is the authority; `revision` is its `bodyRevision`.
 * @param {import('node:sqlite').DatabaseSync} db - open work database.
 * @param {number} number - chapter number.
 * @returns {{state: 'current'|'stale'|'missing', text: string|undefined, revision: number|null, currentRevision: number}} state.
 */
export function summaryStateOf(db: Database, number: number): { state: 'current' | 'stale' | 'missing', text: string | undefined, revision: number | null, currentRevision: number } {
  const entry = db.prepare('SELECT current_revision FROM chapters WHERE number = ?').get(number)
  return summaryStateOfContent(latestSummaryContent(db, number), Number(entry?.current_revision ?? 0))
}

/** Latest stored revision row per summary artifact, ascending by chapter. */
function latestSummaryRows(db: any) {
  return db.prepare(`SELECT a.artifact_id, a.scope_chapter, a.content FROM artifacts a
    JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts
      WHERE kind = 'summary' GROUP BY artifact_id) latest ON a.rowid = latest.rowid
    ORDER BY a.scope_chapter`).all()
}

/** Summary state for every chapter of one work, keyed by chapter number. */
function summaryStateMap(db: Database): Map<number, any> {
  const contentByChapter = new Map()
  for (const row of latestSummaryRows(db)) {
    const chapter = Number(row.artifact_id.slice('summary:'.length))
    if (!Number.isInteger(chapter)) continue
    try {
      contentByChapter.set(chapter, parseSummaryContent(row.content, row.artifact_id))
    } catch {
      // A malformed summary must not break the workbench listing; direct reads
      // still report artifact-invalid.
      contentByChapter.set(chapter, undefined)
    }
  }
  const map = new Map()
  for (const row of db.prepare('SELECT number, current_revision FROM chapters ORDER BY number').all()) {
    map.set(row.number, summaryStateOfContent(contentByChapter.get(row.number), Number(row.current_revision)))
  }
  return map
}

/** Read one chapter's state from a map that covers every chapter row. */
function summaryStateFrom(map: any, number: any) {
  const state = map.get(number)
  if (state === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  return state
}

/** All review artifacts of one chapter, oldest first. */
function reviewRecords(db: any, number: any) {
  return db.prepare(`SELECT artifact_id, revision_id, content, created_at FROM artifacts
    WHERE kind = 'review' AND scope_chapter = ? ORDER BY rowid`).all(number)
    .map((row: any) => {
      const match = /^review:(\d+):r(\d+):(\d+)$/u.exec(String(row.artifact_id))
      const content = JSON.parse(String(row.content))
      return {
        artifactId: row.artifact_id,
        revisionId: row.revision_id,
        round: Number(match?.[3] ?? 0),
        revision: Number(match?.[2] ?? 0),
        observations: Array.isArray(content.observations) ? content.observations : [],
      }
    })
}

/** The newest review artifact of one chapter. */
function latestReviewRow(db: any, number: any) {
  const records = reviewRecords(db, number)
  return records.length === 0 ? undefined : records[records.length - 1]
}

/** Observations still blocking settlement. */
function openObservations(review: any) {
  return (review?.observations ?? []).filter((observation: any) => observation.assessment === 'issue')
}

/** The current body row of one chapter. */
function currentVersion(db: Database, chapter: ChapterRow): ChapterVersionRow | undefined {
  return db.prepare('SELECT * FROM chapter_versions WHERE number = ? AND revision = ?')
    .get(chapter.number, chapter.current_revision) as unknown as ChapterVersionRow | undefined
}

/**
 * Whether a review still describes a chapter's current revision.
 * @param {{revision: number}|undefined} review - newest review.
 * @param {{currentRevision?: number, current_revision?: number}} chapter - chapter entry or row.
 * @param {boolean} [allowPrevious] - accept the revision just replaced.
 * @returns {boolean} true when the review covers the chapter.
 */
function reviewCovers(review: any, chapter: any, allowPrevious = false) {
  const current = chapter.currentRevision ?? chapter.current_revision
  if (review === undefined || current === undefined) return false
  return review.revision === current || (allowPrevious && review.revision === current - 1)
}

/** A clean review records zero observations and authorizes the clean settlement path. */
function isCleanReview(review: any) {
  return review !== undefined && review.observations.length === 0
}

/** Open observation count per chapter, from each chapter's newest review artifact. */
function openProblemCountByChapter(db: any) {
  const rows = db.prepare(`SELECT a.scope_chapter AS chapter, a.content FROM artifacts a
    JOIN (SELECT scope_chapter, max(rowid) AS rowid FROM artifacts
      WHERE kind = 'review' AND scope_chapter IS NOT NULL GROUP BY scope_chapter) latest
      ON a.rowid = latest.rowid`).all()
  const counts = new Map()
  for (const row of rows) {
    const content = JSON.parse(String(row.content))
    counts.set(row.chapter, openObservations({ observations: content.observations }).length)
  }
  return counts
}

/** Serialize every event row as JSONL for export and `story_read(state)`. */
function eventsText(db: Database): string {
  return db.prepare('SELECT * FROM events ORDER BY seq').all()
    .map((row: any) => JSON.stringify({ seq: row.seq, at: row.at, chapter: row.chapter, kind: row.kind, ...JSON.parse(String(row.payload)) }))
    .join('\n')
}

/** Flatten every event row into the shape the v2 projection consumes. */
function eventsOf(db: Database): any[] {
  return db.prepare('SELECT seq, chapter, kind, payload FROM events ORDER BY seq')
    .all().map((row: any) => ({ seq: row.seq, chapter: row.chapter, kind: row.kind, ...JSON.parse(String(row.payload)) }))
}

/** Project one work's event log: hook/fact events are the only source. */
function foldedOf(db: any) {
  return projectState(eventsOf(db))
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
            ...(chapter.plan_revision == null ? {} : { planRevision: chapter.plan_revision }),
            provenance: chapter.provenance ?? 'generated',
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
export function listWorks(root: string): any[] {
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
        const chapters = db.prepare('SELECT number, current_revision FROM chapters ORDER BY number').all()
        let openProblems = 0
        for (const current of openProblemCountByChapter(db).values()) openProblems += current
        works.push({
          workId: row.work_id,
          title: row.title,
          form: formOf(row),
          chapters: chapters.length,
          writtenChapters: chapters.filter((chapter: any) => Number(chapter.current_revision) > 0).length,
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
export function readWork(root: string, work: unknown): any {
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

/** Architect stages in order. */
export const FOUNDATION_STAGES = ['frame', 'rules', 'roles', 'cards']

/** Artifacts each stage produces, in write order. */
const FOUNDATION_STAGE_ARTIFACTS = {
  frame: ['bible:story_frame', 'bible:volume_map', 'bible:current_focus'],
  rules: ['bible:book_rules'],
  roles: ['roles:index'],
  cards: null,
}

/** Derived foundation state of one open work. */
function foundationStateOf(db: any) {
  const has = (artifactId: any) => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? LIMIT 1').get(artifactId) !== undefined
  const stages = {
    frame: FOUNDATION_STAGE_ARTIFACTS.frame.every(has),
    rules: has('bible:book_rules'),
    roles: has('roles:index'),
    cards: db.prepare("SELECT 1 FROM artifacts WHERE kind = 'role_card' LIMIT 1").get() !== undefined,
  }
  const complete = FOUNDATION_STAGES.every(stage => (stages as Record<string, boolean>)[stage] === true)
  const nextStage = FOUNDATION_STAGES.find(stage => (stages as Record<string, boolean>)[stage] !== true)
  return {
    stages,
    complete,
    ...(nextStage === undefined ? {} : { nextStage }),
    ...(metaOf(db).foundation_approved_at === null ? {} : { approvedAt: metaOf(db).foundation_approved_at }),
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
export function writeFoundationStage(root: any, input: any) {
  const workId = String(input.work)
  const stage = String(input.stage)
  if (!FOUNDATION_STAGES.includes(stage)) throw new StoryError('foundation-stage-invalid', `未知的 foundation stage：${stage}`)
  const payload = input.payload ?? {}
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const state = foundationStateOf(db)
      if (stage !== 'frame' && state.stages.frame !== true) {
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
      if (stage === 'frame') {
        const focus = String(payload.currentFocus ?? '')
        if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
        records = [
          record('bible:story_frame', 'story_frame', String(payload.storyFrame ?? ''), 'foundation/story_frame'),
          record('bible:volume_map', 'volume_map', String(payload.volumeMap ?? ''), 'foundation/volume_map'),
          record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
        ]
      } else if (stage === 'rules') {
        records = [record('bible:book_rules', 'book_rules', payload.bookRules, 'foundation/book_rules')]
      } else if (stage === 'roles') {
        const roles = Array.isArray(payload.rolesIndex?.roles) ? payload.rolesIndex.roles : []
        if (roles.length > 20) throw new StoryError('artifact-invalid', 'roles 索引最多 20 人')
        records = [record('roles:index', 'role_index', payload.rolesIndex, 'foundation/roles/index')]
      } else {
        const cards = Array.isArray(payload.roleCards) ? payload.roleCards : []
        if (cards.length === 0) throw new StoryError('artifact-invalid', '角色卡至少需要一张')
        if (cards.length > 12) throw new StoryError('artifact-invalid', '角色卡最多 12 张')
        const index = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'roles:index' ORDER BY rowid DESC LIMIT 1").get()
        const majorNames = new Set()
        if (index !== undefined) {
          for (const role of JSON.parse(String(index.content)).roles ?? []) {
            if (role.tier === 'major') majorNames.add(role.name)
          }
        }
        const names = new Set()
        const slugs = new Set()
        records = cards.map((card: any) => {
          if (!majorNames.has(card?.name)) {
            throw new StoryError('artifact-invalid', `角色卡 ${String(card?.name)} 不在 roles 索引的 major 条目里`)
          }
          if (card?.tier !== 'major') {
            throw new StoryError('artifact-invalid', `角色卡 ${String(card?.name)} 的 tier 必须是 major`)
          }
          const slug = String(card?.slug ?? '').trim()
          if (names.has(card.name) || slugs.has(slug)) {
            throw new StoryError('artifact-invalid', `角色卡重复：${String(card.name)}/${slug}`)
          }
          names.add(card.name)
          slugs.add(slug)
          return record(`role:${slug}`, 'role_card', card, `foundation/roles/${slug}`)
        })
        if (cards.length > majorNames.size) {
          throw new StoryError('artifact-invalid', `角色卡数量 ${cards.length} 超过 major 角色数 ${majorNames.size}`)
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
      if (anyWritten) {
        db.prepare('UPDATE meta SET foundation_approved_at = NULL, updated_at = ? WHERE id = 1').run(at)
      }
      return { workId, stage, artifacts, foundation: foundationStateOf(db) }
    })
  } finally {
    db.close()
  }
}

/** Author confirmation of a complete foundation; panel-only in the product. */
export function approveFoundation(root: any, input: any) {
  const db = openWork(root, String(input.work))
  try {
    return transaction(db, () => {
      const state = foundationStateOf(db)
      if (state.complete !== true) throw new StoryError('foundation-incomplete', 'foundation 还没生成完整：先跑完四个 stage')
      const at = now()
      db.prepare('UPDATE meta SET foundation_approved_at = ?, updated_at = ? WHERE id = 1').run(at, at)
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
    const last = chapters.length === 0 ? undefined : chapters[chapters.length - 1]
    const chapter = last === undefined ? 1 : last.number
    const outline = manifest.outline
    let candidate
    const step = (() => {
      if (last === undefined) {
        if (outline === undefined || outline.writtenAt === undefined) {
          if (formOf(manifest) === 'longform') {
            const foundation = foundationStateOf(db)
            if (foundation.complete !== true) {
              return {
                chapter, stage: 'planned', action: 'story_architect', foundationStage: foundation.nextStage,
                reason: `还没有基础设定（${foundation.nextStage}）：让 architect 生成故事框架、规则与角色，再写全书计划`,
                missing: [`foundation:${foundation.nextStage}`],
              }
            }
            if (foundation.approvedAt === undefined) {
              return {
                chapter, stage: 'planned', action: 'story_architect',
                reason: '基础设定已生成，等作者在面板「基础设定」里确认，再写全书计划',
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
      const blocked = planApprovalPolicy(manifest) === 'required' && last.planApproved !== true
        ? { blocked: ['plan-approval'] } : {}
      const open = openObservations(candidate)
      if (open.length > 0) {
        return {
          chapter: last.number, stage, action: 'story_revise',
          reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map((item: any) => item.id), ...blocked,
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
      return { chapter: last.number, stage, action: 'story_settle', reason: isCleanReview(candidate) ? `第 ${last.number} 章清稿审稿无问题，自动结算` : `第 ${last.number} 章已修订，自动结算`, missing: [] }
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
      db.prepare('UPDATE meta SET outline_written_at = ?, outline_approved_at = NULL, updated_at = ? WHERE id = 1').run(at, at)
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
      transaction(catalog, () => catalog.prepare('UPDATE works SET trashed_at = ?, missing_at = NULL WHERE work_id = ?')
        .run(now(), workId))
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
// Chapter plans and bodies
// ---------------------------------------------------------------------------

/**
 * Write one chapter plan. A fresh plan is unapproved until the author confirms it.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, perspective: string, goal: string, obstacle: string, cost: string, turn: string, requireBody?: boolean, requireAbsent?: boolean}} input - plan fields.
 * @returns {object} result with a virtual artifact path.
 */
export function writePlan(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const fields = [input.perspective, input.goal, input.obstacle, input.cost, input.turn]
  if (fields.some(value => typeof value !== 'string' || value.trim() === '')) {
    throw new StoryError('plan-incomplete', '章纲需要视角、目标、阻力、代价、结尾变化')
  }
  const threadRefs = input.threadRefs === undefined ? [] : input.threadRefs
  if (!Array.isArray(threadRefs) || threadRefs.some(ref => typeof ref !== 'string')) {
    throw new StoryError('plan-incomplete', '章纲的 threadRefs 必须是字符串数组')
  }
  // The story_plan action requires body/threadRefs. Direct store callers may
  // omit them for fixtures; the action boundary passes requireBody.
  if (input.requireBody === true && typeof input.body !== 'string') {
    throw new StoryError('plan-incomplete', '章纲需要一个非空 body')
  }
  if (input.requireBody === true && !Array.isArray(input.threadRefs)) {
    throw new StoryError('plan-incomplete', '章纲的 threadRefs 必须是数组')
  }
  const body = input.body === undefined ? input.goal.trim() : String(input.body)
  if (body.trim() === '') throw new StoryError('plan-incomplete', '章纲正文不能为空')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      if (input.requireAbsent === true) {
        const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(`plan:${number}`)
        if (existing !== undefined) {
          throw new StoryError('plan-exists', `第 ${number} 章已有章纲：planner 只写首次章纲`)
        }
      }
      const entry = ensureChapter(db, number)
      if (stageOf(entry) === 'settled') {
        throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改章纲前先带 reopen 重写正文回退`)
      }
      const content = {
        chapter: number,
        goal: input.goal.trim(),
        body,
        threadRefs,
        perspective: input.perspective.trim(),
        obstacle: input.obstacle.trim(),
        cost: input.cost.trim(),
        turn: input.turn.trim(),
      }
      const written = writeChapterMemoOnDb(db, { work: workId, chapter: number, content })
      return {
        workId,
        chapter: number,
        planApproved: planApprovalState(db, number).approved,
        artifact: written.artifact,
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
export function approveChapterPlan(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      const memo = db.prepare(`SELECT revision_id FROM artifacts
        WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${number}`)
      if (entry === undefined || memo === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
      const at = now()
      const planRevision = memo.revision_id
      db.prepare('UPDATE chapters SET plan_approved_at = ?, plan_revision = ?, updated_at = ? WHERE number = ?')
        .run(at, planRevision, at, number)
      touchMeta(db, at)
      return {
        workId,
        entry: { number, planApprovedAt: at, ...(planRevision === null ? {} : { planRevision }) },
      }
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
export function writeChapter(root: string, input: WriteChapterInput): any {
  const number = chapterNumber(input.chapter)
  const body = String(input.body ?? '')
  if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const meta = metaOf(db)
      const entry = chapterRow(db, number)
      const plan = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(`plan:${number}`) as Pick<ArtifactRow, 'artifact_id'> | undefined
      if (entry === undefined || plan === undefined) {
        throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再写正文`)
      }
      if (meta.plan_approval === 'required') assertPlanApproved(db, number)
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
        current_revision = ?, words = ?, updated_at = ? WHERE number = ?`)
        .run(String(input.title ?? entry.title), revision, words, at, number)
      dropSearchDoc(db, `chapter:${number}:r${revision - 1}`)
      syncSearchDoc(db, `chapter:${number}:r${revision}`, 'chapter', `chapters/${chapterStem(number)}`, number, body)
      if (settled) {
        const seq = Number((db.prepare('SELECT max(seq) AS n FROM events').get() as { n: number } | undefined)?.n ?? 0) + 1
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
export function readChapter(root: string, input: ReadChapterInput): { path: string, content: string, revision: number } {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const manifest = readManifest(root, workId)
  const db = openWork(root, manifest.workId)
  try {
    const entry = chapterRow(db, number)
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    if (input.view === 'summary') {
      const content = latestSummaryContent(db, number)
      if (content === undefined || typeof content.rawText !== 'string' || content.rawText.trim() === '') {
        throw new StoryError('summary-not-found', `第 ${number} 章还没有摘要`)
      }
      return {
        path: virtualPath(workId, `summaries/${chapterStem(number)}.md`),
        content: content.rawText,
        revision: Number(content.bodyRevision),
      }
    }
    if (input.view === 'review') {
      const record = latestReviewRow(db, number)
      if (record === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿`)
      return {
        path: virtualPath(workId, `reviews/${chapterStem(number)}.r${record.round}.md`),
        content: renderReviewMarkdown(number, record),
        revision: record.revision,
      }
    }
    if (input.view === 'plan') {
      const content = readPlan(root, workId, number)
      if (content === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
      return { path: virtualPath(workId, `outline/${chapterStem(number)}.plan.md`), content, revision: 0 }
    }
    const revision = input.revision === undefined || input.revision === 0 ? entry.current_revision : Number(input.revision)
    if (revision <= 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文`)
    const row = db.prepare('SELECT body FROM chapter_versions WHERE number = ? AND revision = ?').get(number, revision)
    if (row === undefined) throw new StoryError('body-not-found', `第 ${number} 章没有版本 ${revision}`)
    return {
      path: virtualPath(workId, `chapters/${revision === 1 ? `${chapterStem(number)}.md` : `${chapterStem(number)}.r${revision}.md`}`),
      content: String(row.body),
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
 * Persist one review round as `review:<n>:r<bodyRev>:<round>`.
 * Clean reviews (empty observations) authorize the clean settlement path.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, observations: object[]}} input - observations.
 * @returns {object} review receipt.
 */
export function writeReview(root: string, input: WriteReviewInput): any {
  const number = chapterNumber(input.chapter)
  const observations = Array.isArray(input.observations) ? input.observations : []
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || entry.current_revision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能审稿`)
      if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改审稿要先带 reopen`)
      const round = reviewRecords(db, number).length + 1
      const normalized = observations.map((observation, index) => ({
        ...observation,
        id: observation?.id ?? `O${index + 1}`,
        assessment: observation?.assessment ?? 'issue',
        target: observation?.target ?? {
          workId,
          artifactId: `chapter:${number}`,
          revisionId: `r${entry.current_revision}`,
        },
        sourceRefs: Array.isArray(observation?.sourceRefs) ? observation.sourceRefs : [],
      }))
      const previousIssues = new Set(openObservations(latestReviewRow(db, number)).map((observation: any) => observation.id))
      for (const observation of normalized) {
        if (observation.assessment === 'resolved' && !previousIssues.has((observation as any).resolves)) {
          throw new StoryError('artifact-invalid', `resolved observation 的 resolves 不是上一轮的 issue：${String((observation as any).resolves)}`)
        }
      }
      const written = writeChapterObservationsOnDb(db, root, {
        work: workId,
        chapter: number,
        bodyRevision: entry.current_revision,
        round,
        observations: normalized,
      })
      const at = now()
      db.prepare("UPDATE chapters SET status = 'reviewed', stage = 'reviewed', updated_at = ? WHERE number = ?").run(at, number)
      touchMeta(db, at)
      return {
        workId,
        chapter: number,
        round,
        revision: entry.current_revision,
        observations: normalized,
        artifactId: written.artifactId,
        revisionId: written.revisionId,
        path: virtualPath(workId, `reviews/${chapterStem(number)}.r${round}.md`),
      }
    })
  } finally {
    db.close()
  }
}

/** Project review observations into the compact item view used by tools and UI. */
function reviewItems(observations: any) {
  return observations.map((observation: any) => ({
    id: observation.id,
    done: observation.assessment !== 'issue',
    assessment: observation.assessment,
    severity: observation.severity,
    evidence: observation.evidence ?? [],
    resolves: (observation as any).resolves,
    location: observation.sourceRefs?.[0]?.quote ?? observation.scope ?? '',
    problem: observation.summary,
    suggestion: observation.fix ?? '',
  }))
}

/** Render one review round for export and reading. */
function renderReviewMarkdown(number: any, record: any) {
  const lines = [`# 第 ${number} 章 审稿（第 ${record.round} 轮）`, '', `- 正文版本：${record.revision}`, '']
  if (record.observations.length === 0) lines.push('- 清稿：无问题')
  for (const observation of record.observations) {
    lines.push(`## ${observation.id}（${observation.assessment}${observation.severity === undefined ? '' : ` / ${observation.severity}`}）`)
    lines.push(observation.summary)
    for (const ref of observation.sourceRefs ?? []) lines.push(`- 证据：${ref.quote}`)
    if (observation.fix !== undefined) lines.push(`- 修法：${observation.fix}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Latest review of one chapter.
 * @param {string} root - workspace directory.
 * @param {string|object} work - work id or manifest.
 * @param {number|string|object} chapter - chapter number or entry.
 * @returns {{round: number, revision: number, path: string, observations: object[], items: object[]}|undefined} review.
 */
export function latestReview(root: any, work: any, chapter: any) {
  const workId = typeof work === 'string' ? work : work?.workId
  const number = chapterNumber(typeof chapter === 'object' && chapter !== null ? chapter.number : chapter)
  const db = openWork(root, workId)
  try {
    const record = latestReviewRow(db, number)
    if (record === undefined) return undefined
    return {
      round: record.round,
      revision: record.revision,
      path: virtualPath(workId, `reviews/${chapterStem(number)}.r${record.round}.md`),
      artifactId: record.artifactId,
      revisionId: record.revisionId,
      observations: record.observations,
      items: reviewItems(record.observations),
    }
  } finally {
    db.close()
  }
}

/**
 * Read the latest review of a chapter with its observations and round count.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {{path: string, round: number, revision: number, rounds: number, observations: object[], items: object[]}} review payload.
 */
export function readReview(root: any, work: any, chapter: any) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    if (chapterRow(db, number) === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    const records = reviewRecords(db, number)
    const record = records[records.length - 1]
    if (record === undefined) return { path: '', round: 0, revision: 0, rounds: 0, observations: [], items: [] }
    return {
      path: virtualPath(work, `reviews/${chapterStem(number)}.r${record.round}.md`),
      round: record.round,
      revision: record.revision,
      rounds: records.length,
      artifactId: record.artifactId,
      revisionId: record.revisionId,
      observations: record.observations,
      items: reviewItems(record.observations),
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
export function reviseChapter(root: string, input: ReviseChapterInput): any {
  const number = chapterNumber(input.chapter)
  const body = String(input.body ?? '')
  if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
  const mode = input.mode ?? 'patch'
  if (!['patch', 'polish', 'rewrite', 'deslop'].includes(mode)) {
    throw new StoryError('revise-mode-violation', `未知修订模式：${mode}`)
  }
  const problemIds = Array.isArray((input as any).problemIds) ? (input as any).problemIds.map(String) : []
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
      const meta = metaOf(db)
      if (meta.plan_approval === 'required') assertPlanApproved(db, number)
      const review = latestReviewRow(db, number)
      if (review === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿：先 story_review`)
      // A patch answers the exact revision it read; broader modes may land on
      // the revision the review already saw.
      if (!reviewCovers(review, entry, mode !== 'patch')) {
        throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
      }
      const open = openObservations(review).map((observation: any) => observation.id)
      const missing = problemIds.filter((id: any) => !open.includes(id))
      if (missing.length > 0) throw new StoryError('problem-not-found', `问题不存在或已处理：${missing.join('、')}`)
      const current = currentVersion(db, entry)
      if (current!.body === body) throw new StoryError('unchanged-body', '修订后的正文与当前版本相同')
      assertRevisionMode({ mode, chapter: number, oldBody: current!.body, body })
      const revision = entry.current_revision + 1
      const words = countWords(body)
      const at = now()
      db.prepare('INSERT INTO chapter_versions (number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(number, revision, body, words, at)
      db.prepare(`UPDATE chapters SET status = 'revised', stage = 'revised',
        current_revision = ?, words = ?, provenance = 'edited', last_revise_mode = ?, updated_at = ? WHERE number = ?`)
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
 * Write a chapter summary as `summary:<n>`. The single write owner for manual
 * and delegated summaries; `text` carries the manual/plain form, `content` the
 * structured summarizer payload. {@link SUMMARY_MAX_CHARS} caps the raw text and
 * the receipt reports the pre-truncation code-point count.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, text?: string, content?: object, ifAbsent?: boolean}} input - summary input.
 * @returns {{workId: string, chapter: number, chars: number, truncated: boolean, summaryRevision: number, artifact: object}} receipt.
 */
export function writeSummary(root: string, input: WriteSummaryInput): any {
  const number = chapterNumber(input.chapter)
  const source = (input as any).content === undefined ? { rawText: input.text } : (input as any).content
  const { text, chars } = trimSummary(source?.rawText)
  if (text === '') throw new StoryError('empty-summary', '摘要不能为空')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || entry.current_revision === 0) {
        throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能写摘要`)
      }
      if ((input as any).ifAbsent === true) {
        const existing = latestSummaryContent(db, number)
        if (existing !== undefined && Number(existing.bodyRevision) === entry.current_revision
          && typeof existing.rawText === 'string' && existing.rawText.trim() !== '') {
          throw new StoryError('summary-exists', `第 ${number} 章当前版本已有摘要：作者的主动重写请走手动 story_summarize`)
        }
      }
      const points = [...text]
      const truncated = points.length > SUMMARY_MAX_CHARS
      const rawText = truncated ? points.slice(0, SUMMARY_MAX_CHARS).join('') : text
      const written = writeChapterSummaryOnDb(db, {
        work: workId, chapter: number, bodyRevision: entry.current_revision, content: { ...source, rawText },
      })
      syncSearchDoc(db, `summary:${number}`, 'summary', `summaries/${chapterStem(number)}`, number,
        summarySearchText(written.content))
      touchMeta(db)
      return {
        workId,
        chapter: number,
        chars,
        truncated,
        summaryRevision: entry.current_revision,
        artifact: { workId, artifactId: written.artifactId, revisionId: written.revisionId, kind: 'summary' },
      }
    })
  } finally {
    db.close()
  }
}

/** Search document text of one summary: raw text plus the structured fields. */
function summarySearchText(content: any) {
  const structure = SUMMARY_FIELDS
    .map(field => (typeof content[field] === 'string' ? content[field].trim() : ''))
    .filter(text => text !== '')
  return [content.rawText ?? '', ...structure].filter(text => text !== '').join('\n')
}

/**
 * Read one chapter summary's raw text.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {string|undefined} summary text.
 */
export function readSummary(root: any, work: any, chapter: any) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    return latestSummaryContent(db, number)?.rawText
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
export function readSummaryState(root: any, work: any, chapter: any) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    return summaryStateOf(db, number)
  } finally {
    db.close()
  }
}

/** Summary states for every chapter of one work, ascending. */
export function listSummaryStates(root: any, work: any) {
  const db = openWork(root, work)
  try {
    return [...summaryStateMap(db)].map(([number, state]) => ({ number, ...state }))
  } finally {
    db.close()
  }
}

/** Every summary of one work, ascending, with its structured character list. */
export function listSummaries(root: any, work: any) {
  const db = openWork(root, work)
  try {
    const summaries = []
    for (const row of latestSummaryRows(db)) {
      const content = parseSummaryContent(row.content, row.artifact_id)
      if (content === undefined || typeof content.rawText !== 'string' || content.rawText.trim() === '') continue
      summaries.push({
        number: Number(row.artifact_id.slice('summary:'.length)),
        text: content.rawText,
        characters: typeof content.characters === 'string' ? content.characters : '',
      })
    }
    return summaries
  } finally {
    db.close()
  }
}

/** Latest summary per chapter, rendered for the export file set. */
function exportSummaryRows(db: any) {
  const summaries = []
  for (const row of latestSummaryRows(db)) {
    const content = parseSummaryContent(row.content, row.artifact_id)
    if (content === undefined || typeof content.rawText !== 'string' || content.rawText.trim() === '') continue
    const text = content.rawText.endsWith('\n') ? content.rawText : `${content.rawText}\n`
    summaries.push({ number: Number(row.artifact_id.slice('summary:'.length)), text })
  }
  return summaries
}

/**
 * Read-only settlement gate shared by `story_state` and the automatic settler.
 * @param {object} db - open work database.
 * @param {number} number - chapter number.
 * @returns {{entry: object, review: object, summaryState: object}} gate context.
 */
function assertStateGate(db: any, number: any, options = {}) {
  const entry = chapterRow(db, number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  if (stageOf(entry) === 'settled') {
    throw new StoryError('chapter-settled', `第 ${number} 章已定稿：不能重复归档；改稿请先 reopen`)
  }
  if ((options as any).requireBody === true && Number(entry.current_revision) === 0) {
    throw new StoryError('chapter-not-written', `第 ${number} 章还没有正文：先写正文，审稿与修订后再定稿`)
  }
  const review = latestReviewRow(db, number)
  if (review === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿清单：先审稿与修订，再定稿`)
  const covers = reviewCovers(review, entry)
  const open = openObservations(review)
  if (open.length > 0) {
    throw new StoryError('review-required',
      `第 ${number} 章还有 ${open.length} 条未处理审稿：${open.map((item: any) => item.id).join('、')}；先修订再定稿`)
  }
  if (!covers) throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
  if (isCleanReview(review) && review.revision !== entry.current_revision) {
    throw new StoryError('review-required', `第 ${number} 章的清稿审稿针对旧版本 r${review.revision}：先重新审稿`)
  }
  const summaryState = summaryStateOf(db, number)
  if (summaryState.state === 'missing') {
    throw new StoryError('summary-required', `第 ${number} 章还没有摘要：先写摘要，再定稿`)
  }
  if (summaryState.state === 'stale') {
    throw new StoryError('summary-stale',
      `第 ${number} 章摘要针对旧版本 r${summaryState.revision ?? '?'}：先重写摘要，再定稿`)
  }
  return { entry, review, summaryState }
}

/**
 * Append one raw v2 state event (hook/fact op). The event is the source;
 * projections are rebuilt from the log by `applyFactOp`/`applyHookOp` in
 * `state-projection.js`, which also owns op validation.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number, kind: string, payload: object}} input - event.
 * @returns {{seq: number}} appended event sequence.
 */
export function appendStateEvent(root: any, input: any) {
  const chapter = Number(input.chapter)
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new StoryError('invalid-chapter', `状态事件的章号必须是非负整数：${String(input.chapter)}`)
  }
  const kind = String(input.kind ?? '').trim()
  if (kind !== 'hook' && kind !== 'fact') {
    throw new StoryError('state-op-invalid', `v2 状态事件只接受 hook/fact：${kind}`)
  }
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      if (chapter > 0) {
        const row = db.prepare('SELECT stage FROM chapters WHERE number = ?').get(chapter)
        if (row === undefined) throw new StoryError('chapter-not-found', `没有第 ${chapter} 章：不能追加状态事件`)
        if (row.stage === 'settled') {
          throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：先 reopen 再追加状态事件`)
        }
      }
      const seq = Number((db.prepare('SELECT max(seq) AS n FROM events').get() as { n: number } | undefined)?.n ?? 0) + 1
      const payload = JSON.stringify(input.payload)
      db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
        .run(seq, now(), chapter, kind, payload)
      syncSearchDoc(db, `event:${seq}`, kind, 'state/events', chapter, payload)
      touchMeta(db)
      return { seq }
    })
  } finally {
    db.close()
  }
}

/**
 * Normalize one settlement payload into ordered v2 ops.
 * `newHooks` candidates are minted host-side; an existing text becomes a mention.
 */
function stateOpsOf(input: any, chapter: any, projection: any) {
  const ops = []
  const factOps = input.factOps ?? {}
  const upserts = Array.isArray(factOps.upsert) ? factOps.upsert : []
  const expires = Array.isArray(factOps.expire) ? factOps.expire : []
  if (upserts.length > STATE_LIMITS.facts) {
    throw new StoryError('state-op-invalid', `factOps.upsert 最多 ${STATE_LIMITS.facts} 条`)
  }
  if (expires.length > STATE_LIMITS.facts) {
    throw new StoryError('state-op-invalid', `factOps.expire 最多 ${STATE_LIMITS.facts} 条`)
  }
  for (const fact of upserts) {
    ops.push({
      kind: 'fact',
      op: 'upsert',
      chapter,
      fact: { subject: fact?.subject, predicate: fact?.predicate, object: fact?.object },
      ...(fact?.source === undefined ? {} : { source: fact.source }),
    })
  }
  for (const selector of expires) ops.push({ kind: 'fact', op: 'expire', chapter, selector })
  const hookOps = input.hookOps ?? {}
  const transitions = []
  for (const name of ['progress', 'mention', 'defer', 'resolve', 'supersede']) {
    for (const hookId of Array.isArray(hookOps[name]) ? hookOps[name] : []) {
      transitions.push({ op: name, hookId })
    }
  }
  const candidates = Array.isArray(input.newHooks) ? input.newHooks : []
  if (transitions.length > STATE_LIMITS.hooks) {
    throw new StoryError('state-op-invalid', `hookOps 最多 ${STATE_LIMITS.hooks} 条`)
  }
  if (candidates.length > STATE_LIMITS.newHooks) {
    throw new StoryError('state-op-invalid', `newHooks 最多 ${STATE_LIMITS.newHooks} 条`)
  }
  for (const entry of transitions) ops.push({ kind: 'hook', op: entry.op, hookId: entry.hookId, chapter })
  const byText = new Map(projection.hooks.map((hook: any) => [hook.text, hook]))
  const boundedField = (value: any, label: any) => {
    const trimmed = String(value ?? '').trim()
    if (trimmed === '') throw new StoryError('state-op-invalid', `${label} 必须是非空字符串`)
    if ([...trimmed].length > STATE_LIMITS.text) throw new StoryError('state-op-invalid', `${label} 超过 ${STATE_LIMITS.text} 字`)
    return trimmed
  }
  const optionalField = (value: any, label: any) => {
    const trimmed = String(value ?? '').trim()
    if ([...trimmed].length > STATE_LIMITS.text) throw new StoryError('state-op-invalid', `${label} 超过 ${STATE_LIMITS.text} 字`)
    return trimmed
  }
  for (const candidate of candidates) {
    const text = boundedField(candidate?.text, '新伏笔 text')
    const existing = byText.get(text)
    if (existing !== undefined) {
      ops.push({ kind: 'hook', op: 'mention', hookId: (existing as any)?.hookId, chapter })
      continue
    }
    const hookId = mintHookId(text)
    ops.push({
      kind: 'hook',
      op: 'upsert',
      hook: {
        hookId,
        startChapter: chapter,
        type: optionalField(candidate?.type, '新伏笔 type') || '未分类',
        status: 'open',
        lastAdvancedChapter: chapter,
        expectedPayoff: optionalField(candidate?.expectedPayoff, '新伏笔 expectedPayoff'),
        notes: optionalField(candidate?.notes, '新伏笔 notes'),
        text,
      },
    })
    byText.set(text, { hookId, text })
  }
  return { ops }
}

/** Whether a chapter was reopened after its latest settlement. */
function chapterReopened(db: any, chapter: any) {
  const settle = db.prepare("SELECT max(seq) AS n FROM events WHERE chapter = ? AND kind = 'settle'").get(chapter)?.n ?? 0
  const reopen = db.prepare("SELECT max(seq) AS n FROM events WHERE chapter = ? AND kind = 'reopen'").get(chapter)?.n ?? 0
  return reopen > settle
}

/** Validate and plan one settlement without writing anything. */
function planSettlement(db: any, number: any, input: any, options = {}) {
  const previous = eventsOf(db)
  const projection = projectState(previous)
  const { ops } = stateOpsOf(input, number, projection)
  if (ops.length === 0 && input.allowEmpty !== true) {
    throw new StoryError('empty-state', '定稿归档至少要给出一条人物事实或伏笔变化')
  }
  if (typeof (options as any).beforeApply === 'function') (options as any).beforeApply()
  const allowReapply = chapterReopened(db, number)
  const events = [...previous]
  const appended = []
  for (const op of ops) {
    const result = op.kind === 'hook'
      ? applyHookOp(events, op, { allowReapply })
      : applyFactOp(events, op, { allowReapply })
    if (result.event === null) continue
    events.push(result.event)
    appended.push(result.event)
  }
  const counts = {
    facts: appended.filter(event => event.kind === 'fact').length,
    hooks: appended.filter(event => event.kind === 'hook' && event.op !== 'upsert').length,
    newHooks: appended.filter(event => event.kind === 'hook' && event.op === 'upsert').length,
  }
  return { counts, appended, projection: projectState(events) }
}

/**
 * Read-only settlement preview: validate ops and return the projection they
 * would produce, without writing events or touching the stage.
 * @param {string} root - workspace directory.
 * @param {object} input - same shape as `settleState`.
 * @returns {{counts: object, hooks: object[], facts: object[], appended: number}} projection preview.
 */
export function previewState(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const db = openWork(root, String(input.work))
  try {
    const plan = planSettlement(db, number, input)
    return {
      counts: plan.counts,
      hooks: plan.projection.hooks,
      facts: plan.projection.facts.filter(fact => fact.validUntilChapter === null),
      appended: plan.appended.length,
    }
  } finally {
    db.close()
  }
}

/**
 * Settle one chapter's state: validate the ops, append v2 hook/fact events, the
 * settle marker, and flip the chapter to settled. The only settlement writer.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, factOps?: object, hookOps?: object, newHooks?: object[], allowEmpty?: boolean, requireBody?: boolean}} input - settlement payload.
 * @returns {object} counts, active projection and the appended sequence number.
 */
export function settleState(root: string, input: any): any {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const { counts, appended, projection } = planSettlement(db, number, input, {
        beforeApply: () => assertStateGate(db, number, { requireBody: input.requireBody === true }),
      })
      let seq = db.prepare('SELECT max(seq) AS n FROM events').get()?.n ?? 0
      const at = now()
      for (const event of appended) {
        seq = Number(seq) + 1
        const { kind, ...payload } = event
        db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
          .run(seq, at, number, kind, JSON.stringify(payload))
        syncSearchDoc(db, `event:${seq}`, kind, 'state/events', number, JSON.stringify(payload))
      }
      seq = Number(seq) + 1
      db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
        .run(seq, at, number, 'settle', JSON.stringify({ kind: 'settle' }))
      db.prepare("UPDATE chapters SET stage = 'settled', status = 'settled', updated_at = ? WHERE number = ?").run(at, number)
      touchMeta(db, at)
      return {
        workId,
        chapter: number,
        appended: appended.length,
        seq,
        warnings: [],
        counts,
        hooks: projection.hooks,
        facts: projection.facts.filter(fact => fact.validUntilChapter === null),
        artifact: { path: virtualPath(workId, 'state/events.jsonl') },
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Read-only settlement gate for callers that must validate before writing.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string}} input - work/chapter.
 * @returns {{entry: object, review: object, summaryState: object}} gate context.
 */
export function statePreflight(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const db = openWork(root, String(input.work))
  try {
    return assertStateGate(db, number, { requireBody: input.requireBody === true })
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
export function readEvents(root: any, work: any, upToChapter: any = undefined) {
  const db = openWork(root, work)
  try {
    const rows = upToChapter === undefined
      ? db.prepare('SELECT * FROM events ORDER BY seq').all()
      : db.prepare('SELECT * FROM events WHERE chapter <= ? ORDER BY seq').all(chapterNumber(upToChapter))
    return rows.map((row: any) => ({ seq: row.seq, chapter: row.chapter, kind: row.kind, ...JSON.parse(String(row.payload)) }))
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
export function writeVolume(root: any, input: any) {
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
        if (from <= Number(other.to_ch) && Number(other.from_ch) <= to) {
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
export function readVolumes(root: any, work: any) {
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

// ---------------------------------------------------------------------------
// Truth files: characters stay in the bible table; the four editable text
// entries are artifacts (world/style/intent) plus the approved book plan
// (outline). They share one read/write surface here.
// ---------------------------------------------------------------------------

/** Artifact identity of every non-character truth entry. */
const TRUTH_ARTIFACTS = {
  world: { artifactId: 'bible:world', kind: 'world' },
  style: { artifactId: 'bible:style', kind: 'style' },
  intent: { artifactId: 'bible:intent', kind: 'intent' },
  plan: { artifactId: 'outline', kind: 'outline' },
}

/** All truth names in the order the bible surface lists them. */
const TRUTH_NAMES = ['characters', 'intent', 'plan', 'style', 'world']

/**
 * Write one truth entry. Characters keep the table (the six-field contract);
 * world/style/intent write a text artifact; plan is owned by `writeOutline`.
 * @param {string} root - workspace directory.
 * @param {{work: string, name: string, content: string, expectedVersion?: string}} input - entry input.
 * @returns {{workId: string, name: string, version: string}} receipt.
 */
export function writeBible(root: any, input: any) {
  const name = String(input.name ?? '').trim()
  if (name === '') throw new StoryError('bible-name-required', '真值需要 name')
  const content = String(input.content ?? '')
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      if (name === 'plan') throw new StoryError('approval-moved', '全书计划只能通过 story_outline 写入')
      const truth = (TRUTH_ARTIFACTS as Record<string, any>)[name]
      if (truth === undefined && name !== 'characters') {
        throw new StoryError('bible-invalid', `未知的真值文件：${name}`)
      }
      if (truth !== undefined) {
        if (input.expectedVersion !== undefined) {
          const current = readTextArtifactOnDb(db, truth.artifactId)
          if (current?.version !== input.expectedVersion) {
            throw new StoryError('bible-conflict', '真值已被修改；请刷新后再保存')
          }
        }
        const written = writeTextArtifactOnDb(db, {
          work: workId, artifactId: truth.artifactId, kind: truth.kind, content,
        })
        if (written.created) {
          syncSearchDoc(db, truth.artifactId, truth.kind, `bible/${name}`, 0, written.content)
        }
        touchMeta(db)
        return { workId, name, version: written.revisionId }
      }
      if (input.expectedVersion !== undefined) {
        const current = db.prepare('SELECT version FROM bible WHERE name = ?').get(name)
        if (current?.version !== input.expectedVersion) {
          throw new StoryError('bible-conflict', '真值已被修改；请刷新后再保存')
        }
      }
      const version = contentVersion(content)
      const at = now()
      db.prepare(`INSERT INTO bible (name, content, version, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET content = excluded.content, version = excluded.version, updated_at = excluded.updated_at`)
        .run(name, content, version, at)
      dropSearchDoc(db, 'card:characters')
      syncSearchDoc(db, 'card:characters', 'card', 'bible/characters', 0, content)
      touchMeta(db, at)
      return { workId, name, version }
    })
  } finally {
    db.close()
  }
}

/**
 * Read one truth entry.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} name - entry name.
 * @returns {{content: string, version: string, updated_at: string}|undefined} entry.
 */
export function readBibleEntry(root: any, work: any, name: any) {
  const db = openWork(root, work)
  try {
    const key = String(name)
    const truth = (TRUTH_ARTIFACTS as Record<string, any>)[key]
    if (truth !== undefined) return readTextArtifactOnDb(db, truth.artifactId)
    return db.prepare('SELECT content, version, updated_at FROM bible WHERE name = ?').get(key) as Pick<BibleRow, 'content' | 'version' | 'updated_at'> | undefined
  } finally {
    db.close()
  }
}

/**
 * Read every truth entry of one work.
 * Characters come from the bible table; the rest from artifacts.
 */
export function readBibleEntries(root: any, work: any) {
  const db = openWork(root, work)
  try {
    const entries = []
    for (const name of TRUTH_NAMES) {
      const truth = (TRUTH_ARTIFACTS as Record<string, any>)[name]
      const entry = truth === undefined
        ? db.prepare('SELECT content, version, updated_at FROM bible WHERE name = ?').get(name)
        : readTextArtifactOnDb(db, truth.artifactId)
      if (entry !== undefined) entries.push({ name, ...entry })
    }
    return entries
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
export function readBibleMap(root: any, work: any) {
  return new Map(readBibleEntries(root, work).map((row: any) => [row.name, row.content]))
}

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
 * @returns {{hooks: object[], facts: object[]}} projected state.
 */
export function readFoldedState(root: any, work: any) {
  return projectState(readEvents(root, work))
}

/**
 * Read one chapter plan text.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {string|undefined} plan text.
 */
export function readPlan(root: any, work: any, chapter: any) {
  const number = chapterNumber(chapter)
  const db = openWork(root, work)
  try {
    const row = db.prepare(`SELECT content_type, content FROM artifacts
      WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${number}`)
    if (row === undefined) return undefined
    if (row.content_type !== 'json') throw new StoryError('artifact-invalid', `plan:${number} 不是结构化 memo`)
    let memo
    try {
      memo = JSON.parse(String(row.content))
    } catch {
      throw new StoryError('artifact-invalid', `plan:${number} 的 memo JSON 无法解析`)
    }
    return renderChapterMemo(memo)
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
export function writeManagedCopy(root: any, prepared: any, write: any = writeSync) {
  const dir = materialsDir(root)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error: any) {
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
    } catch (error: any) {
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
function materialTitle(value: any) {
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
export function importMaterial(root: any, work: any, input: any) {
  const prepared = prepareMaterial(input)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const existing = db.prepare('SELECT * FROM materials WHERE hash = ?').get(prepared.hash) as unknown as MaterialRow | undefined
      if (existing !== undefined) return { material: materialMetadata(existing), duplicate: true }
      const copy = writeManagedCopy(root, prepared)
      try {
        const id = `mat-${prepared.hash.slice(0, 16)}`
        const at = now()
        try {
          db.prepare(`INSERT INTO materials (id, title, format, origin, bytes, hash, created_at, content, purpose)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, prepared.title, prepared.format, copy.origin, prepared.bytes, prepared.hash, at, prepared.content, prepared.purpose)
        } catch (error: any) {
          const raced = db.prepare('SELECT * FROM materials WHERE hash = ?').get(prepared.hash) as unknown as MaterialRow | undefined
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
          material: materialMetadata(db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as unknown as MaterialRow),
          duplicate: false,
        }
      } catch (error: any) {
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
export function listMaterials(root: any, work: any, purpose: any) {
  const clean = purpose === undefined ? undefined : normalizeMaterialPurpose(purpose)
  const db = openWork(root, work)
  try {
    const rows = clean === undefined
      ? db.prepare('SELECT * FROM materials ORDER BY created_at, id').all()
      : db.prepare('SELECT * FROM materials WHERE purpose = ? ORDER BY created_at, id').all(clean)
    return (rows as unknown as MaterialRow[]).map(materialMetadata)
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
export function renameMaterial(root: any, work: any, id: any, title: any) {
  const clean = materialTitle(title)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(String(id)) as unknown as MaterialRow | undefined
      if (row === undefined) throw new StoryError('material-not-found', `没有素材：${String(id)}`)
      db.prepare('UPDATE materials SET title = ? WHERE id = ?').run(clean, row.id)
      syncSearchDoc(db, `material:${row.id}`, 'material', `materials/${row.id}`, 0,
        String(row.content), materialIndexText(clean, String(row.content)))
      return materialMetadata({ ...row, title: clean } as MaterialRow)
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
export function setMaterialPurpose(root: any, work: any, id: any, purpose: any) {
  const clean = normalizeMaterialPurpose(purpose)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(String(id))
      if (row === undefined) throw new StoryError('material-not-found', `没有素材：${String(id)}`)
      db.prepare('UPDATE materials SET purpose = ? WHERE id = ?').run(clean, row.id)
      return materialMetadata({ ...row, purpose: clean } as MaterialRow)
    })
  } finally {
    db.close()
  }
}

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
  await backupWork(root, work)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const oldMax = Number(db.prepare('SELECT max(seq) AS seq FROM events').get()?.seq ?? 0)
      db.prepare('DELETE FROM chapters WHERE number = ?').run(number)
      db.prepare('DELETE FROM events WHERE chapter = ?').run(number)
      db.prepare("DELETE FROM search_docs WHERE (kind IN ('chapter', 'summary')) AND chapter = ?").run(number)
      db.prepare("DELETE FROM search_docs WHERE doc_id LIKE 'event:%' AND chapter = ?").run(number)
      applyChapterMapping(db, mapping)
      remapChapterArtifacts(db, { mapping, deleted: [number] })
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
    await backupWork(root, work)
    return transaction(db, () => {
      applyChapterMapping(db, mapping)
      remapChapterArtifacts(db, { mapping })
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
export function deleteMaterial(root: any, work: any, id: any) {
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
 * Search one work by FTS5.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} query - natural query.
 * @param {number} [limit] - result limit.
 * @returns {Array<object>} ranked documents.
 */
export function search(root: any, work: any, query: any, limit: any = 5) {
  const match = matchOf(query)
  if (match === '') return []
  const db = openWork(root, work)
  try {
    return queryDocs(db, { match, limit })
      .map((row: any) => ({ id: row.id, kind: row.kind, source: row.source, chapter: row.chapter, body: row.body, score: row.score }))
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
export function searchMemory(root: any, work: any, query: any, options: any = {}) {
  const beforeChapter = Number.isInteger(options.beforeChapter) ? options.beforeChapter : undefined
  const requested = Array.isArray(options.kinds) ? options.kinds.filter((kind: any) => MEMORY_KINDS.includes(kind)) : MEMORY_KINDS
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
    const materialIds = rows.filter((row: any) => row.kind === 'material').map((row: any) => row.id.slice('material:'.length))
    if (materialIds.length > 0) {
      const placeholders = materialIds.map(() => '?').join(', ')
      for (const row of db.prepare(`SELECT id, title, purpose FROM materials WHERE id IN (${placeholders})`).all(...materialIds)) {
        materialRows.set(`material:${row.id}`, row)
      }
    }
    const purposeFilter = Array.isArray(options.purposes)
      ? options.purposes.filter((purpose: any) => MATERIAL_PURPOSES.includes(purpose))
      : undefined
    const reopened = new Map(db.prepare("SELECT chapter, max(seq) AS seq FROM events WHERE kind = 'reopen' GROUP BY chapter")
      .all().map(row => [row.chapter, row.seq]))
    const hookProjection = new Map(projectState(eventsOf(db)).hooks.map(hook => [hook.hookId, hook]))
    const volumes = new Map(db.prepare('SELECT id, to_ch FROM volumes').all().map(row => [row.id, row.to_ch]))
    const candidates = []
    for (const row of rows) {
      const chapter = row.chapter
      if (['world', 'style', 'intent', 'outline', 'story_frame', 'volume_map', 'book_rules', 'role_index', 'role_card', 'current_focus'].includes(row.kind)) {
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter: null,
          text: row.body, score: -row.score,
        })
        continue
      }
      if (beforeChapter !== undefined && (chapter === null || chapter >= beforeChapter)) continue
      if (row.kind === 'summary') {
        if (chapter === null) continue
        const state = summaryStateOf(db, chapter)
        if (state.state !== 'current') continue
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter,
          text: state.text ?? row.body, score: -row.score,
        })
        continue
      }
      if (row.kind === 'hook') {
        const seq = Number(/^event:(\d+)$/u.exec(row.id)?.[1])
        if (!Number.isInteger(seq) || seq <= Number(reopened.get(chapter) ?? -1)) continue
        const event = db.prepare('SELECT chapter, payload FROM events WHERE seq = ?').get(seq)
        if (event === undefined) continue
        let payload
        try {
          payload = JSON.parse(String(event.payload))
        } catch {
          continue
        }
        if (typeof payload?.op !== 'string') continue
        const hookId = payload.op === 'upsert' ? payload.hook?.hookId : payload.hookId
        const hook = hookProjection.get(hookId)
        if (hook === undefined) continue
        if (!['open', 'progressing', 'deferred'].includes(hook.status)) continue
        candidates.push({
          id: row.id,
          kind: row.kind,
          source: row.source,
          sourceIds: ['state'],
          chapter,
          text: `${hook.text}（${hook.status}，第 ${chapter} 章）`,
          score: -row.score,
        })
        continue
      }
      if (row.kind === 'volume') {
        const id = String(row.id).startsWith('volume:') ? String(row.id).slice('volume:'.length) : undefined
        if (id === undefined || !volumes.has(id)) continue
        if (beforeChapter !== undefined && Number(volumes.get(id)) >= beforeChapter) continue
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
const MEMORY_KINDS = ['summary', 'hook', 'volume', 'material', 'world', 'style', 'intent', 'outline',
  'story_frame', 'volume_map', 'book_rules', 'role_index', 'role_card', 'current_focus']

/** Query tokens; shared by search and context retrieval. */
function queryTokens(query: any) {
  return searchTokens(query).split(' ').filter(token => token !== '')
}

/** Quote and OR-join tokens for one FTS match. */
function matchString(tokens: any) {
  return tokens.map((token: any) => `"${token.replaceAll('"', '""')}"`).join(' OR ')
}

/** FTS match string for one query, or '' when the query has no tokens. */
function matchOf(query: any) {
  return matchString(queryTokens(query))
}

/** One FTS query with the shared projection, ordering and limit. */
function queryDocs(db: any, { match, kinds, beforeChapter, limit }: any) {
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
      approvedAt: meta.outline_approved_at,
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
        planApprovedAt: chapter.plan_approved_at,
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
        put(join('materials', `${material.id}.${material.format}`), String(material.content))
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
      return { file, name, token: pattern.exec(name)![1], bytes: info.size, createdAt: info.mtime.toISOString() }
    })
}

/** List a work's backups with stable ids for routes/UI. */
export function listBackups(root: any, work: any) {
  const workId = String(work)
  return backupFiles(root, workId).map(entry => ({
    backupId: `backup:${workId}:${entry.token}`,
    file: entry.file,
    bytes: entry.bytes,
    createdAt: entry.createdAt,
  }))
}

/** Resolve a backupId without crossing into another work's files. */
function resolveBackupFile(root: any, workId: any, backupId: any) {
  const prefix = `backup:${workId}:`
  if (typeof backupId !== 'string' || !backupId.startsWith(prefix)) throw new StoryError('backup-not-found', '没有这个备份')
  const token = backupId.slice(prefix.length)
  if (!/^\d+$/u.test(token)) throw new StoryError('backup-not-found', '没有这个备份')
  const file = join(backupsDir(root), `${workId}-${token}.db`)
  if (!existsSync(file)) throw new StoryError('backup-not-found', '没有这个备份')
  return { file, token }
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

/** Delete old panel-created backups, keeping the newest `keep` files. */
export function pruneBackups(root: any, workId: any, keep: any) {
  if (keep === 0) return { removed: [] }
  const files = backupFiles(root, workId)
  const removed = []
  for (const entry of files.slice(keep)) {
    unlinkSync(entry.file)
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
    return { backupId }
  })
}

/**
 * Restore one backup over the current work, with an automatic safety backup.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} backupId - backup identity.
 * @param {{corruptCurrent?: boolean}} [options] - internal diagnostic path.
 * @returns {Promise<{workId: string, restoredBackup: string, safetyBackup: string|undefined, corrupt: boolean}>} receipt.
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
    try {
      const copy = openDatabase(stage, '备份无法读取')
      try {
        const version = Number(copy.prepare('PRAGMA user_version').get()?.user_version ?? 0)
        if (version !== WORK_SCHEMA_VERSION) {
          throw new StoryError('backup-invalid', `备份 schema v${version} 不是支持的 v${WORK_SCHEMA_VERSION}`)
        }
        if (integrityCheck(copy) !== 'ok') throw new StoryError('backup-invalid', '备份文件不完整')
      } finally {
        copy.close()
      }
    } catch (error: any) {
      removeDatabaseFiles(stage)
      if (error instanceof StoryError) throw error
      throw new StoryError('backup-invalid', `备份无法恢复：${error.message}`)
    }

    let corrupt = options.corruptCurrent === true
    let safetyBackup
    try {
      if (!corrupt) {
        try {
          safetyBackup = (await backupWork(root, workId)).file
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
      return { workId, restoredBackup: backupId, safetyBackup, corrupt }
    } finally {
      if (existsSync(stage)) removeDatabaseFiles(stage)
    }
  })
}

/**
 * Copy one work's database to a backup file with an integrity check.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} [destination] - backup file.
 * @returns {Promise<{file: string, integrity: string}>} backup result.
 */
export async function backupWork(root: any, work: any, destination: any = undefined) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  try {
    const row = catalogRow(catalog, work)
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const db = openWork(root, row.work_id)
    try {
      let file = destination
      if (file === undefined) {
        let stamp = Date.now()
        do {
          file = join(backupsDir(root), `${row.work_id}-${stamp}.db`)
          stamp += 1
        } while (existsSync(file))
      }
      try {
        await backupTo(db, file)
      } catch (error: any) {
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
export function createProposal(root: any, input: any) {
  const catalog = requireCatalog(root)
  try {
    return transaction(catalog, () => {
      const title = String(input.title ?? '').trim()
      if (title === '') throw new StoryError('proposal-invalid', '提案需要作品标题')
      const form = input.form === undefined ? 'longform' : String(input.form)
      if (!(WORK_FORMS as readonly string[]).includes(form)) throw new StoryError('proposal-invalid', `提案形态不合法：${form}`)
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
export function readProposal(root: any, id: any) {
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
export function markProposalUsed(root: any, id: any, workId: any) {
  const catalog = requireCatalog(root)
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
export function listProposals(root: any) {
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
export function deleteProposal(root: any, id: any) {
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
function pruneProposalRows(catalog: any, ttlMs: any) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString()
  return catalog.prepare('DELETE FROM proposals WHERE used_at IS NULL AND created_at < ?').run(cutoff).changes
}

/**
 * Prune unused proposals older than the TTL.
 * @param {string} root - workspace directory.
 * @param {number} ttlMs - age threshold.
 * @returns {{removed: number}} removal count.
 */
export function pruneProposals(root: any, ttlMs: any = PROPOSAL_TTL_MS) {
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
export function setSessionCurrent(root: any, sessionId: any, workId: any) {
  const catalog = requireCatalog(root)
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
export function clearSessionCurrent(root: any, sessionId: any) {
  const catalog = requireCatalog(root)
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
export function readSessionCurrent(root: any) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return {}
  try {
    const out: Record<string, string> = {}
    for (const row of catalog.prepare('SELECT session_id, work_id FROM session_current').all()) {
      if (typeof row.work_id === 'string' && row.work_id !== '') out[String(row.session_id)] = String(row.work_id)
    }
    return out
  } finally {
    catalog.close()
  }
}
