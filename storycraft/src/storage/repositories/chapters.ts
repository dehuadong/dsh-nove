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
  invalidateStateDraftOnDb,
  readPlan,
  renderReviewMarkdown,
} from '../../store-db.ts'

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
        const words = countWords(body)
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

      const planRows = db.prepare('SELECT revision_id AS revisionId, content FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC').all(`plan:${number}`) as any[]
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
      const words = countWords(body)
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
