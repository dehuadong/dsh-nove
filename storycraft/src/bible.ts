/**
 * Truth files, chapter summaries, and the pre-write brief.
 *
 * `bible` is the single source of truth for setting and plan; `summaries`
 * accumulates one summary per written chapter. Both live inside the work
 * database, so writing is one transaction and reading is pure: the same inputs
 * always assemble the same brief byte for byte.
 */

import { StoryError, chapterNumber, chapterStem, contentVersion, sourceIdOf } from './domain.js'
import { accountOf } from './accounting.js'
import { buildQuery, select } from './retrieval.js'
import { mergeBlock, styleBlock, styleProfile, type StyleMetrics } from './style.js'
import {
  listBodies, listSummaries, listSummaryStates, readBibleEntries, readBibleEntry, readBibleMap, readChapter as readChapterRow, readFoldedState,
  readManifest, readPlan, readSummary as readSummaryRow, readSummaryState, readVolumes, searchMemory, virtualPath,
  writeBible as writeBibleRow, writeSummary as writeSummaryRow,
} from './store-db.js'
import { readFoundationDocuments, renderFoundationContent } from './artifact-store.js'

/** How one truth file's content is validated. */
interface BibleFileSpec {
  file: string
  kind: 'markdown' | 'characters'
}

/** Every truth file, with how its content is validated. */
export const BIBLE_FILES: Record<string, BibleFileSpec> = {
  world: { file: 'bible/world.md', kind: 'markdown' },
  characters: { file: 'bible/characters.json', kind: 'characters' },
  style: { file: 'bible/style.md', kind: 'markdown' },
  plan: { file: 'outline/plan.md', kind: 'markdown' },
  intent: { file: 'bible/intent.md', kind: 'markdown' },
}

/** Truth files an author may edit directly; plan stays behind outline approval. */
export const EDITABLE_BIBLE_FILES = Object.keys(BIBLE_FILES).filter(name => name !== 'plan')

/** Reject plan or unknown truth names before a direct write. */
export function assertEditableBible(name: string): string {
  if (name === 'plan') throw new StoryError('approval-moved', '全书计划只能通过 story_outline 写入')
  if (!EDITABLE_BIBLE_FILES.includes(name)) throw new StoryError('bible-invalid', `未知的真值文件：${String(name)}`)
  return name
}

/** Names in the order the brief presents them (highest priority first). */
export const BRIEF_SECTION_ORDER: string[] = ['intent', 'storyFrame', 'bookRules', 'plan', 'currentFocus', 'characters', 'hooks', 'volumeMap', 'volumeSummary', 'recentSummaries', 'previous', 'style', 'wordPolicy', 'retrieval']

/** Token budget of one assembled brief (estimated tokens, see `accounting.ts`). */
export const BRIEF_BUDGET_TOKENS = 2600

/** Bytes of the previous chapter's tail used when no summary exists yet. */
const PREV_TAIL_BYTES = 800


/** Word-count policy the brief hands to the model (validation belongs to a later stage). */
export const WORD_POLICY = '单章 3000–5000 字；每章结尾留悬念钩子；61 章起分卷。'

/** The spec of one truth file, or undefined when the name is unknown. */
function bibleSpec(name: string): BibleFileSpec | undefined {
  return (BIBLE_FILES as Record<string, BibleFileSpec | undefined>)[name]
}

/** Virtual path of one truth file. */
function biblePath(workId: string, name: string): string {
  return virtualPath(workId, BIBLE_FILES[name].file)
}

/** `true` when the file carries nothing but headings. */
export function isDraft(text: unknown): boolean {
  return String(text).split(/\r?\n/).every(line => /^\s*$|^#{1,6}\s/.test(line))
}

/** Byte length of the UTF-8 encoding. */
function byteLength(text: unknown): number {
  return Buffer.byteLength(String(text), 'utf8')
}

/** One validated character sheet record (the six-field authoring contract). */
interface CharacterRecord {
  name: string
  role: string
  want: string
  fear: string
  limit: string
  voice: string
}

/**
 * Parse and validate a character sheet.
 * @param text - JSON text.
 * @returns the parsed records.
 */
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

/**
 * Validate content for one truth file.
 * @param name - one of {@link BIBLE_FILES}.
 * @param content - proposed content.
 * @returns nothing.
 */
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

/** One truth file with its stored content and revision. */
interface BibleFile {
  name: string
  path: string
  version: string
  content: string
  draft: boolean
}

interface ReadBibleResult {
  files: BibleFile[]
  missing: string[]
  editable: string[]
}

/**
 * Read one or all truth files.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @param only - one file name; omit to read all five.
 * @returns files with content and version.
 */
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

/** Optional optimistic-concurrency guard of one write. */
interface WriteBibleOptions {
  expectedVersion?: string
}

/** Receipt of one truth-file write. */
interface WrittenBible {
  name: string
  path: string
  version: string
}

/**
 * Validate and write one truth file.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @param name - one of {@link BIBLE_FILES}.
 * @param content - new content.
 * @param options - optional expected version for an optimistic write.
 * @returns the written file.
 */
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

/** Outcome of one deterministic style-sample extraction. */
interface StyleExtraction {
  metrics: StyleMetrics
  sampleCount: number
  sampleChars: number
  chapters: number[]
  version: string
}

/**
 * Append deterministic style samples from current chapter revisions.
 * @param root - workspace.
 * @param workId - work identity.
 * @returns metrics, counts and version.
 */
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

/** One chapter's entry in the summary index. */
interface SummaryIndexEntry {
  number: number
  path: string
  words: number
}

/**
 * Chapter summary index, rebuilt from the work database.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @returns index payload.
 */
export async function summaryIndex(root: string, workId: unknown): Promise<{ chapters: SummaryIndexEntry[] }> {
  const manifest = readManifest(root, workId)
  const chapters = listSummaries(root, manifest.workId).map((row: any): SummaryIndexEntry => ({
    number: row.number,
    path: virtualPath(manifest.workId, `summaries/${chapterStem(row.number)}.md`),
    words: [...String(row.text).trim()].length,
  }))
  return { chapters }
}

/**
 * Read one chapter's summary.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @param chapter - chapter number.
 * @returns summary text.
 */
export async function readSummary(root: string, workId: unknown, chapter: number | string): Promise<string | undefined> {
  return readSummaryRow(root, workId, chapter)
}

/** Receipt of one chapter-summary write. */
interface WrittenSummary {
  path: string
  truncated: boolean
  words: number
}

/**
 * Write one chapter's summary, capped at 400 code points.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @param chapter - chapter number.
 * @param text - summary text.
 * @returns write receipt.
 */
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

/** One assembled brief section. */
interface BriefSection {
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

/** Optional section markers a caller may set. */
interface SectionOptions {
  absent?: boolean
  sourceIds?: string[]
  fallback?: boolean
  bodyFallback?: boolean
}

/** One trace row of the retrieval section. */
interface RetrievalHit {
  id: string
  kind: string
  sourceIds: string[]
  score: number
  sent: boolean
}

/** Retrieval trace carried by a brief; disabled when there is no query. */
interface BriefRetrieval {
  enabled: boolean
  query: string
  candidateCount: number
  chars: number
  hits: RetrievalHit[]
  error?: string
}

/** Token accounting of one brief. */
interface BriefBudget {
  limit: number
  used: number
  unit: 'tokens'
  overBudget: boolean
}

/** One section the budget removed. */
interface DroppedSection {
  name: string
  tokens: number
  reason: 'budget'
}

/** One section as the brief trace reports it, in the artifact contract's shape. */
interface BriefTraceSection {
  name: string
  protection: 'protected' | 'compressible'
  sourceIds: string[]
  chars: number
  tokens: number
  dropped?: true
  trimmed?: true
  reason?: string
}

/** The brief's trace, the same shape `story_context` returns (never persisted). */
interface BriefTrace {
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

/** The assembled pre-write brief. */
interface Brief {
  sections: BriefSection[]
  budget: BriefBudget
  missing: string[]
  dropped: DroppedSection[]
  retrieval: BriefRetrieval
  trace: BriefTrace
}

/** Manifest fields this module reads; the manifest itself comes from the store. */
interface BriefManifest {
  workId: string
  wordRange?: { min: number, max: number }
  chapters: Array<{ number: number, currentRevision: number }>
}

/** Injectable memory search for fail-open tests. */
interface BriefDependencies {
  searchMemory?: (
    root: string,
    work: string,
    query: string,
    options: { kinds: string[], purposes: string[] },
  ) => any[]
}

/**
 * Assemble the pre-write brief for one chapter.
 *
 * Pure: every input is read from the work database, sections are ordered by
 * {@link BRIEF_SECTION_ORDER}, and identical inputs produce identical bytes.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @param chapter - chapter number.
 * @param dependencies - injectable `searchMemory` for fail-open tests.
 * @returns brief.
 */
/** Render one foundation artifact content: Markdown string or its readable `markdown` field. */
export async function assembleBrief(root: string, workId: unknown, chapter: number | string, options: BriefDependencies & { budget?: number } = {}): Promise<Brief> {
  const number = chapterNumber(chapter)
  const manifest: BriefManifest = readManifest(root, workId)
  const entry = manifest.chapters.find(item => item.number === number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const work = manifest.workId

  const missing: string[] = []
  const raw: Record<string, string> = {}
  for (const [name, content] of readBibleMap(root, work)) raw[name] = content
  for (const name of Object.keys(BIBLE_FILES)) if (raw[name] === undefined) missing.push(name)
  if (missing.length > 0) {
    throw new StoryError('bible-missing', `真值文件缺失：${missing.join('、')}（可用 story_bible_write 补建）`)
  }

  const plan = readPlan(root, work, number)
  if (plan === undefined) missing.push('outline')
  const foundation = readFoundationDocuments(root, work)

  const indexRoles = Array.isArray(foundation.rolesIndex?.content?.roles) ? foundation.rolesIndex.content.roles : undefined
  const characters: CharacterRecord[] = indexRoles !== undefined && indexRoles.length > 0 ? indexRoles : parseCharacters(raw.characters)
  const planText: string = plan ?? ''
  const matched = characters
    .filter(record => planText.includes(record.name))
    .sort((left, right) => planText.indexOf(left.name) - planText.indexOf(right.name))
  const chosen = matched.length > 0 ? matched : characters
  const characterText = chosen
    .map(record => `- ${record.name}（${record.role}）：想要 ${record.want}；害怕 ${record.fear}；底线 ${record.limit}；口吻 ${record.voice}`)
    .join('\n')
  const characterSource = indexRoles !== undefined && indexRoles.length > 0
    ? virtualPath(work, 'foundation/roles/index.json')
    : biblePath(work, 'characters')

  const folded = readFoldedState(root, work)
  const hooks = folded.hooks.filter((hook: any) => ['open', 'progressing', 'deferred'].includes(hook.status))
  const hookText = hooks
    .map((hook: any) => `- ${hook.text}（${hook.status}，第 ${hook.startChapter} 章埋）`)
    .join('\n')

  const storyFrame = renderFoundationContent(foundation.storyFrame?.content)
  const bookRules = renderFoundationContent(foundation.bookRules?.content)
  const currentFocus = renderFoundationContent(foundation.currentFocus?.content)
  const volumeMap = renderFoundationContent(foundation.volumeMap?.content)
  const sections: BriefSection[] = [
    section('intent', '作者意图与当前焦点', raw.intent, biblePath(work, 'intent')),
    section('storyFrame', '故事框架', storyFrame, virtualPath(work, 'foundation/story_frame.md'), { absent: storyFrame === '' }),
    section('bookRules', '作品规则', bookRules, virtualPath(work, 'foundation/book_rules.md'), { absent: bookRules === '' }),
    section('plan', '本章章纲', planText, virtualPath(work, `outline/${chapterStem(number)}.plan.md`), { absent: plan === undefined }),
    section('currentFocus', '当前焦点', currentFocus, virtualPath(work, 'foundation/current_focus.md'), { absent: currentFocus === '' }),
    section('characters', '本章涉及人物', characterText, characterSource, { fallback: matched.length === 0 }),
    section('hooks', '未解伏笔', hookText, virtualPath(work, 'state/events.jsonl'), { absent: hooks.length === 0 }),
    section('volumeMap', '卷图', volumeMap, virtualPath(work, 'foundation/volume_map.md'), { absent: volumeMap === '' }),
    await volumeSummarySection(root, manifest, number),
    await recentSummariesSection(root, manifest, number),
    await previousSection(root, manifest, number),
    section('style', '文风要点', raw.style, biblePath(work, 'style')),
    section('wordPolicy', '字数口径',
      manifest.wordRange === undefined
        ? '字数未设定（按作者习惯）；每章结尾留悬念钩子。'
        : `单章 ${manifest.wordRange.min}–${manifest.wordRange.max} 字；每章结尾留悬念钩子。`,
      virtualPath(work, 'manifest')),
  ]

  const retrieve = typeof options.searchMemory === 'function' ? options.searchMemory : searchMemory
  const written = manifest.chapters.filter(item => Number(item.currentRevision) > 0).length
  const query = written >= 3 ? buildQuery({ chapterPlan: planText, openHooks: hooks.slice(0, 8) }) : ''
  let retrieval: BriefRetrieval = { enabled: false, query: '', candidateCount: 0, chars: 0, hits: [] }
  if (query.trim() !== '') {
    try {
      const candidates = retrieve(root, work, query, {
        kinds: ['material'],
        purposes: ['setting', 'character', 'scene'],
      })
      const picked = select(candidates, { limit: 3, budget: 1200, perKindLimit: 3 })
      retrieval = {
        enabled: true,
        query,
        candidateCount: candidates.length,
        chars: picked.chars,
        hits: picked.hits,
      }
      if (picked.text !== '' && picked.hits.some(hit => hit.sent)) {
        sections.push(section('retrieval', '相关素材', picked.text, undefined, {
          sourceIds: picked.hits.filter(hit => hit.sent).map(hit => hit.id),
        }))
      }
    } catch (error) {
      // A service failure crosses a dynamic boundary; only its string code is read.
      const code = (error as { code?: unknown } | null | undefined)?.code
      retrieval = {
        enabled: true,
        query,
        candidateCount: 0,
        chars: 0,
        hits: [],
        error: typeof code === 'string' ? code : 'retrieval-failed',
      }
    }
  }

  const requestedBudget = options.budget
  const limit = requestedBudget !== undefined && Number.isInteger(requestedBudget) && requestedBudget > 0
    ? requestedBudget
    : BRIEF_BUDGET_TOKENS
  const budget: BriefBudget = { limit, used: 0, unit: 'tokens', overBudget: false }
  const dropped: DroppedSection[] = []
  const kept: BriefSection[] = [...sections]
  const protectedNames = new Set(['storyFrame', 'bookRules'])
  const total = (): number => kept.reduce((sum, item) => sum + item.tokens, 0)
  while (total() > limit && kept.length > 1) {
    let index = kept.length - 1
    while (index > 0 && protectedNames.has(kept[index].name)) index -= 1
    if (index <= 0) break
    const [removed] = kept.splice(index, 1)
    dropped.unshift({ name: removed.name, tokens: removed.tokens, reason: 'budget' })
  }
  budget.used = total()
  budget.overBudget = budget.used > limit
  if (dropped.some(item => item.name === 'retrieval')) {
    retrieval = { ...retrieval, hits: retrieval.hits.map(hit => ({ ...hit, sent: false })) }
  }
  const rendered: BriefSection[] = kept.map(item => (item.absent ? { ...item, content: '', bytes: 0, tokens: 0 } : item))

  const sourceIdsOf = (item: BriefSection): string[] => (item.sourceIds ?? (item.source === undefined ? [] : [item.source]))
    .flatMap(entry => entry.split(' + '))
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .map(entry => sourceIdOf(work, entry))
  const sentSections = rendered.filter(item => item.content !== '')
  const protectedSections = sentSections.filter(item => protectedNames.has(item.name))
  const compressibleSections = sentSections.filter(item => !protectedNames.has(item.name))
  const trace: BriefTrace = {
    chapter: number,
    plannerInputs: [],
    composerInputs: [],
    selectedSources: sentSections.flatMap(sourceIdsOf),
    contextTiers: {
      protectedSources: protectedSections.flatMap(sourceIdsOf),
      compressibleSources: compressibleSections.flatMap(sourceIdsOf),
    },
    tokenBudget: {
      protectedTokens: protectedSections.reduce((sum, item) => sum + item.tokens, 0),
      compressibleTokens: compressibleSections.reduce((sum, item) => sum + item.tokens, 0),
      totalSelectedTokens: sentSections.reduce((sum, item) => sum + item.tokens, 0),
    },
    ...(retrieval.enabled ? {
      retrieval: {
        engine: 'sqlite-fts5-bm25' as const,
        query: retrieval.query,
        selectionMode: 'complete' as const,
        candidates: retrieval.hits.map(hit => ({
          id: hit.id, kind: hit.kind, source: hit.sourceIds[0] ?? '', score: hit.score,
        })),
        semanticSelectedIds: [],
      },
    } : {}),
    notes: [
      'tokens 为估算值（cjk 1:1，其它 4:1）',
      ...(retrieval.error === undefined ? [] : [`检索失败：${retrieval.error}`]),
    ],
    trimmed: [],
    dropped: dropped.map(item => item.name),
    budget: { limit, used: budget.used, unit: 'tokens' },
    sections: sections.map(item => {
      const droppedHere = dropped.some(entry => entry.name === item.name)
      const chars = item.absent || droppedHere ? 0 : item.content.length
      return {
        name: item.name,
        protection: protectedNames.has(item.name) ? 'protected' as const : 'compressible' as const,
        sourceIds: sourceIdsOf(item),
        chars,
        tokens: droppedHere ? 0 : item.tokens,
        ...(droppedHere ? { dropped: true as const, reason: 'budget' } : {}),
      }
    }),
    missing: sections.filter(item => item.absent).map(item => ({ name: item.name, reason: '没有可用内容' })),
    overflow: budget.overBudget,
  }
  return { sections: rendered, budget, missing, dropped, retrieval, trace }
}

/**
 * One brief section.
 * @returns section record.
 */
function section(name: string, title: string, content: unknown, source?: string, options: SectionOptions = {}): BriefSection {
  const absent = options.absent === true
  const text = absent ? '' : String(content ?? '')
  return {
    name,
    title,
    ...(source !== undefined ? { source } : {}),
    ...(Array.isArray(options.sourceIds) ? { sourceIds: options.sourceIds } : {}),
    content: text,
    bytes: byteLength(text),
    tokens: accountOf(text).tokens,
    absent,
    ...(isDraft(text) && !absent ? { draft: true } : {}),
    ...(options.fallback === true ? { fallback: true } : {}),
    ...(options.bodyFallback === true ? { bodyFallback: true } : {}),
  }
}

/** How many recent chapter summaries the rolling window carries. */
export const RECENT_SUMMARY_WINDOW = 5

/**
 * The volume that owns the chapter, as one brief section.
 * @param root - workspace directory.
 * @param manifest - work manifest.
 * @param number - chapter being written.
 * @returns section record.
 */
async function volumeSummarySection(root: string, manifest: BriefManifest, number: number): Promise<BriefSection> {
  const volumes = readVolumes(root, manifest.workId)
  const volume = volumes.find((item: any) => number >= item.from && number <= item.to)
  if (volume === undefined) return section('volumeSummary', '本卷摘要', '', '', { absent: true })
  const summary = typeof volume.summary === 'string' ? volume.summary.trim() : ''
  return section('volumeSummary', `本卷摘要（${volume.title}）`, summary, virtualPath(manifest.workId, 'volumes'), { absent: summary === '' })
}

/**
 * Summaries of the previous chapters, newest window only.
 *
 * This is the rolling window: writing chapter 60 reads the same number of
 * sections as writing chapter 6.
 * @param root - workspace directory.
 * @param manifest - work manifest.
 * @param number - chapter being written.
 * @returns section record.
 */
async function recentSummariesSection(root: string, manifest: BriefManifest, number: number): Promise<BriefSection> {
  const first = Math.max(1, number - RECENT_SUMMARY_WINDOW)
  // SQLite summary rows from the store; each carries `number`, `state` and `text`.
  const rows = new Map<number, any>(listSummaryStates(root, manifest.workId).map((row: any): [number, any] => [row.number, row]))
  const lines: string[] = []
  for (let chapter = first; chapter < number; chapter += 1) {
    const summary = rows.get(chapter)
    if (summary?.state !== 'current') continue
    lines.push(`第 ${chapter} 章：${summary.text.trim()}`)
  }
  return section('recentSummaries', `最近 ${lines.length} 章摘要`, lines.join('\n'), virtualPath(manifest.workId, 'summaries/'), {
    absent: lines.length === 0,
  })
}

/**
 * The previous chapter's context: its summary when available, otherwise the
 * tail of its body. Chapter 1 stays absent, never an error.
 * @param root - workspace directory.
 * @param manifest - work manifest.
 * @param number - chapter being written.
 * @returns section record.
 */
async function previousSection(root: string, manifest: BriefManifest, number: number): Promise<BriefSection> {
  if (number === 1) return section('previous', '上一章结尾', '', '', { absent: true })
  const previous = number - 1
  const summary = readSummaryState(root, manifest.workId, previous)
  if (summary.state === 'current') {
    // `current` is only produced together with a non-empty text (see summaryStateOf).
    return section('previous', '上一章结尾', summary.text!.trim(), virtualPath(manifest.workId, `summaries/${chapterStem(previous)}.md`))
  }
  let body: string | undefined
  try {
    body = readChapterRow(root, { work: manifest.workId, chapter: previous }).content
  } catch {
    body = undefined
  }
  if (body === undefined) return section('previous', '上一章结尾', '', '', { absent: true })
  const lines = body.split(/\r?\n/)
  let tail = ''
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const next = tail === '' ? lines[index] : `${lines[index]}\n${tail}`
    if (byteLength(next) > PREV_TAIL_BYTES) break
    tail = next
  }
  return section('previous', '上一章结尾', tail.trim(), virtualPath(manifest.workId, `chapters/${chapterStem(previous)}.md`), { bodyFallback: true })
}
