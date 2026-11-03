/** reviews.ts repository. */

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
  assertPlanApproved,
  reviewRecords,
  latestReviewRow,
  openObservations,
  currentVersion,
  reviewCovers,
} from './shared.ts'
import type {
  WriteReviewInput,
  ReviseChapterInput,
} from '../types.ts'
import {
  status,
} from './catalog.ts'
import { invalidateStateDraftOnDb } from './state.ts'

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
export function renderReviewMarkdown(number: any, record: any) {
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
      stale: record.stale === true,
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
/**
 * The author accepts one chapter's current revision despite open observations.
 * @param input - target work and chapter.
 */
export interface AcceptChapterInput {
  work: string
  chapter: number | string
}

/**
 * The author accepts the current revision together with its open observations.
 *
 * Writes a new review round that records every open issue as resolved by the
 * author (`resolves` points at the issue it answers), which is what lets the
 * stage machine move on to the summary. Without it the only way past an open
 * review is another revision — the loop #76 caps.
 */
export function acceptChapter(root: string, input: AcceptChapterInput): any {
  const number = chapterNumber(input.chapter)
  const workId = String(input.work)
  const db = openWork(root, workId)
  let open: any[]
  try {
    const entry = chapterRow(db, number)
    if (entry === undefined || entry.current_revision === 0) {
      throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能接受`)
    }
    if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿`)
    const review = latestReviewRow(db, number)
    if (review === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿：先 story_review`)
    if (!reviewCovers(review, entry)) {
      throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${review.revision}：先重新审稿`)
    }
    open = openObservations(review)
    if (open.length === 0) throw new StoryError('nothing-to-accept', `第 ${number} 章没有未处理审稿`)
  } finally {
    db.close()
  }
  const observations = open.map((observation: any) => ({
    id: observation.id,
    summary: `作者接受，不再修改：${String(observation.summary ?? '')}`.trim(),
    evidence: Array.isArray(observation.evidence) ? observation.evidence : [],
    category: observation.category,
    assessment: 'resolved',
    resolves: observation.id,
    target: observation.target,
    sourceRefs: Array.isArray(observation.sourceRefs) ? observation.sourceRefs : [],
  }))
  const review = writeReview(root, { work: workId, chapter: number, observations })
  return { workId, chapter: number, accepted: observations.length, review }
}

/**
 * Replace a chapter's body with an edited version.
 * @param input - work, chapter number, new body, and the mode.
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
      invalidateStateDraftOnDb(db, number)
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
