/** export.ts repository. */

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
  readManifest,
  status,
  delegateOf,
} from '../../storage/repositories/catalog.ts'
import {
  TRUTH_ARTIFACTS,
} from '../../storage/repositories/bible.ts'
import {
  invalidateStateDraftOnDb,
  readEvents,
  exportSummaryRows,
} from '../../storage/repositories/state.ts'
import {
  renderReviewMarkdown,
} from '../../storage/repositories/reviews.ts'
import {
  catalogRow,
  requireCatalog,
  metaOf,
  planApprovalState,
  summaryStateMap,
  summaryStateFrom,
  outlineApprovedAt,
  currentVersion,
  EXPORT_MTIME,
  exportLocks,
} from './shared.ts'

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


