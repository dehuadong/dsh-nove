import { BIBLE_FILES, EDITABLE_BIBLE_FILES, assertEditableBible, biblePath, bibleSpec, isDraft, validateBibleContent } from '../domain/bible.ts'
import type { ReadBibleResult, BibleFile, WriteBibleOptions, WrittenBible, StyleExtraction, SummaryIndexEntry, WrittenSummary } from '../domain/bible.ts'
/** Truth-file and summary content reads/writes on top of the storage facade. */

import { StoryError, chapterNumber, chapterStem, contentVersion, formOf, sourceIdOf } from '../domain.ts'
import { accountOf } from '../accounting.ts'
import { buildQuery, select } from '../retrieval.ts'
import { mergeBlock, styleBlock, styleProfile, type StyleMetrics } from '../style.ts'
import {
  listBodies, listSummaries, listSummaryStates, readBibleEntries, readBibleEntry, readBibleMap, readChapter as readChapterRow, readFoldedState,
  readManifest, readPlan, readSummary as readSummaryRow, readSummaryState, readVolumes, searchMemory, virtualPath,
  writeBible as writeBibleRow, writeSummary as writeSummaryRow,
} from '../storage.ts'
import { listRoleCards, readFoundationDocuments, renderFoundationContent } from '../artifact-store.ts'

export async function readBible(root: string, workId: unknown, only?: string): Promise<ReadBibleResult> {
  const manifest = readManifest(root, workId)
  const names: string[] = only === undefined ? Object.keys(BIBLE_FILES) : [only]
  if (names.some(name => bibleSpec(name) === undefined)) {
    throw new StoryError('bible-invalid', `未知的真值文件：${String(only)}`)
  }
  // SQLite row shape from the store; each row carries `name`, `content`, `version`.
  const rows = new Map<string, any>(readBibleEntries(root, manifest.workId).map((row: any): [string, any] => [row.name, row]))
  const files: BibleFile[] = []
  const missing: string[] = []
  for (const name of names) {
    const row = rows.get(name)
    if (row === undefined) {
      missing.push(name)
      continue
    }
    files.push({
      name,
      path: biblePath(manifest.workId, name),
      version: row.version,
      content: row.content,
      draft: isDraft(row.content),
    })
  }
  if (missing.length > 0 && only !== undefined) {
    throw new StoryError('bible-missing', `真值文件缺失：${missing.join('、')}（可用 story_bible_write 补建）`)
  }
  return { files, missing, editable: EDITABLE_BIBLE_FILES }
}

export async function writeBible(root: string, workId: unknown, name: string, content: unknown, options: WriteBibleOptions = {}): Promise<WrittenBible> {
  assertEditableBible(name)
  if (typeof content !== 'string') throw new StoryError('bible-invalid', '真值内容必须是字符串')
  validateBibleContent(name, content)
  const manifest = readManifest(root, workId)
  const receipt = writeBibleRow(root, {
    work: manifest.workId,
    name,
    content,
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
  })
  return { name, path: biblePath(manifest.workId, name), version: receipt.version }
}

export async function extractStyleSamples(root: string, workId: unknown): Promise<StyleExtraction> {
  const manifest = readManifest(root, workId)
  const current = new Map<number, number>(manifest.chapters.filter((chapter: any) => chapter.currentRevision > 0).map((chapter: any): [number, number] => [chapter.number, chapter.currentRevision]))
  const bodies = listBodies(root, manifest.workId)
    .filter((row: any) => current.get(row.number) === row.revision)
    .map((row: any) => ({ number: row.number, body: row.body }))
  if (bodies.length === 0) throw new StoryError('style-no-source', '还没有可抽取的正文')
  const raw = readBibleMap(root, manifest.workId)
  const authorStyle = raw.get('style')
  if (authorStyle === undefined) throw new StoryError('bible-missing', '作品缺少 style 真值')
  const profile = styleProfile(bodies)
  const block = styleBlock(profile.metrics, profile.samples)
  const content = mergeBlock(authorStyle, block)
  const version = content === authorStyle
    ? contentVersion(content)
    : (await writeBible(root, manifest.workId, 'style', content)).version
  return {
    metrics: profile.metrics,
    sampleCount: profile.samples.length,
    sampleChars: profile.sampleChars,
    chapters: bodies.map(row => row.number),
    version,
  }
}

export async function summaryIndex(root: string, workId: unknown): Promise<{ chapters: SummaryIndexEntry[] }> {
  const manifest = readManifest(root, workId)
  const chapters = listSummaries(root, manifest.workId).map((row: any): SummaryIndexEntry => ({
    number: row.number,
    path: virtualPath(manifest.workId, `summaries/${chapterStem(row.number)}.md`),
    words: [...String(row.text).trim()].length,
  }))
  return { chapters }
}

export async function readSummary(root: string, workId: unknown, chapter: number | string): Promise<string | undefined> {
  return readSummaryRow(root, workId, chapter)
}

export async function writeSummary(root: string, workId: unknown, chapter: number | string, text: string): Promise<WrittenSummary> {
  const number = chapterNumber(chapter)
  const manifest = readManifest(root, workId)
  // The store owner validates the body, caps the text and returns the
  // pre-truncation code-point count.
  const receipt = writeSummaryRow(root, { work: manifest.workId, chapter: number, text })
  return {
    path: virtualPath(manifest.workId, `summaries/${chapterStem(number)}.md`),
    truncated: receipt.truncated,
    words: receipt.chars,
  }
}
