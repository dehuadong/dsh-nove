/** state.ts repository. */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import type { Database } from '../db.ts'
import type { ArtifactRow, BibleRow, ChapterRow, ChapterVersionRow, EventRow, MaterialRow, MetaRow, VolumeRow, WorkRow } from '../store-rows.ts'
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
  renderReviewMarkdown,
} from '../../storage/repositories/reviews.ts'
import {
  virtualPath,
  chapterRow,
  latestSummaryContent,
  parseSummaryContent,
  summaryStateOf,
  latestSummaryRows,
  summaryStateMap,
  latestReviewRow,
  openObservations,
  reviewCovers,
  isCleanReview,
  eventsOf,
} from './shared.ts'
import type {
  WriteSummaryInput,
} from '../types.ts'
import {
  status,
} from '../../store-db.ts'

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
export function summarySearchText(content: any) {
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
export function exportSummaryRows(db: any) {
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

/** The artifact kind of a pre-finalize state proposal. */
const STATE_DRAFT_KIND = 'state_draft'

/** Remove every state draft of one chapter, plus its search documents. */
function dropStateDraftOnDb(db: any, number: number): void {
  for (const row of db.prepare("SELECT artifact_id FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ?").all(number)) {
    dropSearchDoc(db, String(row.artifact_id))
  }
  db.prepare("DELETE FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ?").run(number)
}

/** Invalidate draft state after the body revision changes or the chapter moves. */
export function invalidateStateDraftOnDb(db: any, number: number): void {
  dropStateDraftOnDb(db, number)
  db.prepare('UPDATE chapters SET state_ready_revision = 0, updated_at = ? WHERE number = ?').run(now(), number)
}

/** Write one state draft for the chapter's current revision. */
function writeStateDraftOnDb(db: any, root: string, workId: string, number: number, input: any) {
  const entry = chapterRow(db, number)
  if (entry === undefined || Number(entry.current_revision) === 0) {
    throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能结算`)
  }
  const revision = Number(entry.current_revision)
  const artifactId = `state:draft:${number}:r${revision}`
  dropStateDraftOnDb(db, number)
  const content = {
    chapter: number,
    revision,
    factOps: input.factOps ?? {},
    hookOps: input.hookOps ?? {},
    newHooks: Array.isArray(input.newHooks) ? input.newHooks : [],
    findings: Array.isArray(input.findings) ? input.findings : [],
    ready: input.ready === true,
    resolvedBy: input.resolvedBy === 'author' ? 'author' : null,
    createdAt: now(),
  }
  const at = now()
  const envelope = validateArtifactRecord({
    workId,
    artifactId,
    kind: STATE_DRAFT_KIND,
    scope: { chapter: number },
    revisionId: contentVersion(content),
    content,
    provenance: 'generated',
    createdAt: at,
  })
  putArtifactOnDb(db, envelope, {
    search: { docId: artifactId, kind: STATE_DRAFT_KIND, source: `state/draft/${number}`, text: JSON.stringify(content) },
  })
  db.prepare('UPDATE chapters SET state_ready_revision = ?, updated_at = ? WHERE number = ?').run(revision, at, number)
  return { artifactId, revisionId: envelope.revisionId, revision, ready: content.ready }
}

/** The newest draft of one chapter, with its readiness and body revision. */
export function readStateDraft(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    const row = db.prepare("SELECT artifact_id, revision_id, content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(number)
    if (row === undefined) return undefined
    const content = JSON.parse(String(row.content))
    return {
      artifactId: String(row.artifact_id),
      revisionId: String(row.revision_id),
      revision: Number(content.revision),
      ready: content.ready === true,
      findings: Array.isArray(content.findings) ? content.findings : [],
      content,
    }
  } finally {
    db.close()
  }
}

/** Write a draft produced by the settlement chain (no state events). */
export function writeStateDraft(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => writeStateDraftOnDb(db, root, workId, number, input))
  } finally {
    db.close()
  }
}

/** The author accepts the current draft as-is. */
export function markStateDraftReady(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const row = db.prepare("SELECT content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(number)
      if (row === undefined) throw new StoryError('draft-not-found', `第 ${number} 章没有状态草案：先结算`)
      const content = JSON.parse(String(row.content))
      const entry = chapterRow(db, number)
      if (entry === undefined || Number(content.revision) !== Number(entry.current_revision)) {
        throw new StoryError('draft-stale', `第 ${number} 章的状态草案不是当前版本：先重新结算`)
      }
      return writeStateDraftOnDb(db, root, workId, number, { ...content, ready: true, findings: content.findings })
    })
  } finally {
    db.close()
  }
}

/** Merge the author's ops into the current draft (creating it when absent). */
export function mergeStateDraft(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || Number(entry.current_revision) === 0) {
        throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能结算`)
      }
      if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改状态要先 reopen`)
      const revision = Number(entry.current_revision)
      const row = db.prepare("SELECT content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(number)
      const previous = row === undefined ? { revision, factOps: {}, hookOps: {}, newHooks: [], findings: [] } : JSON.parse(String(row.content))
      const hasOps = (input.factOps !== undefined && Object.keys(input.factOps ?? {}).length > 0)
        || (input.hookOps !== undefined && Object.keys(input.hookOps ?? {}).length > 0)
        || (Array.isArray(input.newHooks) && input.newHooks.length > 0)
      if (row === undefined && !hasOps) {
        throw new StoryError('empty-state', '定稿归档至少要给出一条人物事实或伏笔变化')
      }
      const factOps = { ...(previous.factOps ?? {}) }
      if (input.factOps !== undefined) {
        const upsert = new Map<string, any>()
        for (const item of [...(factOps.upsert ?? []), ...(input.factOps.upsert ?? [])]) {
          upsert.set(`${String(item?.subject ?? '')}|${String(item?.predicate ?? '')}`, item)
        }
        factOps.upsert = [...upsert.values()]
        if (Array.isArray(input.factOps.expire) && input.factOps.expire.length > 0) {
          factOps.expire = [...(factOps.expire ?? []), ...input.factOps.expire]
        }
      }
      const hookOps = { ...(previous.hookOps ?? {}) }
      if (input.hookOps !== undefined) {
        for (const [key, value] of Object.entries(input.hookOps)) {
          if (!Array.isArray(value)) continue
          hookOps[key] = [...new Set([...(hookOps[key] ?? []), ...value])]
        }
      }
      const nextHooks = [...(previous.newHooks ?? []), ...(Array.isArray(input.newHooks) ? input.newHooks : [])]
      // Validate the merged ops before storing them: an invalid draft would only
      // fail later at finalize, after the author already saw \"ready\".
      planSettlement(db, number, { factOps, hookOps, newHooks: nextHooks, allowEmpty: true })
      return writeStateDraftOnDb(db, root, workId, number, {
        factOps,
        hookOps,
        newHooks: nextHooks,
        findings: [],
        ready: true,
        resolvedBy: 'author',
      })
    })
  } finally {
    db.close()
  }
}

/** Apply a settled draft: write the state events, the settle marker and lock. */
export function finalizeChapter(root: any, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined || Number(entry.current_revision) === 0) {
        throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能定稿`)
      }
      if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿`)
      assertStateGate(db, number, { requireBody: true })
      const row = db.prepare("SELECT artifact_id, content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(number)
      if (row === undefined) throw new StoryError('state-not-ready', `第 ${number} 章没有状态草案：先结算`)
      const draft = JSON.parse(String(row.content))
      if (draft.ready !== true) throw new StoryError('state-not-ready', `第 ${number} 章的状态草案还没被接受：先应用草案`)
      if (Number(draft.revision) !== Number(entry.current_revision) || Number(entry.state_ready_revision) !== Number(entry.current_revision)) {
        throw new StoryError('state-not-ready', `第 ${number} 章的状态草案不是当前版本：先重新结算`)
      }
      const result = applySettlementOnDb(db, number, {
        work: workId,
        chapter: number,
        factOps: draft.factOps,
        hookOps: draft.hookOps,
        newHooks: draft.newHooks,
        allowEmpty: true,
      })
      dropStateDraftOnDb(db, number)
      return result
    })
  } finally {
    db.close()
  }
}

/** Apply one settlement payload inside an open transaction. */
function applySettlementOnDb(db: any, number: number, input: any) {
  const latestMark = db.prepare("SELECT kind, payload FROM events WHERE chapter = ? AND kind IN ('reopen', 'settle') ORDER BY seq DESC LIMIT 1").get(number)
  const reopenRevision = latestMark?.kind === 'reopen' ? JSON.parse(String(latestMark.payload ?? '{}')).revision : undefined
  const wasReopened = reopenRevision !== undefined && Number(reopenRevision) === Number(chapterRow(db, number)?.current_revision)
  const { counts, appended, projection } = planSettlement(db, number, { ...input, allowEmpty: input.allowEmpty === true || wasReopened }, {
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
  db.prepare("UPDATE chapters SET stage = 'settled', status = 'settled', state_ready_revision = current_revision, updated_at = ? WHERE number = ?").run(at, number)
  touchMeta(db, at)
  return {
    workId: String(input.work),
    chapter: number,
    appended: appended.length,
    seq,
    warnings: [],
    counts,
    hooks: projection.hooks,
    facts: projection.facts.filter((fact: any) => fact.validUntilChapter === null),
    artifact: { workId: String(input.work), artifactId: 'state', revisionId: `seq:${seq}`, kind: 'state' },
  }
}

/** Low-level settlement writer: applies ops directly and locks the chapter. */
/** The stage of one chapter, or undefined when it does not exist. */
export function chapterStageOf(root: any, work: any, chapter: any) {
  const number = chapterNumber(chapter)
  const db = openWork(root, String(work))
  try {
    const entry = chapterRow(db, number)
    return entry === undefined ? undefined : stageOf(entry)
  } finally {
    db.close()
  }
}

export function settleState(root: string, input: any): any {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const result = applySettlementOnDb(db, number, input)
      dropStateDraftOnDb(db, number)
      // Fixture/test callers still read the legacy event-log path.
      return { ...result, artifact: { path: virtualPath(workId, 'state/events.jsonl') } }
    })
  } finally {
    db.close()
  }
}

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
