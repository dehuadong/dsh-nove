import { materialsDir, openWork, transaction } from '../db.ts'
import { StoryError, now } from '../../domain.ts'
import { dropSearchDoc, syncSearchDoc } from '../../search-index.ts'
import { materialIndexText } from '../../search-text.ts'
import { MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from '../../materials.ts'
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
import type { Database } from '../db.ts'
import type { ArtifactRow, BibleRow, ChapterRow, ChapterVersionRow, EventRow, MaterialRow, MetaRow, VolumeRow, WorkRow } from '../store-rows.ts'

/**
 * Revision rounds one chapter may consume before the author has to decide.
 *
 * A reviewer can always find five more observations, so "keep revising until
 * clean" never converges on a real link (#50 acceptance: 5/5/2/5 over four
 * rounds, 2840 words against a 3000 ceiling). The cap turns that loop into an
 * author decision instead of a token sink.
 */
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
} from './shared.ts'


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
export async function importMaterial(root: any, work: any, input: any) {
  const prepared = await prepareMaterial(input)
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const existing = db.prepare('SELECT * FROM materials WHERE hash = ?').get(prepared.hash) as unknown as MaterialRow | undefined
      if (existing !== undefined) {
        const originPath = join(root, '.storycraft', existing.origin)
        let valid = false
        try {
          valid = existsSync(originPath) && createHash('sha256').update(readFileSync(originPath)).digest('hex') === prepared.hash
        } catch {
          valid = false
        }
        if (!valid) {
          const copy = writeManagedCopy(root, prepared)
          db.prepare('UPDATE materials SET origin = ? WHERE id = ?').run(copy.origin, existing.id)
          existing.origin = copy.origin
        }
        return { material: materialMetadata(existing), duplicate: true }
      }
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
