import {
  eventsText,
} from './shared.ts'
import {
  readEvents,
} from './state.ts'
import {
  backupWork,
} from './export.ts'

/** chapters.ts repository. */

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
  StoryError, SUMMARY_FIELDS, SUMMARY_MAX_CHARS, WORK_FORMS, chapterNumber, chapterStem, contentVersion, countChapterLength, countWords,
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
  virtualPath,
  metaOf,
  chapterRow,
  ensureChapter,
  planApprovalState,
  assertPlanApproved,
  latestSummaryContent,
  latestReviewRow,
  approvalReasonOf,
  approvalSourceOf,
} from './shared.ts'
import type {
  WriteChapterInput,
  ReadChapterInput,
} from '../types.ts'
import {
  readManifest,
  status,
} from './catalog.ts'
import { invalidateStateDraftOnDb } from './state.ts'
import { renderReviewMarkdown } from './reviews.ts'

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
        WHERE artifact_id = ? AND status = 'current' ORDER BY rowid DESC LIMIT 1`).get(`plan:${number}`)
        ?? db.prepare(`SELECT revision_id FROM artifacts
        WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${number}`)
      if (entry === undefined || memo === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
      const at = now()
      const planRevision = memo.revision_id
      const source = approvalSourceOf(input)
      db.prepare('UPDATE chapters SET plan_approved_at = ?, plan_revision = ?, plan_approved_source = ?, plan_approved_reason = ?, updated_at = ? WHERE number = ?')
        .run(at, planRevision, source, approvalReasonOf(input), at, number)
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

/** Read every body and plan revision of one chapter, with current markers. */
export function readChapterHistory(root: string, input: any, _options: any = {}) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    const entry = chapterRow(db, number)
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    const body = (db.prepare('SELECT revision, words, created_at AS createdAt FROM chapter_versions WHERE number = ? ORDER BY revision DESC').all(number) as any[])
      .map(row => ({ revision: row.revision, words: row.words, createdAt: row.createdAt, current: row.revision === entry.current_revision }))
    const planRows = db.prepare('SELECT revision_id AS revisionId, created_at AS createdAt FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC').all(`plan:${number}`) as any[]
    const latestPlan = planRows[0]?.revisionId
    const plan = planRows.map(row => ({
      revisionId: row.revisionId,
      createdAt: row.createdAt,
      current: row.revisionId === latestPlan,
      approved: entry.plan_approved_at !== null && entry.plan_revision === row.revisionId,
    }))
    return {
      workId, chapter: number, stage: stageOf(entry), currentRevision: `r${entry.current_revision}`,
      planApproval: metaOf(db).plan_approval,
      body, plan,
    }
  } finally {
    db.close()
  }
}

/** Append a historical body or plan revision as the new current revision. */
export function adoptChapterRevision(root: string, input: any) {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const target = input.target === 'plan' ? 'plan' : input.target === 'body' ? 'body' : undefined
  if (target === undefined) throw new StoryError('revision-target-invalid', 'target 只能是 body 或 plan')
  const expected = String(input.expectedCurrent ?? '')
  const wanted = String(input.revision ?? '')
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const entry = chapterRow(db, number)
      if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
      const latest = Number((db.prepare('SELECT max(number) AS number FROM chapters').get() as any)?.number ?? 0)
      if (number !== latest) throw new StoryError('chapter-not-current', `只能回滚当前章 ${latest}；旧章先切回或另立工作项`)
      const at = now()
      const event = (payload: any) => {
        const seq = Number((db.prepare('SELECT max(seq) AS seq FROM events').get() as any)?.seq ?? 0) + 1
        db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
          .run(seq, at, number, 'revision-adopt', JSON.stringify(payload))
      }

      if (target === 'body') {
        const current = Number(entry.current_revision)
        if (expected !== `r${current}`) throw new StoryError('revision-conflict', `当前正文已是 r${current}，请刷新后重试`)
        const match = /^r([1-9]\d*)$/u.exec(wanted)
        if (match === null) throw new StoryError('revision-not-found', `正文版本形如 r1：收到 ${wanted}`)
        const targetRevision = Number(match[1])
        if (targetRevision === current) throw new StoryError('revision-current', `r${current} 已是当前正文`)
        if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：先 reopen 再回滚正文`)
        const row = db.prepare('SELECT body FROM chapter_versions WHERE number = ? AND revision = ?').get(number, targetRevision) as any
        if (row === undefined) throw new StoryError('revision-not-found', `没有正文版本 r${targetRevision}`)
        if (metaOf(db).plan_approval === 'required' && planApprovalState(db, number).blocked) {
          throw new StoryError('plan-not-approved', `第 ${number} 章章纲还没经作者确认：先确认章纲`)
        }
        const body = String(row.body)
        const revision = current + 1
        const words = countChapterLength(body)
        db.prepare('INSERT INTO chapter_versions (number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(number, revision, body, words, at)
        db.prepare(`UPDATE chapters SET status = 'written', stage = 'written', current_revision = ?, words = ?, updated_at = ? WHERE number = ?`)
          .run(revision, words, at, number)
        invalidateStateDraftOnDb(db, number)
        dropSearchDoc(db, `chapter:${number}:r${current}`)
        syncSearchDoc(db, `chapter:${number}:r${revision}`, 'chapter', `chapters/${chapterStem(number)}`, number, body)
        event({ kind: 'revision-adopt', target, fromRevision: `r${targetRevision}`, newRevision: `r${revision}` })
        touchMeta(db, at)
        return { workId, chapter: number, target, fromRevision: `r${targetRevision}`, newRevision: `r${revision}`, stage: 'written' }
      }

      const planRows = db.prepare(`SELECT revision_id AS revisionId, content FROM artifacts
        WHERE artifact_id = ? ORDER BY CASE WHEN status = 'current' THEN 0 ELSE 1 END, rowid DESC`).all(`plan:${number}`) as any[]
      const latestPlan = planRows[0]?.revisionId
      if (latestPlan === undefined) throw new StoryError('revision-not-found', `第 ${number} 章还没有章纲`)
      if (stageOf(entry) !== 'planned') throw new StoryError('chapter-exists', `第 ${number} 章已有正文：章纲回滚只允许未写正文的章节`)
      if (expected !== latestPlan) throw new StoryError('revision-conflict', `当前章纲已是 ${latestPlan}，请刷新后重试`)
      const row = planRows.find(item => item.revisionId === wanted)
      if (row === undefined) throw new StoryError('revision-not-found', `没有章纲版本 ${wanted}`)
      if (wanted === latestPlan) throw new StoryError('revision-current', `${wanted} 已是当前章纲`)
      const content = JSON.parse(String(row.content))
      const revisionId = `adopt:${wanted}:${at}`
      putArtifactOnDb(db, {
        workId, artifactId: `plan:${number}`, kind: 'plan', scope: { chapter: number }, revisionId,
        content, provenance: 'edited', createdAt: at,
      })
      event({ kind: 'revision-adopt', target, fromRevision: wanted, newRevision: revisionId })
      touchMeta(db, at)
      return { workId, chapter: number, target, fromRevision: wanted, newRevision: revisionId, stage: stageOf(entry) }
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
      const words = countChapterLength(body)
      if (input.wordRange !== undefined) {
        const { min, max } = input.wordRange
        if (words < min || words > max) {
          throw new StoryError('chapter-length-out-of-range',
            `第 ${number} 章正文 ${words} 字，超出 ${min}–${max} 字范围`)
        }
      }
      const at = now()
      db.prepare('INSERT INTO chapter_versions (number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(number, revision, body, words, at)
      db.prepare(`UPDATE chapters SET title = ?, status = 'written', stage = 'written',
        current_revision = ?, words = ?, updated_at = ? WHERE number = ?`)
        .run(String(input.title ?? entry.title), revision, words, at, number)
      invalidateStateDraftOnDb(db, number)
      dropSearchDoc(db, `chapter:${number}:r${revision - 1}`)
      syncSearchDoc(db, `chapter:${number}:r${revision}`, 'chapter', `chapters/${chapterStem(number)}`, number, body)
      if (settled) {
        const seq = Number((db.prepare('SELECT max(seq) AS n FROM events').get() as { n: number } | undefined)?.n ?? 0) + 1
        db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
          .run(seq, at, number, 'reopen', JSON.stringify({ kind: 'reopen', revision: entry.current_revision }))
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


