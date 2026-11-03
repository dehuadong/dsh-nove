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
  backupWork,
} from './storage/repositories/export.ts'

import {
  readManifest,
  status,
  delegateOf,
} from './storage/repositories/catalog.ts'

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

