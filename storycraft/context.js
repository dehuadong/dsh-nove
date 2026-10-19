/**
 * Role-scoped context assembly.
 *
 * A sub-agent never receives "the brief". It receives the sections its role needs,
 * each marked protected (never trimmed) or compressible (trimmed when the budget
 * is tight), plus a whitelist summary the caller validates against. The trace
 * records what was sent, what was shortened, and what was dropped.
 */

import { join } from 'node:path'
import { deriveWhitelist, readCards, summariseWhitelist } from './facts.js'
import {
  StoryError, chapterNumber, chapterStem, foldEvents, formOf, readManifest, readOptional, unitOf, workDirectory,
} from './storage.js'

/** Default budget for one role context, in characters. */
export const DEFAULT_CONTEXT_BUDGET = 8000

/** Section order used when trimming: earlier compressible sections go first. */
const TRIM_ORDER = ['recent', 'state', 'characters', 'style']

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

/** Standards segments, summarised from the role skills. */
const STANDARDS = {
  reviewer: {
    source: 'skills/review/storycraft-review',
    content: [
      '审稿看四件事：事件是否推进、人物动机是否成立、信息是否自洽、结尾是否留下未解。',
      '每条给出位置、问题、读者影响、严重度与建议模式（patch/polish/rewrite/deslop）；最多 8 条，按严重度排序。',
      '不要把风格偏好写成问题；没有问题的章节就少写条目。',
    ].join('\n'),
  },
  reviser: {
    source: 'skills/revise/storycraft-revise-craft',
    content: [
      'patch：只改点名条目涉及的位置，字数变化不超过两成；',
      'polish：润色措辞，情节与信息不变；rewrite：按条目重写整章；deslop：去掉空转与套话。',
      '未点名的段落保持原样；不得借修订引入新人名、地名与尺寸。',
    ].join('\n'),
  },
}

/**
 * Read the character entries of one work.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<object[]|undefined>} character entries, or undefined when absent.
 */
/** One section record. */
function section(name, title, content, protection, source) {
  return { name, title, content: String(content ?? '').trim(), protection, source }
}

/**
 * Assemble the context one role needs.
 * @param {object} input - assembly input.
 * @param {string} input.root - workspace directory.
 * @param {string} input.work - work identity.
 * @param {number} [input.chapter] - chapter number; optional for work-scoped planning.
 * @param {'writer'|'planner'|'reviewer'|'reviser'} input.role - role name.
 * @param {string} [input.instruction] - author instruction for this run.
 * @param {string} [input.task] - task text composed by the calling action.
 * @param {string} [input.body] - chapter body (reviewer/reviser paths).
 * @param {'work'|'chapter'} [input.scope] - planning scope.
 * @param {number} [input.budget] - character budget.
 * @returns {Promise<{sections: object[], text: string, trace: object, whitelist: object, taskText: string}>} the context package.
 */
export async function assembleRoleContext(input) {
  const { root, role } = input
  const scope = input.scope === 'work' ? 'work' : 'chapter'
  const manifest = await readManifest(root, input.work)
  const number = scope === 'work' ? undefined : chapterNumber(input.chapter)
  const dir = workDirectory(root, manifest.workId)
  const entry = number === undefined ? undefined : manifest.chapters.find(item => item.number === number)
  if (scope === 'chapter' && role !== 'planner' && entry === undefined) {
    throw new StoryError('chapter-not-found', `没有第 ${number} 章：先写章纲再派活`)
  }
  const form = formOf(manifest)
  const unit = unitOf(form)
  const needsPlan = role === 'writer' || role === 'reviewer' || role === 'reviser'

  const chapterPlan = entry === undefined ? undefined : await readOptional(join(dir, 'outline', `${entry.id}.plan.md`))
  if (needsPlan && chapterPlan === undefined) {
    throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再派活`)
  }

  const characters = (await readCards(root, manifest.workId)) ?? []
  if (characters.length === 0 && role !== 'planner') {
    throw new StoryError('bible-missing', '人物卡缺失：先用 story_bible_write 建 bible/characters.json 再派活')
  }

  const body = String(input.body ?? '').trim()
  if ((role === 'reviewer' || role === 'reviser') && body === '') {
    throw new StoryError('chapter-not-written', `第 ${number} 章还没有正文：先写正文，再审稿或修订`)
  }

  const intent = (await readOptional(join(dir, 'bible', 'intent.md'))) ?? ''
  const planText = (await readOptional(join(dir, 'bible', 'plan.md'))) ?? ''
  const volumesText = (await readOptional(join(dir, 'bible', 'volumes.json'))) ?? ''
  let volumeTitles = ''
  if (volumesText !== '') {
    try {
      const parsed = JSON.parse(volumesText)
      const volumes = Array.isArray(parsed) ? parsed : (parsed?.volumes ?? [])
      volumeTitles = volumes
        .map(volume => `- ${volume.title}（第 ${volume.from}–${volume.to} 章）${volume.summary === undefined ? '' : `：${volume.summary}`}`)
        .join('\n')
    } catch {
      volumeTitles = '（卷图无法解析）'
    }
  }

  // 1. authority — protected
  const authority = section('authority', '权威顺序', AUTHORITY[role] ?? AUTHORITY.writer, 'protected', 'storycraft/context.js')

  // 2. task — protected; the action composes it, the author instruction joins it
  const instruction = String(input.instruction ?? '').trim()
  const review = input.review ?? {}
  const openItems = Array.isArray(review.open) ? review.open : []
  let taskText = String(input.task ?? '').trim()
  if (role === 'reviewer') {
    taskText = [`审第 ${number} 章。`, ...openItems.map(item => `- ${item.id}：${item.problem}`)].join('\n')
  } else if (role === 'reviser') {
    const mode = typeof input.mode === 'string' ? input.mode : 'patch'
    taskText = [`按条目修订第 ${number} 章，模式：${mode}。`, ...openItems.map(item => `- ${item.id}：${item.problem}`)].join('\n')
  } else if (role === 'writer') {
    taskText = `写第 ${number} 章正文。`
  }
  if (taskText === '') throw new StoryError('task-required', '派发需要一句任务说明')
  const task = section('task', scope === 'work' ? '作品任务' : '本章任务', [
    instruction === '' ? '' : `作者要求：${instruction}`,
    role === 'writer' ? chapterPlan : taskText,
  ].filter(line => line !== '').join('\n'), 'protected', role === 'writer' ? 'outline + 本次要求' : '本次要求')

  // 3. constraints — protected
  const perspective = scope === 'work' || chapterPlan === undefined ? undefined : /- 视角：(.+)/u.exec(chapterPlan)?.[1]?.trim()
  const lead = characters.find(item => item?.name !== undefined && perspective !== undefined && perspective.includes(item.name))
  const constraintLines = [
    `形态：${form}（单位：${unit}）`,
    scope === 'work'
      ? ''
      : manifest.wordRange === undefined
        ? '字数：未设定（按作者习惯）'
        : `字数：单章 ${manifest.wordRange.min}–${manifest.wordRange.max} 字`,
    ...(lead === undefined ? [] : [
      `主角：${lead.name}`,
      ...(lead.limit === undefined ? [] : [`行为边界：${lead.limit}`]),
      ...(lead.voice === undefined ? [] : [`语气：${lead.voice}`]),
    ]),
    ...(intent.trim() === '' ? [] : ['本书口径（摘自意图文件）：', intent.trim().slice(0, 600)]),
  ].filter(line => line !== '')
  const constraints = section('constraints', '硬约束', constraintLines.join('\n'), 'protected', 'manifest + bible/characters + bible/intent')

  // 4. state — compressible
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

  // 5. recent — compressible
  const summaries = []
  const lastNumber = number ?? (manifest.chapters.length === 0 ? 1 : manifest.chapters[manifest.chapters.length - 1].number + 1)
  for (let index = Math.max(1, lastNumber - 3); index < lastNumber; index += 1) {
    const text = await readOptional(join(dir, 'summaries', `${chapterStem(index)}.md`))
    if (text !== undefined && text.trim() !== '') summaries.push(`第 ${index} 章：${text.trim()}`)
  }
  if (lastNumber > 1) {
    const previousBody = await readOptional(join(dir, 'chapters', `${chapterStem(lastNumber - 1)}.md`))
      ?? await readOptional(join(dir, 'chapters', `${chapterStem(lastNumber - 1)}.r2.md`))
    if (previousBody !== undefined) summaries.push(`上一章结尾：…${previousBody.trim().slice(-400)}`)
  }
  const recent = section('recent', '最近脉络', summaries.join('\n'), 'compressible', 'summaries/ + 上一章结尾')

  // 6. style — compressible
  const styleText = await readOptional(join(dir, 'bible', 'style.md'))
  const style = section('style', '文风要点', styleText ?? '', 'compressible', 'bible/style.md')

  // planner-only: book plan, volume map and character cards
  const planSection = role === 'planner'
    ? section('plan', '全书计划与卷图', [
      planText === '' ? '（还没有全书计划）' : planText.trim(),
      volumeTitles === '' ? '' : `卷图：\n${volumeTitles}`,
    ].filter(line => line !== '').join('\n'), 'protected', 'bible/plan.md + bible/volumes.json')
    : undefined
  const characterBrief = role === 'planner'
    ? section('characters', '人物卡（节选）', characters.slice(0, 6).map(item => [
      `- ${item.name}：${item.role}`,
      ...(item.limit === undefined ? [] : [`  边界：${item.limit}`]),
      ...(item.voice === undefined ? [] : [`  语气：${item.voice}`]),
    ].join('\n')).join('\n'), 'compressible', 'bible/characters.json')
    : undefined

  // writer/reviewer/reviser: the chapter plan; reviewer/reviser also get the body
  const chapterPlanSection = role === 'writer' ? undefined
    : needsPlan ? section('plan', '本章章纲', chapterPlan ?? '', 'protected', `outline/${entry?.id}.plan.md`) : undefined
  const bodySection = body === ''
    ? undefined
    : section('body', '待处理的正文', `---正文开始---\n${body}\n---正文结束---`, 'protected', 'chapters/')
  const standard = role === 'reviewer' || role === 'reviser'
    ? section('standard', role === 'reviewer' ? '审稿标准' : '修订标准', STANDARDS[role].content, 'protected', STANDARDS[role].source)
    : undefined

  // Section order follows the role contract.
  const sections = [authority, task, constraints]
  if (role === 'planner') {
    if (planSection !== undefined) sections.push(planSection)
    if (characterBrief !== undefined) sections.push(characterBrief)
  }
  if (chapterPlanSection !== undefined) sections.push(chapterPlanSection)
  if (bodySection !== undefined) sections.push(bodySection)
  sections.push(state, recent)
  if (role === 'writer' || role === 'planner') sections.push(style)
  if (standard !== undefined) sections.push(standard)

  // Budget: compress or drop compressible sections; protected stay.
  const budget = Number.isInteger(input.budget) && input.budget > 0 ? input.budget : DEFAULT_CONTEXT_BUDGET
  const trace = { budget, sections: [], trimmed: [], dropped: [], missing: [], overflow: false }
  const segments = sections.map(item => ({ ...item, trimmed: false }))
  for (const item of segments) {
    if (item.content === '') trace.missing.push({ name: item.name, reason: '没有可用内容' })
  }
  let total = segments.reduce((sum, item) => sum + item.content.length, 0)
  for (const name of TRIM_ORDER) {
    if (total <= budget) break
    const target = segments.find(item => item.name === name)
    if (target === undefined || target.protection !== 'compressible' || target.content === '') continue
    const allowed = budget - (total - target.content.length)
    if (allowed >= 80) {
      target.content = `${target.content.slice(0, Math.floor(allowed * 0.7))}\n…（已压缩）…\n${target.content.slice(-Math.floor(allowed * 0.25))}`
      target.trimmed = true
      trace.trimmed.push(name)
    } else {
      target.content = ''
      trace.dropped.push(name)
    }
    total = segments.reduce((sum, item) => sum + item.content.length, 0)
  }
  if (total > budget) trace.overflow = true
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

  const whitelist = await deriveWhitelist(root, { work: manifest.workId, ...(number === undefined ? {} : { chapter: number }) })
  return { sections: segments, text, trace, whitelist: summariseWhitelist(whitelist), taskText }
}
