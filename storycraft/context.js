/**
 * Role-scoped context assembly.
 *
 * A sub-agent never receives "the brief". It receives the sections its role needs,
 * each marked protected (never trimmed) or compressible (trimmed when the budget
 * is tight), plus a fact whitelist the caller validates against. The trace records
 * what was sent, what was shortened, and what was dropped.
 */

import { join } from 'node:path'
import {
  chapterNumber, chapterStem, foldEvents, formOf, readManifest, readOptional, unitOf, workDirectory,
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
  if (text === undefined) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** One section record. */
function section(name, title, content, protection) {
  return { name, title, content: String(content ?? '').trim(), protection }
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
  const { root, chapter, role } = input
  const manifest = await readManifest(root, input.work)
  const number = chapterNumber(chapter)
  const dir = workDirectory(root, manifest.workId)
  const entry = manifest.chapters.find(item => item.number === number)
  const form = formOf(manifest)
  const unit = unitOf(form)

  // 1. authority — protected
  const authority = section('authority', '权威顺序', AUTHORITY[role] ?? AUTHORITY.writer, 'protected')

  // 2. task — protected
  let taskText = ''
  if (role === 'writer' || role === 'planner') {
    const plan = await readOptional(join(dir, 'outline', `${entry?.id ?? chapterStem(number)}.plan.md`))
    taskText = plan ?? '（本章还没有章纲）'
  } else {
    taskText = String(input.task ?? '').trim()
  }
  const task = section('task', '本章任务', taskText, 'protected')

  // 3. constraints — protected
  const characters = await readCharacters(root, manifest.workId)
  const perspective = /- 视角：(.+)/u.exec(taskText)?.[1]?.trim()
  const lead = characters.find(item => item?.name !== undefined && perspective !== undefined && perspective.includes(item.name))
  const constraintLines = [
    `形态：${form}（单位：${unit}）`,
    manifest.wordRange === undefined
      ? '字数：未设定（按作者习惯）'
      : `字数：单章 ${manifest.wordRange.min}–${manifest.wordRange.max} 字`,
    manifest.writing?.person === undefined ? '' : `叙事人称：${manifest.writing.person}`,
    ...(Array.isArray(manifest.writing?.prohibitions) ? manifest.writing.prohibitions.map(item => `禁令：${item}`) : []),
    ...(lead === undefined ? [] : [
      `主角：${lead.name}`,
      ...(lead.limit === undefined ? [] : [`行为边界：${lead.limit}`]),
      ...(lead.voice === undefined ? [] : [`语气：${lead.voice}`]),
    ]),
  ].filter(line => line !== '')
  const constraints = section('constraints', '硬约束', constraintLines.join('\n'), 'protected')

  // 4. state — compressible (open hooks + characters in play)
  const events = (await readOptional(join(dir, 'state', 'events.jsonl'))) ?? ''
  const folded = foldEvents(events)
  const openHooks = folded.hooks.filter(hook => hook.state !== 'resolved')
  const stateLines = [
    ...(openHooks.length === 0 ? ['未解伏笔：无'] : ['未解伏笔：', ...openHooks.slice(0, 8).map(hook => `- ${hook.text}（${hook.state}，第 ${hook.openedChapter} 章）`)]),
  ]
  const state = section('state', '人物与状态', stateLines.join('\n'), 'compressible')

  // 5. recent — compressible (last three summaries + the previous chapter's tail)
  const summaries = []
  for (let index = Math.max(1, number - 3); index < number; index += 1) {
    const text = await readOptional(join(dir, 'summaries', `${chapterStem(index)}.md`))
    if (text !== undefined && text.trim() !== '') summaries.push(`第 ${index} 章：${text.trim()}`)
  }
  const recent = section('recent', '最近脉络', summaries.join('\n'), 'compressible')

  // 6. style — compressible
  const styleText = await readOptional(join(dir, 'bible', 'style.md'))
  const style = section('style', '文风要点', styleText ?? '', 'compressible')

  // 7. body — protected when the role judges prose rather than writes it
  const body = String(input.body ?? '').trim()
  const bodySection = body === '' ? undefined
    : section('body', '待处理的正文', `---正文开始---\n${body}\n---正文结束---`, 'protected')

  const sections = [authority, task, constraints, state, recent, style]
  if (bodySection !== undefined) sections.splice(3, 0, bodySection)

  // Budget: drop or shorten compressible sections in TRIM_ORDER; protected stay.
  const budget = Number.isInteger(input.budget) && input.budget > 0 ? input.budget : DEFAULT_CONTEXT_BUDGET
  const trace = { budget, sections: [], trimmed: [], dropped: [], overflow: false }
  const kept = sections.map(item => ({ ...item, content: item.content, trimmedTo: undefined }))
  let total = kept.reduce((sum, item) => sum + item.content.length, 0)
  for (const name of TRIM_ORDER) {
    if (total <= budget) break
    const target = kept.find(item => item.name === name)
    if (target === undefined || target.protection !== 'compressible') continue
    if (target.content === '') continue
    // Drop the whole section first; if that is not enough the next one goes too.
    total -= target.content.length
    target.content = ''
    trace.dropped.push(name)
  }
  if (total > budget) {
    // Protected sections alone exceed the budget: report it instead of trimming them.
    trace.overflow = true
  }
  for (const item of kept) {
    trace.sections.push({
      name: item.name,
      protection: item.protection,
      chars: item.content.length,
      ...(trace.dropped.includes(item.name) ? { dropped: true } : {}),
    })
  }
  const text = kept
    .filter(item => item.content !== '')
    .map(item => `## ${item.title}\n${item.content}`)
    .join('\n\n')

  // Fact whitelist: names from the character file, volume titles, numbers in the task.
  const whitelist = {
    names: characters.map(item => item?.name).filter(name => typeof name === 'string' && name !== ''),
    numbers: [...new Set((`${taskText}\n${stateLines.join('\n')}`.match(/\d+(?:\.\d+)?/gu) ?? []))].slice(0, 100),
  }
  return { sections: kept, text, trace, whitelist }
}
