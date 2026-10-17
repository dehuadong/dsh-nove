/**
 * Truth files, chapter summaries, and the pre-write brief.
 *
 * `bible/` is the single source of truth for setting and plan; `summaries/`
 * accumulates one summary per written chapter. Writing is serialized through
 * the work's single-writer lock and lands atomically; reading is pure, so the
 * same inputs always assemble the same brief byte for byte.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'
import {
  StoryError, chapterNumber, chapterStem, foldEvents, readChapter, readManifest, readOptional, rootRelative,
  withWorkLock, workDirectory, writeAtomic,
} from './storage.js'

/** Every truth file, with how its content is validated. */
export const BIBLE_FILES = {
  world: { file: 'bible/world.md', kind: 'markdown' },
  characters: { file: 'bible/characters.json', kind: 'characters' },
  style: { file: 'bible/style.md', kind: 'markdown' },
  plan: { file: 'bible/plan.md', kind: 'markdown' },
  intent: { file: 'bible/intent.md', kind: 'markdown' },
}

/** Names in the order the brief presents them (highest priority first). */
export const BRIEF_SECTION_ORDER = ['intent', 'plan', 'characters', 'hooks', 'previous', 'style', 'wordPolicy']

/** Byte budget of one assembled brief. */
export const BRIEF_BUDGET_BYTES = 8192

/** Bytes of the previous chapter's tail used when no summary exists yet. */
const PREV_TAIL_BYTES = 800

/** Character cap of one chapter summary. */
export const SUMMARY_MAX_CHARS = 400

/** Word-count policy the brief hands to the model (validation belongs to a later stage). */
export const WORD_POLICY = '单章 3000–5000 字；每章结尾留悬念钩子；61 章起分卷。'

/** A file's content version: first 12 hex digits of its SHA-256. */
export function contentVersion(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
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
  const manifest = await readManifest(root, workId)
  const names = only === undefined ? Object.keys(BIBLE_FILES) : [only]
  if (names.some(name => BIBLE_FILES[name] === undefined)) {
    throw new StoryError('bible-invalid', `未知的真值文件：${String(only)}`)
  }
  const dir = workDirectory(root, manifest.workId)
  const files = []
  const missing = []
  for (const name of names) {
    const spec = BIBLE_FILES[name]
    const content = await readOptional(join(dir, spec.file))
    if (content === undefined) {
      missing.push(name)
      continue
    }
    files.push({
      name,
      path: rootRelative(root, join(dir, spec.file)),
      version: contentVersion(content),
      content,
      draft: isDraft(content),
    })
  }
  if (missing.length > 0 && only !== undefined) {
    throw new StoryError('bible-missing', `真值文件缺失：${missing.join('、')}（可用 story_bible_write 补建）`)
  }
  return { files, missing }
}

/**
 * Validate and write one truth file.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {string} name - one of {@link BIBLE_FILES}.
 * @param {string} content - new content.
 * @returns {Promise<{name: string, path: string, version: string}>} the written file.
 */
export async function writeBible(root, workId, name, content) {
  validateBibleContent(name, content)
  return withWorkLock(root, workId, async () => {
    const manifest = await readManifest(root, workId)
    const spec = BIBLE_FILES[name]
    const file = join(workDirectory(root, manifest.workId), spec.file)
    await mkdir(join(workDirectory(root, manifest.workId), 'bible'), { recursive: true })
    await writeAtomic(file, content)
    return { name, path: rootRelative(root, file), version: contentVersion(content) }
  })
}

/**
 * Import what can be imported from an older work's `design/` folder.
 *
 * Only content whose structure is already known is copied; a character sheet is
 * never fabricated — the names found in `design/cast.md` are reported so the
 * model can ask the author for the missing fields.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<{imported: object[], pending: string[], names: string[]}>} import report.
 */
export async function importBible(root, workId) {
  return withWorkLock(root, workId, async () => {
    const manifest = await readManifest(root, workId)
    const dir = workDirectory(root, manifest.workId)
    const design = join(dir, 'design')
    const world = await readOptional(join(design, 'world.md'))
    const outline = await readOptional(join(design, 'outline.md'))
    const cast = await readOptional(join(design, 'cast.md'))
    if (world === undefined && outline === undefined && cast === undefined) {
      throw new StoryError('nothing-to-import', '没有可收编的 design/ 内容')
    }
    const imported = []
    const skipped = []
    await mkdir(join(dir, 'bible'), { recursive: true })
    const targets = [
      { name: 'world', from: 'design/world.md', content: world },
      { name: 'plan', from: 'design/outline.md', content: outline },
    ]
    for (const target of targets) {
      if (target.content === undefined) continue
      const spec = BIBLE_FILES[target.name]
      const existing = await readOptional(join(dir, spec.file))
      if (existing !== undefined && !isDraft(existing)) {
        skipped.push(`${spec.file}（已有内容，未覆盖）`)
        continue
      }
      await writeAtomic(join(dir, spec.file), target.content)
      imported.push({ from: target.from, to: spec.file, version: contentVersion(target.content) })
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
  })
}

/**
 * Path of one chapter's summary.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {number} chapter - chapter number.
 * @returns {string} absolute path.
 */
function summaryPath(root, workId, chapter) {
  return join(workDirectory(root, workId), 'summaries', `${chapterStem(chapter)}.md`)
}

/**
 * Chapter summary index, rebuilt from the files on disk.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<{chapters: object[]}>} index payload.
 */
export async function summaryIndex(root, workId) {
  const dir = join(workDirectory(root, workId), 'summaries')
  let names
  try {
    names = await readdir(dir)
  } catch {
    return { chapters: [] }
  }
  const chapters = []
  for (const name of names) {
    const match = /^ch-(\d{4})\.md$/.exec(name)
    if (match === null) continue
    const text = (await readOptional(join(dir, name))) ?? ''
    chapters.push({ number: Number(match[1]), path: `summaries/${name}`, words: [...text.trim()].length })
  }
  chapters.sort((left, right) => left.number - right.number)
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
  return await readOptional(summaryPath(root, workId, chapter))
}

/**
 * Write one chapter's summary, capped at {@link SUMMARY_MAX_CHARS}.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {number} chapter - chapter number.
 * @param {string} text - summary text.
 * @returns {Promise<{path: string, truncated: boolean, words: number}>} write receipt.
 */
export async function writeSummary(root, workId, chapter, text) {
  const number = chapterNumber(chapter)
  const body = String(text ?? '').trim()
  if (body === '') throw new StoryError('empty-summary', '摘要不能为空')
  return withWorkLock(root, workId, async () => {
    const manifest = await readManifest(root, workId)
    const entry = manifest.chapters.find(item => item.number === number)
    if (entry === undefined || entry.currentRevision === 0) {
      throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能写摘要`)
    }
    const chars = [...body]
    const truncated = chars.length > SUMMARY_MAX_CHARS
    const content = `${truncated ? chars.slice(0, SUMMARY_MAX_CHARS).join('') : body}\n`
    const file = summaryPath(root, manifest.workId, number)
    const dir = join(workDirectory(root, manifest.workId), 'summaries')
    await mkdir(dir, { recursive: true })
    await writeAtomic(file, content)
    await writeAtomic(join(dir, 'index.json'), `${JSON.stringify(await summaryIndex(root, manifest.workId), null, 2)}\n`)
    return { path: rootRelative(root, file), truncated, words: [...body].length }
  })
}

/**
 * Assemble the pre-write brief for one chapter.
 *
 * Pure: every input is read from disk, sections are ordered by
 * {@link BRIEF_SECTION_ORDER}, and identical inputs produce identical bytes.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {number|string} chapter - chapter number.
 * @returns {Promise<{sections: object[], budget: object, missing: string[], dropped: object[]}>} brief.
 */
export async function assembleBrief(root, workId, chapter) {
  const number = chapterNumber(chapter)
  const manifest = await readManifest(root, workId)
  const entry = manifest.chapters.find(item => item.number === number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const dir = workDirectory(root, manifest.workId)

  const missing = []
  const raw = {}
  for (const [name, spec] of Object.entries(BIBLE_FILES)) {
    const content = await readOptional(join(dir, spec.file))
    if (content === undefined) missing.push(name)
    else raw[name] = content
  }
  if (missing.length > 0) {
    throw new StoryError('bible-missing', `真值文件缺失：${missing.join('、')}（可用 story_bible_write 补建）`)
  }

  const plan = await readOptional(join(dir, 'outline', `${entry.id}.plan.md`))
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

  const events = (await readOptional(join(dir, 'state', 'events.jsonl'))) ?? ''
  const hooks = foldEvents(events).hooks.filter(hook => hook.state !== 'resolved')
  const hookText = hooks
    .map(hook => `- ${hook.text}（${hook.state}，第 ${hook.openedChapter} 章埋）`)
    .join('\n')

  const sections = [
    section('intent', '作者意图与当前焦点', raw.intent, 'bible/intent.md'),
    section('plan', '本章章纲', planText, `outline/${entry.id}.plan.md`, { absent: plan === undefined }),
    section('characters', '本章涉及人物', characterText, 'bible/characters.json', { fallback: matched.length === 0 }),
    section('hooks', '未解伏笔', hookText, 'state/events.jsonl', { absent: hooks.length === 0 }),
    await previousSection(root, manifest, number),
    section('style', '文风要点', raw.style, 'bible/style.md'),
    section('wordPolicy', '字数口径', WORD_POLICY, 'storycraft'),
  ]

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
  const rendered = kept.map(item => (item.absent ? { ...item, content: '', bytes: 0 } : item))
  return { sections: rendered, budget, missing, dropped }
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
    source,
    content: text,
    bytes: byteLength(text),
    absent,
    ...(isDraft(text) && !absent ? { draft: true } : {}),
    ...(options.fallback === true ? { fallback: true } : {}),
    ...(options.bodyFallback === true ? { bodyFallback: true } : {}),
  }
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
  const summary = await readSummary(root, manifest.workId, previous)
  if (summary !== undefined && summary.trim() !== '') {
    return section('previous', '上一章结尾', summary.trim(), `summaries/${chapterStem(previous)}.md`)
  }
  let body
  try {
    body = (await readChapter(root, { work: manifest.workId, chapter: previous })).content
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
  return section('previous', '上一章结尾', tail.trim(), `chapters/${chapterStem(previous)}.md`, { bodyFallback: true })
}
