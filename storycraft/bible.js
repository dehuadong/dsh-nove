/**
 * Truth files, chapter summaries, and the pre-write brief.
 *
 * `bible` is the single source of truth for setting and plan; `summaries`
 * accumulates one summary per written chapter. Both live inside the work
 * database, so writing is one transaction and reading is pure: the same inputs
 * always assemble the same brief byte for byte.
 */

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { StoryError, chapterNumber, chapterStem, contentVersion } from './domain.js'
import { buildQuery, select } from './retrieval.js'
import { mergeBlock, styleBlock, styleProfile } from './style.js'
import {
  listBodies, listSummaries, listSummaryStates, readBibleEntries, readBibleEntry, readBibleMap, readChapter as readChapterRow, readFoldedState,
  readManifest, readPlan, readSummary as readSummaryRow, readSummaryState, readVolumes, searchMemory, virtualPath,
  writeBible as writeBibleRow, writeSummary as writeSummaryRow,
} from './store-db.js'

/** Every truth file, with how its content is validated. */
export const BIBLE_FILES = {
  world: { file: 'bible/world.md', kind: 'markdown' },
  characters: { file: 'bible/characters.json', kind: 'characters' },
  style: { file: 'bible/style.md', kind: 'markdown' },
  plan: { file: 'outline/plan.md', kind: 'markdown' },
  intent: { file: 'bible/intent.md', kind: 'markdown' },
}

/** Truth files an author may edit directly; plan stays behind outline approval. */
export const EDITABLE_BIBLE_FILES = Object.keys(BIBLE_FILES).filter(name => name !== 'plan')

/** Reject plan or unknown truth names before a direct write. */
export function assertEditableBible(name) {
  if (name === 'plan') throw new StoryError('approval-moved', '全书计划只能通过 story_outline 写入')
  if (!EDITABLE_BIBLE_FILES.includes(name)) throw new StoryError('bible-invalid', `未知的真值文件：${String(name)}`)
  return name
}

/** Names in the order the brief presents them (highest priority first). */
export const BRIEF_SECTION_ORDER = ['intent', 'plan', 'characters', 'hooks', 'volumeSummary', 'recentSummaries', 'previous', 'style', 'wordPolicy', 'retrieval']

/** Byte budget of one assembled brief. */
export const BRIEF_BUDGET_BYTES = 8192

/** Bytes of the previous chapter's tail used when no summary exists yet. */
const PREV_TAIL_BYTES = 800


/** Word-count policy the brief hands to the model (validation belongs to a later stage). */
export const WORD_POLICY = '单章 3000–5000 字；每章结尾留悬念钩子；61 章起分卷。'

/** Virtual path of one truth file. */
function biblePath(workId, name) {
  return virtualPath(workId, BIBLE_FILES[name].file)
}

/** `true` when the file carries nothing but headings. */
export function isDraft(text) {
  return String(text).split(/\r?\n/).every(line => /^\s*$|^#{1,6}\s/.test(line))
}

/** Byte length of the UTF-8 encoding. */
function byteLength(text) {
  return Buffer.byteLength(String(text), 'utf8')
}

/**
 * Parse and validate a character sheet.
 * @param {string} text - JSON text.
 * @returns {object[]} the parsed records.
 */
export function parseCharacters(text) {
  let records
  try {
    records = JSON.parse(text)
  } catch {
    throw new StoryError('bible-invalid', 'characters.json 不是合法 JSON')
  }
  if (!Array.isArray(records)) throw new StoryError('bible-invalid', 'characters.json 必须是数组')
  const seen = new Set()
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
 * @param {string} name - one of {@link BIBLE_FILES}.
 * @param {string} content - proposed content.
 * @returns {void}
 */
export function validateBibleContent(name, content) {
  const spec = BIBLE_FILES[name]
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

/**
 * Read one or all truth files.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {string} [only] - one file name; omit to read all five.
 * @returns {Promise<{files: object[], missing: string[]}>} files with content and version.
 */
export async function readBible(root, workId, only) {
  const manifest = readManifest(root, workId)
  const names = only === undefined ? Object.keys(BIBLE_FILES) : [only]
  if (names.some(name => BIBLE_FILES[name] === undefined)) {
    throw new StoryError('bible-invalid', `未知的真值文件：${String(only)}`)
  }
  const rows = new Map(readBibleEntries(root, manifest.workId).map(row => [row.name, row]))
  const files = []
  const missing = []
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

/**
 * Validate and write one truth file.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {string} name - one of {@link BIBLE_FILES}.
 * @param {string} content - new content.
 * @returns {Promise<{name: string, path: string, version: string}>} the written file.
 */
export async function writeBible(root, workId, name, content, options = {}) {
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

/**
 * Append deterministic style samples from current chapter revisions.
 * @param {string} root - workspace.
 * @param {string} workId - work identity.
 * @returns {Promise<object>} metrics, counts and version.
 */
export async function extractStyleSamples(root, workId) {
  const manifest = readManifest(root, workId)
  const current = new Map(manifest.chapters.filter(chapter => chapter.currentRevision > 0).map(chapter => [chapter.number, chapter.currentRevision]))
  const bodies = listBodies(root, manifest.workId)
    .filter(row => current.get(row.number) === row.revision)
    .map(row => ({ number: row.number, body: row.body }))
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

/**
 * Import what can be imported from an older file work's `design/` folder.
 *
 * Old file works are not migrated, so this is the one read path that still
 * looks at `<workspace>/works/<workId>/`: it copies known structure into the new
 * work database and never fabricates a character sheet.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<{imported: object[], pending: string[], names: string[], skipped: string[]}>} import report.
 */
export async function importBible(root, workId) {
  const manifest = readManifest(root, workId)
  const design = join(root, 'works', manifest.workId, 'design')
  const readOptional = async (file) => {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }
  const world = await readOptional(join(design, 'world.md'))
  const outline = await readOptional(join(design, 'outline.md'))
  const cast = await readOptional(join(design, 'cast.md'))
  if (world === undefined && outline === undefined && cast === undefined) {
    throw new StoryError('nothing-to-import', '没有可收编的旧稿内容')
  }
  const imported = []
  const skipped = []
  const targets = [
    { name: 'world', from: 'bible:world', content: world },
  ]
  if (outline !== undefined) {
    skipped.push('outline-import-blocked（旧大纲不导入；请走 story_outline + 作者确认）')
  }
  for (const target of targets) {
    if (target.content === undefined) continue
    const spec = BIBLE_FILES[target.name]
    const existing = readBibleEntry(root, manifest.workId, target.name)?.content
    if (existing !== undefined && !isDraft(existing)) {
      skipped.push(`bible:${target.name}（已有内容，未覆盖）`)
      continue
    }
    const receipt = writeBibleRow(root, { work: manifest.workId, name: target.name, content: target.content })
    imported.push({ from: target.from, to: `bible:${target.name}`, version: receipt.version })
  }
  const headings = (pattern) => cast === undefined
    ? []
    : [...cast.matchAll(pattern)]
      .map(match => match[1].trim())
      .filter(name => name !== '' && !/^[\d.、\s]+$/.test(name))
  const deep = headings(/^###\s+(.+)$/gm)
  const names = deep.length > 0 ? deep : headings(/^##\s+(.+)$/gm)
  const pending = []
  if (names.length > 0) pending.push('characters（已抽出人名，缺 role/want/fear/limit/voice）')
  else pending.push('characters')
  pending.push('style', 'intent')
  return { imported, pending, names, skipped }
}

/**
 * Chapter summary index, rebuilt from the work database.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<{chapters: object[]}>} index payload.
 */
export async function summaryIndex(root, workId) {
  const manifest = readManifest(root, workId)
  const chapters = listSummaries(root, manifest.workId).map(row => ({
    number: row.number,
    path: virtualPath(manifest.workId, `summaries/${chapterStem(row.number)}.md`),
    words: [...String(row.text).trim()].length,
  }))
  return { chapters }
}

/**
 * Read one chapter's summary.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {number} chapter - chapter number.
 * @returns {Promise<string|undefined>} summary text.
 */
export async function readSummary(root, workId, chapter) {
  return readSummaryRow(root, workId, chapter)
}

/**
 * Write one chapter's summary, capped at 400 code points.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {number} chapter - chapter number.
 * @param {string} text - summary text.
 * @returns {Promise<{path: string, truncated: boolean, words: number}>} write receipt.
 */
export async function writeSummary(root, workId, chapter, text) {
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

/**
 * Assemble the pre-write brief for one chapter.
 *
 * Pure: every input is read from the work database, sections are ordered by
 * {@link BRIEF_SECTION_ORDER}, and identical inputs produce identical bytes.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {number|string} chapter - chapter number.
 * @param {object} [dependencies] - injectable `searchMemory` for fail-open tests.
 * @returns {Promise<{sections: object[], budget: object, missing: string[], dropped: object[], retrieval: object}>} brief.
 */
export async function assembleBrief(root, workId, chapter, dependencies = {}) {
  const number = chapterNumber(chapter)
  const manifest = readManifest(root, workId)
  const entry = manifest.chapters.find(item => item.number === number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const work = manifest.workId

  const missing = []
  const raw = {}
  for (const [name, content] of readBibleMap(root, work)) raw[name] = content
  for (const name of Object.keys(BIBLE_FILES)) if (raw[name] === undefined) missing.push(name)
  if (missing.length > 0) {
    throw new StoryError('bible-missing', `真值文件缺失：${missing.join('、')}（可用 story_bible_write 补建）`)
  }

  const plan = readPlan(root, work, number)
  if (plan === undefined) missing.push('outline')

  const characters = parseCharacters(raw.characters)
  const planText = plan ?? ''
  const matched = characters
    .filter(record => planText.includes(record.name))
    .sort((left, right) => planText.indexOf(left.name) - planText.indexOf(right.name))
  const chosen = matched.length > 0 ? matched : characters
  const characterText = chosen
    .map(record => `- ${record.name}（${record.role}）：想要 ${record.want}；害怕 ${record.fear}；底线 ${record.limit}；口吻 ${record.voice}`)
    .join('\n')

  const folded = readFoldedState(root, work)
  const hooks = folded.hooks.filter(hook => ['open', 'progressing', 'deferred'].includes(hook.status))
  const hookText = hooks
    .map(hook => `- ${hook.text}（${hook.status}，第 ${hook.startChapter} 章埋）`)
    .join('\n')

  const sections = [
    section('intent', '作者意图与当前焦点', raw.intent, biblePath(work, 'intent')),
    section('plan', '本章章纲', planText, virtualPath(work, `outline/${chapterStem(number)}.plan.md`), { absent: plan === undefined }),
    section('characters', '本章涉及人物', characterText, biblePath(work, 'characters'), { fallback: matched.length === 0 }),
    section('hooks', '未解伏笔', hookText, virtualPath(work, 'state/events.jsonl'), { absent: hooks.length === 0 }),
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

  const retrieve = typeof dependencies.searchMemory === 'function' ? dependencies.searchMemory : searchMemory
  const written = manifest.chapters.filter(item => Number(item.currentRevision) > 0).length
  const query = written >= 3 ? buildQuery({ chapterPlan: planText, openHooks: hooks.slice(0, 8) }) : ''
  let retrieval = { enabled: false, query: '', candidateCount: 0, chars: 0, hits: [] }
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
      retrieval = {
        enabled: true,
        query,
        candidateCount: 0,
        chars: 0,
        hits: [],
        error: typeof error?.code === 'string' ? error.code : 'retrieval-failed',
      }
    }
  }

  const budget = { limit: BRIEF_BUDGET_BYTES, used: 0, overBudget: false }
  const dropped = []
  const kept = [...sections]
  const total = () => kept.reduce((sum, item) => sum + item.bytes, 0)
  while (total() > BRIEF_BUDGET_BYTES && kept.length > 1) {
    const last = kept[kept.length - 1]
    const bytes = last.bytes
    kept.pop()
    dropped.unshift({ name: last.name, bytes, reason: 'budget' })
  }
  budget.used = total()
  budget.overBudget = budget.used > BRIEF_BUDGET_BYTES
  if (dropped.some(item => item.name === 'retrieval')) {
    retrieval = { ...retrieval, hits: retrieval.hits.map(hit => ({ ...hit, sent: false })) }
  }
  const rendered = kept.map(item => (item.absent ? { ...item, content: '', bytes: 0 } : item))
  return { sections: rendered, budget, missing, dropped, retrieval }
}

/**
 * One brief section.
 * @returns {object} section record.
 */
function section(name, title, content, source, options = {}) {
  const absent = options.absent === true
  const text = absent ? '' : String(content ?? '')
  return {
    name,
    title,
    ...(source !== undefined ? { source } : {}),
    ...(Array.isArray(options.sourceIds) ? { sourceIds: options.sourceIds } : {}),
    content: text,
    bytes: byteLength(text),
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
 * @param {string} root - workspace directory.
 * @param {object} manifest - work manifest.
 * @param {number} number - chapter being written.
 * @returns {Promise<object>} section record.
 */
async function volumeSummarySection(root, manifest, number) {
  const volumes = readVolumes(root, manifest.workId)
  const volume = volumes.find(item => number >= item.from && number <= item.to)
  if (volume === undefined) return section('volumeSummary', '本卷摘要', '', '', { absent: true })
  const summary = typeof volume.summary === 'string' ? volume.summary.trim() : ''
  return section('volumeSummary', `本卷摘要（${volume.title}）`, summary, virtualPath(manifest.workId, 'volumes'), { absent: summary === '' })
}

/**
 * Summaries of the previous chapters, newest window only.
 *
 * This is the rolling window: writing chapter 60 reads the same number of
 * sections as writing chapter 6.
 * @param {string} root - workspace directory.
 * @param {object} manifest - work manifest.
 * @param {number} number - chapter being written.
 * @returns {Promise<object>} section record.
 */
async function recentSummariesSection(root, manifest, number) {
  const first = Math.max(1, number - RECENT_SUMMARY_WINDOW)
  const rows = new Map(listSummaryStates(root, manifest.workId).map(row => [row.number, row]))
  const lines = []
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
 * @param {string} root - workspace directory.
 * @param {object} manifest - work manifest.
 * @param {number} number - chapter being written.
 * @returns {Promise<object>} section record.
 */
async function previousSection(root, manifest, number) {
  if (number === 1) return section('previous', '上一章结尾', '', '', { absent: true })
  const previous = number - 1
  const summary = readSummaryState(root, manifest.workId, previous)
  if (summary.state === 'current') {
    return section('previous', '上一章结尾', summary.text.trim(), virtualPath(manifest.workId, `summaries/${chapterStem(previous)}.md`))
  }
  let body
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
