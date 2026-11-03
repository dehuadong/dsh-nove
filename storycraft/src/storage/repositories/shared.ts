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
import type { Database } from '../../storage/db.ts'
import type { ArtifactRow, BibleRow, ChapterRow, ChapterVersionRow, EventRow, MaterialRow, MetaRow, VolumeRow, WorkRow } from '../../store-rows.ts'

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
} from '../../storage/db.ts'
import { MATERIAL_PURPOSES, MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from '../../materials.ts'
import { chapterRemap } from '../../chapter-edit.ts'
import { filterChapters, filterWorks, workStatus, type ChapterFilters, type WorkFilters } from '../../work-filters.ts'
import { buildEpub } from '../../epub.ts'
import { snippetFor } from '../../retrieval.ts'
import { materialIndexText, searchTokens } from '../../search-text.ts'
import { dropSearchDoc, syncSearchDoc } from '../../search-index.ts'
import { STATE_LIMITS, applyFactOp, applyHookOp, mintHookId, projectState } from '../../state-projection.ts'

export { searchTokens }
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

/** How long an unused proposal is kept before the next proposal write prunes it. */
export const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Fixed mtime of export files, so directory copies stay reproducible. */
export const EXPORT_MTIME = new Date('2000-01-01T00:00:00.000Z')

/** In-process export queues, keyed by workspace + work id. */
export const exportLocks = new Map()

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
export function catalogRow(db: Database, workId: unknown): WorkRow | undefined {
  return db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(workId)) as WorkRow | undefined
}

/** The catalog row of an active work, or `work-not-found`. */
export function activeWork(db: Database, workId: unknown): WorkRow {
  const row = catalogRow(db, workId)
  if (row === undefined || row.trashed_at !== null) throw new StoryError('work-not-found', `没有作品：${String(workId)}`)
  return row
}

/** Read `meta`, the single row of one work database. */
export function requireCatalog(root: string): Database {
  const catalog = openCatalog(root)
  if (catalog === undefined) throw new StoryError('db-corrupt', '作品目录无法打开')
  return catalog
}

export function metaOf(db: Database): MetaRow {
  const row = db.prepare('SELECT * FROM meta WHERE id = 1').get() as MetaRow | undefined
  if (row === undefined) throw new StoryError('db-corrupt', '作品库缺少 meta 行')
  return row
}

/** Whether one chapter exists. */
export function chapterRow(db: Database, number: number): ChapterRow | undefined {
  return db.prepare('SELECT * FROM chapters WHERE number = ?').get(number) as ChapterRow | undefined
}

/** Insert a planned chapter row when absent. */
export function ensureChapter(db: Database, number: number): ChapterRow | undefined {
  const existing = chapterRow(db, number)
  if (existing !== undefined) return existing
  db.prepare('INSERT INTO chapters (number, updated_at) VALUES (?, ?)').run(number, now())
  return chapterRow(db, number)
}

/**
 * Whether the author's plan confirmation still covers the current memo.
 *
 * A chapter without a memo has nothing to confirm yet; once `plan:<n>` exists,
 * the confirmed revision must be its latest revision. There is no plan-text
 * fallback: an old work is deleted and rebuilt, never migrated.
 */
export function planGateSatisfied(db: any, entry: any) {
  return planApprovalState(db, entry.number).approved
}

/** Non-throwing approval state for read paths and next-step derivation. */
export interface PlanApprovalState { required: boolean, approved: boolean, blocked: boolean, hasMemo: boolean }

export function planApprovalState(db: Database, chapter: unknown): PlanApprovalState {
  const number = chapterNumber(chapter)
  const entry = db.prepare('SELECT * FROM chapters WHERE number = ?').get(number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const required = metaOf(db).plan_approval === 'required'
  const memoRevision = artifactRevisionOf(db, `plan:${number}`)
  if (!required) return { required: false, approved: true, blocked: false, hasMemo: memoRevision !== undefined }
  if (memoRevision === undefined) return { required: true, approved: false, blocked: false, hasMemo: false }
  const approved = entry.plan_approved_at !== null && entry.plan_revision === memoRevision
  return { required: true, approved, blocked: !approved, hasMemo: true }
}

/** Throwing approval gate for write/revise paths. */
export function assertPlanApproved(db: Database, chapter: unknown): void {
  const state = planApprovalState(db, chapter)
  if (!state.hasMemo) throw new StoryError('plan-not-found', `第 ${chapterNumber(chapter)} 章还没有章纲`)
  if (state.blocked) throw new StoryError('plan-not-approved', `第 ${chapterNumber(chapter)} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」`, '请在面板「章纲」里确认，或先改章纲')
}

/**
 * Latest ChapterSummary content of one chapter, parsed from `summary:<n>`.
 * @param {import('node:sqlite').DatabaseSync} db - open work database.
 * @param {number} number - chapter number.
 * @returns {object|undefined} summary content, or undefined when absent.
 */
export function latestSummaryContent(db: Database, number: number): any {
  const row = db.prepare('SELECT content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(`summary:${number}`)
  return row === undefined ? undefined : parseSummaryContent(String(row.content), `summary:${number}`)
}

/** Parse one stored summary JSON; a malformed row is reported by id. */
export function parseSummaryContent(text: string, artifactId: string): any {
  try {
    const content = JSON.parse(text)
    return content !== null && typeof content === 'object' ? content : undefined
  } catch {
    throw new StoryError('artifact-invalid', `${artifactId} 的 summary JSON 无法解析`)
  }
}

/** Derive the summary state from chapter revision and summary content. */
export function summaryStateOfContent(content: any, currentRevision: number): { state: 'current' | 'stale' | 'missing', text: string | undefined, revision: number | null, currentRevision: number } {
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
export function latestSummaryRows(db: any) {
  return db.prepare(`SELECT a.artifact_id, a.scope_chapter, a.content FROM artifacts a
    JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts
      WHERE kind = 'summary' GROUP BY artifact_id) latest ON a.rowid = latest.rowid
    ORDER BY a.scope_chapter`).all()
}

/** Summary state for every chapter of one work, keyed by chapter number. */
export function summaryStateMap(db: Database): Map<number, any> {
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
export function summaryStateFrom(map: any, number: any) {
  const state = map.get(number)
  if (state === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  return state
}

/** All review artifacts of one chapter, oldest first. */
export function reviewRecords(db: any, number: any) {
  return db.prepare(`SELECT artifact_id, revision_id, content, created_at, input_revision FROM artifacts
    WHERE kind = 'review' AND scope_chapter = ? ORDER BY rowid`).all(number)
    .map((row: any) => {
      const match = /^review:(\d+):r(\d+):(\d+)$/u.exec(String(row.artifact_id))
      const content = JSON.parse(String(row.content))
      // A review written before the column existed carries no binding; it falls
      // back to the revision check instead of becoming permanently stale.
      const stale = row.input_revision === null || row.input_revision === undefined
        ? false
        : row.input_revision !== reviewInputOf(db, number)
      return {
        artifactId: row.artifact_id,
        revisionId: row.revision_id,
        round: Number(match?.[3] ?? 0),
        revision: Number(match?.[2] ?? 0),
        observations: Array.isArray(content.observations) ? content.observations : [],
        stale,
      }
    })
}

/** The newest review artifact of one chapter. */
export function latestReviewRow(db: any, number: any) {
  const records = reviewRecords(db, number)
  return records.length === 0 ? undefined : records[records.length - 1]
}

/** Observations still blocking settlement. */
export function openObservations(review: any) {
  return (review?.observations ?? []).filter((observation: any) => observation.assessment === 'issue')
}

/** One block of material a judgement point presents to the author. */
export interface AskMaterial {
  kind: string
  items: string[]
}

/** The material and the single question a judgement point asks. */
export interface NextAsk {
  present: AskMaterial[]
  question: string
}

/** Observation lines the author needs to triage one review round. */
export function openObservationLines(review: any): string[] {
  return openObservations(review)
    .slice(0, 8)
    .map((observation: any) => `${observation.id}｜${String(observation.severity ?? '')}｜${String(observation.summary ?? '')}｜改法：${String(observation.fix ?? '')}`)
}

/**
 * Fingerprint of the latest foundation artifacts: one revision id per artifact,
 * sorted, hashed. Any rewritten stage changes it and invalidates the approval.
 */
export function foundationRevisionOf(db: any): string {
  const entries: string[] = []
  const latest = db.prepare('SELECT artifact_id, revision_id FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
  for (const artifactId of [...FOUNDATION_STAGE_ARTIFACTS.frame, ...FOUNDATION_STAGE_ARTIFACTS.rules, ...FOUNDATION_STAGE_ARTIFACTS.hooks, ...FOUNDATION_STAGE_ARTIFACTS.roles]) {
    const revision = artifactRevisionOf(db, artifactId)
    if (revision !== undefined) entries.push(`${artifactId}@${revision}`)
  }
  const cards = new Map<string, string>()
  for (const row of db.prepare("SELECT artifact_id, revision_id FROM artifacts WHERE kind = 'role_card' ORDER BY rowid").all()) {
    cards.set(String(row.artifact_id), String(row.revision_id))
  }
  for (const [artifact_id, revision_id] of [...cards.entries()].sort()) entries.push(`${artifact_id}@${revision_id}`)
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

/**
 * The author's foundation confirmation, only while the confirmed fingerprint is
 * still the latest one.
 */
export function foundationApprovedAt(db: any): string | undefined {
  const meta = metaOf(db)
  if (meta.foundation_approved_at === null || meta.foundation_approved_at === undefined) return undefined
  if (meta.foundation_approved_revision !== foundationRevisionOf(db)) return undefined
  return meta.foundation_approved_at
}

/** Latest revision id of one artifact, or undefined when it was never written. */
export function artifactRevisionOf(db: any, artifactId: string): string | undefined {
  const row = db.prepare('SELECT revision_id FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1').get(artifactId)
  return row === undefined ? undefined : String(row.revision_id)
}

/** Latest全书计划 revision id. */
export function outlineRevisionOf(db: any): string | undefined {
  return artifactRevisionOf(db, 'outline')
}

/**
 * The author's outline confirmation, only while the confirmed revision is still
 * the latest one: any rewrite invalidates it without clearing the timestamp.
 */
export function outlineApprovedAt(db: any): string | undefined {
  const meta = metaOf(db)
  if (meta.outline_approved_at === null || meta.outline_approved_at === undefined) return undefined
  const revision = outlineRevisionOf(db)
  if (revision === undefined || meta.outline_approved_revision !== revision) return undefined
  return meta.outline_approved_at
}

/** The plan memo (five fields) of one chapter, when it is readable. */
export function planMemoFrom(db: any, chapter: any): any {
  try {
    const row = db.prepare(`SELECT content_type, content FROM artifacts
      WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${chapter}`)
    if (row === undefined || row.content_type !== 'json') return undefined
    return JSON.parse(String(row.content))
  } catch {
    return undefined
  }
}

/**
 * The single method reference the next action needs.
 *
 * The host, not the skill, decides which reference a node reads: a resident
 * skill that lists every reference would show planning material at writing time.
 */
export function methodFor(step: any, form: string): { skill: string; reference?: string } | undefined {
  return methodForStep(step.action, form)
}

/**
 * The judgement material attached to a step.
 *
 * Only the decisions a `story_next` step can actually carry get an `ask` here:
 * 章纲 (five fields), 审稿取舍+修订 (open observations with fix), 正文验收
 * (revision cap: version and words), 章间 (previous chapter settled). 结算失败
 * cannot be one of them — findings only exist after `story_settle` runs, so that
 * point is carried by the settle receipt itself.
 */
/** Normalise the approval source; an unknown value is a caller error. */
/** The author's words, bounded; empty stays null. */
export function approvalReasonOf(input: any): string | null {
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''
  return reason === '' ? null : reason.slice(0, 200)
}

export function approvalSourceOf(input: any): 'panel' | 'conversation' {
  const source = input?.source
  if (source === undefined) return 'panel'
  if (source === 'panel' || source === 'conversation') return source
  throw new StoryError('approval-source-invalid', `未知的批准来源：${String(source)}`, '来源只能是 panel 或 conversation')
}

/** One sentence per foundation stage, for the confirmation ask. */
export function foundationSummaryOf(db: any): string[] {
  const line = (text: string) => (String(text).split(/\r?\n/u).find(item => item.trim() !== '' && !item.trim().startsWith('#')) ?? '').trim().slice(0, 60)
  const read = (artifactId: string) => {
    const row = db.prepare('SELECT content, content_type FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1').get(artifactId)
    if (row === undefined) return ''
    if (row.content_type === 'json') {
      try {
        const parsed = JSON.parse(String(row.content))
        return String(parsed?.markdown ?? '')
      } catch {
        return ''
      }
    }
    return String(row.content)
  }
  const rolesRow = db.prepare('SELECT content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1').get('roles:index')
  let roleCount = 0
  try {
    const parsed = rolesRow === undefined ? undefined : JSON.parse(String(rolesRow.content))
    roleCount = Array.isArray(parsed?.roles) ? parsed.roles.length : 0
  } catch {
    roleCount = 0
  }
  const cards = db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'role_card'").get()
  let hookCount = 0
  try {
    const hooksRow = db.prepare('SELECT content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1').get('bible:hooks')
    const parsed = hooksRow === undefined ? undefined : JSON.parse(String(hooksRow.content))
    hookCount = Array.isArray(parsed?.hooks) ? parsed.hooks.length : 0
  } catch {
    hookCount = 0
  }
  return [
    `故事框架：${line(read('bible:story_frame')) || '已生成'}`,
    `作品规则：${line(read('bible:book_rules')) || '已生成'}`,
    `初始伏笔：${hookCount} 条`,
    `角色：${roleCount} 人`,
    `角色卡：${Number(cards?.n ?? 0)} 张`,
  ]
}
export function askFor(step: any, last: any, candidate: any, planMemo?: any, foundationSummary?: string[]): NextAsk | undefined {
  const blocked: string[] = Array.isArray(step.blocked) ? step.blocked : []
  const chapter = step.chapter
  const currentRevision = last?.currentRevision ?? 0
  const words = last?.words ?? 0
  if (blocked.includes('foundation-approval')) {
    return {
      present: [{ kind: 'text', items: foundationSummary ?? ['故事框架', '作品规则', '角色索引', '角色卡'] }],
      question: '确认基础设定吗？还是要改哪一阶段？',
    }
  }
  if (blocked.includes('plan-approval')) {
    const items = planMemo === undefined
      ? [`plan:${chapter}`]
      : [
          `视角 ${String(planMemo.perspective ?? '')}`,
          `目标 ${String(planMemo.goal ?? '')}`,
          `阻力 ${String(planMemo.obstacle ?? '')}`,
          `代价 ${String(planMemo.cost ?? '')}`,
          `结尾 ${String(planMemo.turn ?? '')}`,
        ]
    return {
      present: [{ kind: 'plan', items }],
      question: '按这个章纲写正文，还是先改哪一项？',
    }
  }
  if (blocked.includes('revision-limit')) {
    return {
      present: [{ kind: 'text', items: [`第 ${chapter} 章 r${currentRevision}`, `${words} 字`, `${openObservations(candidate).length} 条未处理`] }],
      question: '接受当前版本，还是继续修订这一章？',
    }
  }
  if (step.action === 'story_revise') {
    return {
      present: [{ kind: 'observation', items: openObservationLines(candidate) }],
      question: '哪几条改（其余不改）？用 patch / polish / rewrite / deslop 中的哪一种？',
    }
  }
  if (step.action === 'story_plan' && !blocked.includes('outline-approval') && !blocked.includes('foundation-approval')
    && currentRevision > 0 && last?.stage === 'settled') {
    return {
      present: [{ kind: 'text', items: [`第 ${last.number} 章已定稿`] }],
      question: '现在开始下一章章纲，还是先停？',
    }
  }
  return undefined
}

/** The current body row of one chapter. */
export function currentVersion(db: Database, chapter: ChapterRow): ChapterVersionRow | undefined {
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
export function reviewCovers(review: any, chapter: any, allowPrevious = false) {
  const current = chapter.currentRevision ?? chapter.current_revision
  if (review === undefined || current === undefined) return false
  if (review.stale === true) return false
  return review.revision === current || (allowPrevious && review.revision === current - 1)
}

/** A clean review records zero observations and authorizes the clean settlement path. */
export function isCleanReview(review: any) {
  return review !== undefined && review.observations.length === 0
}

/** Newest review artifact per chapter, shared by status and analysis. */
export function latestReviewRows(db: any) {
  return db.prepare(`SELECT a.scope_chapter AS chapter, a.content FROM artifacts a
    JOIN (SELECT scope_chapter, max(rowid) AS rowid FROM artifacts
      WHERE kind = 'review' AND scope_chapter IS NOT NULL GROUP BY scope_chapter) latest
      ON a.rowid = latest.rowid`).all()
}

/** Open observation count per chapter, from each chapter's newest review artifact. */
export function openProblemCountByChapter(db: any) {
  const rows = latestReviewRows(db)
  const counts = new Map()
  for (const row of rows) {
    const content = JSON.parse(String(row.content))
    counts.set(row.chapter, openObservations({ observations: content.observations }).length)
  }
  return counts
}

/** Latest-review issue counts for the analysis panel; no review text. */
export function reviewDistribution(root: any, work: any) {
  const db = openWork(root, work)
  try {
    const rows = latestReviewRows(db) as any[]
    const bySeverity = { blocking: 0, major: 0, minor: 0, unspecified: 0 }
    const byCategory = { execution: 0, quality: 0, scope: 0 }
    const chapters: Array<{ chapter: number, issues: number, resolved: number }> = []
    let total = 0
    let resolved = 0
    for (const row of rows) {
      const content = JSON.parse(String(row.content))
      const observations = Array.isArray(content.observations) ? content.observations : []
      const issues = openObservations({ observations })
      const resolvedHere = observations.filter((item: any) => item.assessment === 'resolved')
      for (const item of issues) {
        total += 1
        const severity = (item.severity === 'blocking' || item.severity === 'major' || item.severity === 'minor' ? item.severity : 'unspecified') as keyof typeof bySeverity
        bySeverity[severity] += 1
        if (item.category === 'execution' || item.category === 'quality' || item.category === 'scope') byCategory[item.category as keyof typeof byCategory] += 1
      }
      resolved += resolvedHere.length
      chapters.push({ chapter: Number(row.chapter), issues: issues.length, resolved: resolvedHere.length })
    }
    chapters.sort((left, right) => left.chapter - right.chapter)
    return { issues: { total, bySeverity, byCategory }, resolved, chapters }
  } finally {
    db.close()
  }
}

/** Serialize every event row as JSONL for export and `story_read(state)`. */
export function eventsText(db: Database): string {
  return db.prepare('SELECT * FROM events ORDER BY seq').all()
    .map((row: any) => JSON.stringify({ seq: row.seq, at: row.at, chapter: row.chapter, kind: row.kind, ...JSON.parse(String(row.payload)) }))
    .join('\n')
}

/** Flatten every event row into the shape the v2 projection consumes. */
export function eventsOf(db: Database): any[] {
  return db.prepare('SELECT seq, chapter, kind, payload FROM events ORDER BY seq')
    .all().map((row: any) => ({ seq: row.seq, chapter: row.chapter, kind: row.kind, ...JSON.parse(String(row.payload)) }))
}

/** Project one work's event log: hook/fact events are the only source. */
export function foldedOf(db: any) {
  return projectState(eventsOf(db))
}

/** The default truth rows a new work ships. */
export const DEFAULT_BIBLE = {
  world: '# 世界观\n',
  characters: '[]\n',
  style: '# 文风基准\n',
  plan: '# 写作计划\n',
  intent: '# 作者意图与当前焦点\n',
}

/** Artifacts each stage produces, in write order. */
export const FOUNDATION_STAGE_ARTIFACTS = {
  frame: ['bible:story_frame', 'bible:volume_map', 'bible:current_focus'],
  rules: ['bible:book_rules'],
  hooks: ['bible:hooks'],
  roles: ['roles:index'],
  cards: null,
}

