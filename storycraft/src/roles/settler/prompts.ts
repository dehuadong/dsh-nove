/** Settler prompt: project only what the chapter body proves. */

import { roleSkills } from '../../skill-routing.ts'

/** Fields the settler prompt reads; the runner owns the full input. */
export interface SettlerPromptInput {
  workId: string
  chapter: number
  revision: number
  seq: number
  folded: any
  summary: any
  plan: any
  cards: any
  body: string
  feedback: string
  delegationId: string
  manifest: any
}

/** Render one optional prompt section. */
function section(title: string, content: unknown): string {
  const text = String(content ?? '').trim()
  return text === '' ? '' : `## ${title}\n${text}`
}/** Build the settler prompt. The body is the only evidence; the rest is context. */
export function buildSettlerPrompt(input: SettlerPromptInput): string {
  const baseline = JSON.stringify({
    chapter: input.chapter,
    revision: input.revision,
    seq: input.seq,
    facts: input.folded.facts,
    hooks: input.folded.hooks,
  }, null, 2)
  const context = [
    section('本章摘要（上下文，不是正文证据）', input.summary),
    section('本章章纲（上下文，不是正文证据）', input.plan),
    section('人物卡（上下文）', JSON.stringify(input.cards, null, 2)),
  ].filter(Boolean).join('\n\n')
  return [
    `你是《${input.manifest.title}》（${input.workId}）第 ${input.chapter} 章的 settler 子代理。`,
    `开工前先调用 skill 工具加载 \`${roleSkills('settler', 'longform')[0]}\`，严格按它抽取。`,
    '不要用 glob/grep 搜索技能或插件文件；方法以加载到的技能正文为准。',
    '',
    '## 本次任务',
    `把本章正文 r${input.revision} 明确发生的增量事实与伏笔变化投影成 delta。`,
    '只写正文明确发生的事；计划、摘要、人物卡只作上下文，不是已发生事件。事实只追加；伏笔只使用 baseline 里已有的 text，新伏笔用最终措辞。',
    '',
    `## 本章正文（r${input.revision}，唯一事实证据）`,
    input.body,
    '',
    '## baseline（上下文；只投影这版正文）',
    baseline,
    '',
    ...(context === '' ? [] : [context, '']),
    ...(input.feedback === '' ? [] : [section('上一次结算的反馈', input.feedback), '']),
    '## 输出契约',
    `必须调用 story_submit，delegationId 是 ${input.delegationId}。`,
    'payload 格式：{"factOps":{"upsert":[{"subject":"…","predicate":"…","object":"…"}],"expire":[{"subject":"…","predicate":"…"}]},'
    + '"hookOps":{"progress":["hookId"],"mention":["hookId"],"defer":["hookId"],"resolve":["hookId"],"supersede":["hookId"]},'
    + '"newHooks":[{"text":"…"}]}。',
    '已有伏笔只能引用 baseline 的 hookId；新伏笔放进 newHooks，不给 id。本章没有可记录的变化时三个字段都为空。',
    '提交成功后最终只回「已提交」；不要手动落盘，不要改正文。',
    'story_submit 返回 ok:false 时，按 error.retryable 修正 payload 后重提，最多 3 次。',
  ].join('\n')
}

