/** Validator prompt: check one proposed delta against the chapter body. */

import { roleSkills } from '../../skill-routing.ts'
import { STATE_CHECK_NO_EVIDENCE } from './constants.ts'

/** Fields the validator prompt reads; the runner owns the full input. */
export interface ValidatorPromptInput {
  manifest: any
  workId: string
  chapter: number
  revision: number
  body: string
  payload: any
  folded: any
  plan: any
  summary: any
  cards: any
  delegationId: string
}

/** Render one optional prompt section. */
function section(title: string, content: unknown): string {
  const text = String(content ?? '').trim()
  return text === '' ? '' : `## ${title}\n${text}`
}
/** Build the validator child prompt. The body is the only evidence; the other
 * sections are context and are labelled as such.
 * @param input - work, chapter, manifest, body, revision, delta, folded, summary, plan, cards, delegationId.
 * @returns prompt text.
 */
export function buildValidatorPrompt(input: ValidatorPromptInput): string {
  const subjects = new Set((input.payload.factOps?.upsert ?? []).map((fact: any) => fact?.subject).filter(Boolean))
  const hookIds = new Set(Object.values(input.payload.hookOps ?? {}).flat())
  const priorFacts = input.folded.facts.filter((fact: any) => subjects.has(fact.subject))
  const priorHooks = input.folded.hooks.filter((hook: any) => hookIds.has(hook.hookId))
  const cards = input.cards.filter((card: any) => subjects.has(card.name)).slice(0, 8)
  const context = [
    section('折叠前状态（上下文，不是正文证据）', JSON.stringify({
      facts: priorFacts,
      hooks: priorHooks,
    }, null, 2)),
    section('本章摘要（上下文，不是正文证据）', input.summary),
    section('本章章纲（上下文，不是正文证据）', input.plan),
    section('人物卡（上下文）', JSON.stringify(cards, null, 2)),
  ].filter(Boolean).join('\n\n')

  return [
    `你是《${input.manifest.title}》（${input.workId}）第 ${input.chapter} 章的语义状态对账子代理。`,
    `开工前先调用 skill 工具加载 \`${roleSkills('validator', 'longform')[0]}\`，严格按它判断。`,
    '不要用 glob/grep 搜索技能或插件文件；方法以加载到的技能正文为准。',
    '',
    '## 本次任务',
    `核对下面拟写入的状态 payload 是否被本章正文 r${input.revision} 支持，找出正文里发生但 payload 没记的重要变化。`,
    '只核对本次 payload，不重审旧投影；正文是唯一事实证据，其他部分只作上下文。',
    '',
    `## 本章正文（r${input.revision}，唯一事实证据）`,
    input.body,
    '',
    ...(context === '' ? [] : [context, '']),
    '## 待对账 payload',
    JSON.stringify(input.payload, null, 2),
    '',
    '## 输出契约',
    `必须调用 story_submit，delegationId 是 ${input.delegationId}。`,
    'payload 格式：{"items":[{"code":"fact-unsupported","where":"…","problem":"…","evidence":"…","impact":"…","severity":"major","fix":"…"}],"reconciliationRequired":true}。',
    'reconciliationRequired 只在“重算投影能解决”时为 true；纯正文矛盾/评审意见为 false；有 finding 但省略时按 true。',
    '没有发现时 payload 为 {"items":[]}。',
    `证据必须是正文里的连续原文；只有非 missing-change 的 finding 在正文没有对应段落时写「${STATE_CHECK_NO_EVIDENCE}」；missing-change 必须给正文引文。`,
    '提交成功后最终只回「已提交」；不要手动调用落盘动作，不要改写正文。',
    'story_submit 返回 ok:false 时，按 error.retryable 修正 payload 后重提，最多 3 次；不要把工具错误当成最终失败。',
  ].join('\n')
}

