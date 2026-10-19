/**
 * Role-scoped context assembly.
 *
 * A sub-agent never receives "the brief". It receives the sections its role needs,
 * each marked protected (never trimmed) or compressible (trimmed when the budget
 * is tight), plus a fact whitelist the caller validates against. The trace records
 * what was sent, what was shortened, and what was dropped.
 */

import { join } from 'node:path'
import { parseCharacters } from './bible.js'
import {
  StoryError, chapterNumber, chapterStem, foldEvents, formOf, readManifest, readOptional, unitOf, workDirectory,
} from './storage.js'

/** Default budget for one role context, in characters. */
export const DEFAULT_CONTEXT_BUDGET = 8000

/** Section order used when trimming: earlier compressible sections go first. */
const TRIM_ORDER = ['recent', 'state', 'style']

/** Fixed authority order per role. */
const AUTHORITY = {
  writer: [
    '权威顺序：作者本轮要求 > 本章章纲 > 既成事实与禁令 > 卷纲兜底。',
    '章纲里写的必须落地；上下文里没有的人名、地名、数字不得自造。',
  ].join('\n'),
  planner: [
    '权威顺序：作者本轮要求 > 全书计划与卷图 > 最近脉络。',
    '只能引用上下文里存在的人物、卷与伏笔；不得发明新的设定名词。',
  ].join('\n'),
  reviewer: [
    '权威顺序：作品真值与事件日志 > 本章正文 > 章纲。',
    '只按你读到的内容判断；正文缺失或被截断时判「审稿不可用」。',
  ].join('\n'),
  reviser: [
    '权威顺序：点名条目与模式 > 未被点名的正文 > 章纲。',
    '只改点名位置；不得引入上下文里没有的人名、地名与数字。',
  ].join('\n'),
}

/**
 * Read the character entries of one work.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<Array<object>>} character entries.
 */
async function readCharacters(root, workId) {
  const text = await readOptional(join(workDirectory(root, workId), 'bible', 'characters.json'))
  if (text === undefined) return undefined
  return parseCharacters(text)
}

/** One section record. */
function section(name, title, content, protection, source) {
  return { name, title, content: String(content ?? '').trim(), protection, source }
}

/**
 * Assemble the context one role needs for one chapter.
 * @param {object} input - assembly input.
 * @param {string} input.root - workspace directory.
 * @param {string} input.work - work identity.
 * @param {number} input.chapter - chapter number.
 * @param {'writer'|'planner'|'reviewer'|'reviser'} input.role - role name.
 * @param {string} [input.instruction] - author instruction for this run.
 * @param {string} [input.body] - chapter body (reviewer/reviser paths).
 * @param {string} [input.task] - extra task text (reviewer items, reviser items).
 * @param {number} [input.budget] - character budget.
 * @returns {Promise<{sections: object[], text: string, trace: object, whitelist: object}>} the context package.
 */
export async function assembleRoleContext(input) {
  const { root, role } = input
  const scope = input.scope === 'work' ? 'work' : 'chapter'
  const manifest = await readManifest(root, input.work)
  const number = scope === 'work' ? undefined : chapterNumber(input.chapter)
  const dir = workDirectory(root, manifest.workId)
  const entry = number === undefined ? undefined : manifest.chapters.find(item => item.number === number)
  // Planning a chapter runs before its manifest entry (and its plan) exist; the
  // writing path still validates both.
  if (scope === 'chapter' && role !== 'planner' && entry === undefined) {
    throw new StoryError('chapter-not-found', `没有第 ${number} 章：先写章纲再派活`)
  }
  const form = formOf(manifest)
  const unit = unitOf(form)

  // 1. authority — protected
  const authority = section('authority', '权威顺序', AUTHORITY[role] ?? AUTHORITY.writer, 'protected', 'storycraft/context.js')

  // 2. task — protected
  let taskText = ''
  if (scope === 'work') {
    taskText = String(input.task ?? '').trim()
    if (taskText === '') throw new StoryError('task-required', '作品级派活需要一句任务说明')
  } else if (role === 'planner') {
    taskText = String(input.task ?? '').trim()
    if (taskText === '') throw new StoryError('task-required', `第 ${number} 章的规划需要一句任务说明`)
  } else if (role === 'writer') {
    const plan = entry === undefined ? undefined : await readOptional(join(dir, 'outline', `${entry.id}.plan.md`))
    if (plan === undefined) {
      throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再派活`)
    }
    taskText = plan
  } else {
    taskText = String(input.task ?? '').trim()
  }
  const instruction = String(input.instruction ?? '').trim()
  const task = section('task', scope === 'work' ? '作品任务' : '本章任务', [
    instruction === '' ? '' : `作者要求：${instruction}`,
    taskText,
  ].filter(line => line !== '').join('\n'), 'protected', 'outline + 本次要求')

  // 3. constraints — protected
  const characters = (await readCharacters(root, manifest.workId)) ?? []
  if (characters.length === 0 && role === 'writer') {
    throw new StoryError('bible-missing', '人物卡缺失：先用 story_bible_write 建 bible/characters.json 再派活')
  }
  const perspective = scope === 'work' ? undefined : /- 视角：(.+)/u.exec(taskText)?.[1]?.trim()
  const lead = characters.find(item => item?.name !== undefined && perspective !== undefined && perspective.includes(item.name))
  const intent = (await readOptional(join(dir, 'bible', 'intent.md'))) ?? ''
  const constraintLines = [
    `形态：${form}（单位：${unit}）`,
    scope === 'work'
      ? ''
      : manifest.wordRange === undefined
        ? '字数：未设定（按作者习惯）'
        : `字数：单章 ${manifest.wordRange.min}–${manifest.wordRange.max} 字`,
    // 叙事人称与显式禁令尚无写入入口，先用意图文件里的口径；接入 settings 后再补。
    ...(lead === undefined ? [] : [
      `主角：${lead.name}`,
      ...(lead.limit === undefined ? [] : [`行为边界：${lead.limit}`]),
      ...(lead.voice === undefined ? [] : [`语气：${lead.voice}`]),
    ]),
    ...(intent.trim() === '' ? [] : ['本书口径（摘自意图文件）：', intent.trim().slice(0, 600)]),
  ].filter(line => line !== '')
  const constraints = section('constraints', '硬约束', constraintLines.join('\n'), 'protected', 'manifest + bible/characters + bible/intent')

  // 4. state — compressible (open hooks + characters in play)
  const events = (await readOptional(join(dir, 'state', 'events.jsonl'))) ?? ''
  const folded = foldEvents(events)
  const openHooks = folded.hooks.filter(hook => hook.state !== 'resolved')
  const stateLines = [
    ...(folded.entities.length === 0 ? [] : [
      '人物事实：',
      ...folded.entities.slice(0, 8).map(entity => `- ${entity.name}：${(entity.facts ?? []).slice(-3).join('；')}`),
    ]),
    ...(openHooks.length === 0 ? ['未解伏笔：无'] : [
      '未解伏笔：',
      ...openHooks.slice(0, 8).map(hook => `- ${hook.text}（${hook.state}，第 ${hook.openedChapter} 章）`),
    ]),
  ]
  const state = section('state', '人物与状态', stateLines.join('\n'), 'compressible', 'state/events.jsonl')

  // 5. recent — compressible (last three summaries + the previous chapter's tail)
  const summaries = []
  const lastNumber = number ?? (manifest.chapters.length === 0 ? 1 : manifest.chapters[manifest.chapters.length - 1].number + 1)
  for (let index = Math.max(1, lastNumber - 3); index < lastNumber; index += 1) {
    const text = await readOptional(join(dir, 'summaries', `${chapterStem(index)}.md`))
    if (text !== undefined && text.trim() !== '') summaries.push(`第 ${index} 章：${text.trim()}`)
  }
  if (lastNumber > 1) {
    const previousBody = await readOptional(join(dir, 'chapters', `${chapterStem(lastNumber - 1)}.md`))
      ?? await readOptional(join(dir, 'chapters', `${chapterStem(lastNumber - 1)}.r2.md`))
    if (previousBody !== undefined) {
      const tail = previousBody.trim().slice(-400)
      summaries.push(`上一章结尾：…${tail}`)
    }
  }
  const recent = section('recent', '最近脉络', summaries.join('\n'), 'compressible', 'summaries/ + 上一章结尾')

  // 6. style — compressible
  const styleText = await readOptional(join(dir, 'bible', 'style.md'))
  const style = section('style', '文风要点', styleText ?? '', 'compressible', 'bible/style.md')

  // 7. body — protected when the role judges prose rather than writes it
  const body = String(input.body ?? '').trim()
  const bodySection = body === '' ? undefined
    : section('body', '待处理的正文', `---正文开始---\n${body}\n---正文结束---`, 'protected', 'chapters/')

  const sections = [authority, task, constraints, state, recent, style]
  if (bodySection !== undefined) sections.splice(3, 0, bodySection)

  // Budget: drop or shorten compressible sections in TRIM_ORDER; protected stay.
  const budget = Number.isInteger(input.budget) && input.budget > 0 ? input.budget : DEFAULT_CONTEXT_BUDGET
  const trace = { budget, sections: [], trimmed: [], dropped: [], overflow: false, missing: [] }
  const segments = sections.map(item => ({ ...item, content: item.content, trimmed: false }))
  for (const item of segments) {
    if (item.content === '') trace.missing.push({ name: item.name, reason: '没有可用内容' })
  }
  let total = segments.reduce((sum, item) => sum + item.content.length, 0)
  for (const name of TRIM_ORDER) {
    if (total <= budget) break
    const target = segments.find(item => item.name === name)
    if (target === undefined || target.protection !== 'compressible') continue
    if (target.content === '') continue
    const others = total - target.content.length
    const allowed = budget - others
    if (allowed >= 80) {
      // Shrink this section (head + tail) before giving up on it entirely.
      const head = target.content.slice(0, Math.floor(allowed * 0.7))
      const tail = target.content.slice(-Math.floor(allowed * 0.25))
      target.content = `${head}\n…（已压缩）…\n${tail}`
      target.trimmed = true
      trace.trimmed.push(name)
    } else {
      target.content = ''
      trace.dropped.push(name)
    }
    total = segments.reduce((sum, item) => sum + item.content.length, 0)
  }
  if (total > budget) {
    // Protected sections alone exceed the budget: report it instead of trimming them.
    trace.overflow = true
  }
  for (const item of segments) {
    trace.sections.push({
      name: item.name,
      protection: item.protection,
      source: item.source,
      chars: item.content.length,
      ...(trace.dropped.includes(item.name) ? { dropped: true } : {}),
      ...(item.trimmed === true ? { trimmed: true } : {}),
    })
  }
  const text = segments
    .filter(item => item.content !== '')
    .map(item => `## ${item.title}\n${item.content}`)
    .join('\n\n')

  // Fact whitelist: names from the character file, places mentioned by the intent,
  // and every number that appears in the context actually sent.
  const placePattern = /(?:在|到|往|回|自)([\u4e00-\u9fa5]{2,6})(?:滩|城|镇|村|堡|州|府|县|关|口|山|河)/gu
  const places = new Set()
  for (const match of intent.matchAll(placePattern)) places.add(match[1] + match[0].slice(-1))
  const whitelist = {
    names: characters.map(item => item?.name).filter(name => typeof name === 'string' && name !== ''),
    places: [...places].slice(0, 50),
    numbers: [...new Set((text.match(/\d+(?:\.\d+)?/gu) ?? []))].slice(0, 200),
  }
  return { sections: segments, text, trace, whitelist }
}
