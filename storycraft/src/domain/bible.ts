/** Truth-file rules: file specs, parsing and validation. */

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

export const BIBLE_FILES: Record<string, BibleFileSpec> = {
  world: { file: 'bible/world.md', kind: 'markdown' },
  characters: { file: 'bible/characters.json', kind: 'characters' },
  style: { file: 'bible/style.md', kind: 'markdown' },
  plan: { file: 'outline/plan.md', kind: 'markdown' },
  intent: { file: 'bible/intent.md', kind: 'markdown' },
}

export const EDITABLE_BIBLE_FILES = Object.keys(BIBLE_FILES).filter(name => name !== 'plan')

export function assertEditableBible(name: string): string {
  if (name === 'plan') throw new StoryError('approval-moved', '全书计划只能通过 story_outline 写入')
  if (!EDITABLE_BIBLE_FILES.includes(name)) throw new StoryError('bible-invalid', `未知的真值文件：${String(name)}`)
  return name
}

export const BRIEF_SECTION_ORDER: string[] = ['intent', 'storyFrame', 'bookRules', 'plan', 'currentFocus', 'characters', 'hooks', 'volumeMap', 'volumeSummary', 'recentSummaries', 'previous', 'style', 'wordPolicy', 'retrieval']

export const BRIEF_BUDGET_TOKENS = 2600

export const WORD_POLICY = '单章 3000–5000 字；每章结尾留悬念钩子；61 章起分卷。'

export function bibleSpec(name: string): BibleFileSpec | undefined {
  return (BIBLE_FILES as Record<string, BibleFileSpec | undefined>)[name]
}

export function biblePath(workId: string, name: string): string {
  return virtualPath(workId, BIBLE_FILES[name].file)
}

export function isDraft(text: unknown): boolean {
  return String(text).split(/\r?\n/).every(line => /^\s*$|^#{1,6}\s/.test(line))
}

export function byteLength(text: unknown): number {
  return Buffer.byteLength(String(text), 'utf8')
}

export function parseCharacters(text: string): CharacterRecord[] {
  let records: unknown
  try {
    records = JSON.parse(text)
  } catch {
    throw new StoryError('bible-invalid', 'characters.json 不是合法 JSON')
  }
  if (!Array.isArray(records)) throw new StoryError('bible-invalid', 'characters.json 必须是数组')
  const seen = new Set<string>()
  // Author-supplied JSON is a dynamic boundary: each record is validated field
  // by field at runtime, so the parsed value stays `any` until the checks pass.
  for (const [index, record] of records.entries()) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new StoryError('bible-invalid', `第 ${index + 1} 条人物不是对象`)
    }
    for (const field of ['name', 'role', 'want', 'fear', 'limit', 'voice']) {
      const value = record[field]
      if (typeof value !== 'string' || value.trim() === '') {
        throw new StoryError('bible-invalid', `第 ${index + 1} 条人物缺少 ${field}`)
      }
    }
    const name = record.name.trim()
    if (seen.has(name)) throw new StoryError('bible-invalid', `人物名重复：${name}`)
    seen.add(name)
  }
  return records
}

export function validateBibleContent(name: string, content: unknown): void {
  const spec = bibleSpec(name)
  if (spec === undefined) throw new StoryError('bible-invalid', `未知的真值文件：${String(name)}`)
  const text = typeof content === 'string' ? content : ''
  if (name !== 'intent' && text.trim() === '') {
    throw new StoryError('bible-invalid', `${spec.file} 不能为空`)
  }
  if (name === 'world' && /(^|[\s：:])(TODO|待定)([\s：:，。]|$)/mu.test(text)) {
    throw new StoryError('bible-invalid', 'world.md 不能把待定事项写成已定事实（去掉 TODO/待定标记后再写入）')
  }
  if (spec.kind === 'characters') parseCharacters(text)
}

export interface BibleFileSpec {
  file: string
  kind: 'markdown' | 'characters'
}

export interface CharacterRecord {
  name: string
  role: string
  want: string
  fear: string
  limit: string
  voice: string
}

export interface BibleFile {
  name: string
  path: string
  version: string
  content: string
  draft: boolean
}

export interface ReadBibleResult {
  files: BibleFile[]
  missing: string[]
  editable: string[]
}

export interface WriteBibleOptions {
  expectedVersion?: string
}

export interface WrittenBible {
  name: string
  path: string
  version: string
}

export interface StyleExtraction {
  metrics: StyleMetrics
  sampleCount: number
  sampleChars: number
  chapters: number[]
  version: string
}

export interface SummaryIndexEntry {
  number: number
  path: string
  words: number
}

export interface WrittenSummary {
  path: string
  truncated: boolean
  words: number
}

export interface SectionOptions {
  absent?: boolean
  sourceIds?: string[]
  fallback?: boolean
  bodyFallback?: boolean
}

export interface RetrievalHit {
  id: string
  kind: string
  sourceIds: string[]
  score: number
  sent: boolean
}

export interface BriefRetrieval {
  enabled: boolean
  query: string
  candidateCount: number
  chars: number
  hits: RetrievalHit[]
  error?: string
}

export interface BriefBudget {
  limit: number
  used: number
  unit: 'tokens'
  overBudget: boolean
}

export interface DroppedSection {
  name: string
  tokens: number
  reason: 'budget'
}

export interface BriefTraceSection {
  name: string
  protection: 'protected' | 'compressible'
  sourceIds: string[]
  chars: number
  tokens: number
  dropped?: true
  trimmed?: true
  reason?: string
}

export interface BriefTrace {
  chapter: number
  plannerInputs: string[]
  composerInputs: string[]
  selectedSources: string[]
  contextTiers: { protectedSources: string[], compressibleSources: string[] }
  tokenBudget: { protectedTokens: number, compressibleTokens: number, totalSelectedTokens: number }
  retrieval?: {
    engine: 'sqlite-fts5-bm25'
    query: string
    selectionMode: 'complete'
    candidates: Array<{ id: string, kind: string, source: string, score: number }>
    semanticSelectedIds: string[]
  }
  notes: string[]
  trimmed: string[]
  dropped: string[]
  budget: { limit: number, used: number, unit: 'tokens' }
  sections: BriefTraceSection[]
  missing: Array<{ name: string, reason: string }>
  overflow: boolean
}

export interface Brief {
  sections: BriefSection[]
  budget: BriefBudget
  missing: string[]
  dropped: DroppedSection[]
  retrieval: BriefRetrieval
  trace: BriefTrace
}

export interface BriefDependencies {
  searchMemory?: (
    root: string,
    work: string,
    query: string,
    options: { kinds: string[], purposes: string[] },
  ) => any[]
}


export interface BriefSection {
  name: string
  title: string
  source?: string
  sourceIds?: string[]
  content: string
  bytes: number
  tokens: number
  absent: boolean
  draft?: boolean
  fallback?: boolean
  bodyFallback?: boolean
}
