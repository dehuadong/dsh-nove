/** Truth files: bible rows and their readable artifact entries. */

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
  invalidateStateDraftOnDb,
  readEvents,
  exportSummaryRows,
} from '../../storage/repositories/state.ts'
import {
  renderReviewMarkdown,
} from '../../storage/repositories/reviews.ts'
import {
  writeOutline,
} from './catalog.ts'

/** Artifact identity of every non-character truth entry. */
export const TRUTH_ARTIFACTS = {
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
      const cardText = String(content).trim()
      if (cardText !== '' && cardText !== '[]') {
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
