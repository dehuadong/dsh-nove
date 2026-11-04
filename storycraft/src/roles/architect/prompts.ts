/** Architect role prompt assembly. */

import { formOf } from '../../domain.ts'
import { roleSkills } from '../../skill-routing.ts'
import { architectReferences, renderReferenceBlock, type SkillReference } from '../../skill-references.ts'
import type { ArchitectPromptRequest } from './contract.ts'

/** Build the architect child prompt for one foundation stage. */
export function architectPrompt({ work, stage, instruction, delegationId, manifest, foundation, proposal }: ArchitectPromptRequest): string {
  const labels = { foundation: '基础设定（同一 child 四段提交，共五类产物）', design: '故事框架、规则与角色索引', frame: '故事框架与卷图', rules: '作品规则', hooks: '初始伏笔', roles: '角色索引', cards: '角色卡' }
  const shapes = {
    foundation: '本派发必须在同一 child 内按顺序调用四次 story_submit，每次带 phase：outline（storyFrame/volumeMap/currentFocus）→ details（bookRules/pendingHooks）→ cast_index（rolesIndex）→ cards（roleCards）。每个 phase 的字段合同按本技能的对应字段段；不要一次提交五块，也不要只提交第一段。',
    design: 'payload 格式：{"storyFrame":"# 故事框架…（含 ## 前提/## 核心冲突/## 主角动机/## 约束/## 因果解决）","volumeMap":"## 第一卷\\n- 卷目标：…\\n- 起止章：…\\n- 关键节拍：…\\n- 卷末承诺：…","currentFocus":"# 当前焦点\\n…","bookRules":{...},"rolesIndex":{"roles":[{"name":"…","tier":"major|minor"}]}}。一次提交五块，字段合同按本技能。',
    frame: 'payload 格式：{"storyFrame":"# 故事框架…（含 ## 前提/## 核心冲突/## 主角动机/## 约束/## 因果解决）","volumeMap":"## 第一卷\\n- 卷目标：…\\n- 起止章：…\\n- 关键节拍：…\\n- 卷末承诺：…","currentFocus":"# 当前焦点\\n…"}。',
    rules: 'payload 格式：{"bookRules":{"version":"2","narrativePerson":"…","prohibitions":["…"],"protagonist":{"name":"…","personalityLock":["…"],"behavioralConstraints":["…"]},"genreLock":{"primary":"…","forbidden":["…"]},"enableFullCastTracking":false,"allowedDeviations":["…"],"markdown":"# 作品规则\\n…"}}。',
    details: 'payload 格式：{"bookRules":{...同 rules 段},"pendingHooks":[{"hookId":"…","type":"…","expectedPayoff":"…","notes":"…","text":"…"}]}；pendingHooks 必填，可为空数组；每条五字段，hookId 在本次提交内唯一，不写 status/起始章。',
    hooks: 'payload 格式：{"pendingHooks":[{"hookId":"…","type":"…","expectedPayoff":"…","notes":"…","text":"…"}]}；这是手动修复初始伏笔，字段合同同 details 段。',
    roles: 'payload 格式：{"rolesIndex":{"roles":[{"name":"…","tier":"major|minor"}]}}；只列影响开篇冲突的具名人物，≥1，无数量上限。',
    cards: 'payload 格式：{"roleCards":[{"slug":"…","name":"…","tier":"major|minor","motivation":"…","knowledge":"…","relationshipPressure":"…","limits":"…","arc":"可选","markdown":"# …"}]}；按 storycraft-architect 的 cards 合同逐人提交。',
  }
  const context = []
  if (stage !== 'frame' && stage !== 'cards' && foundation.storyFrame !== undefined) context.push(`## 故事框架\n${foundation.storyFrame}`)
  if (stage === 'cards' && foundation.rolesIndex !== undefined) context.push(`## 角色索引\n${JSON.stringify(foundation.rolesIndex, null, 2)}`)
  const references: SkillReference[] = architectReferences(stage)
  const referenceBlock = renderReferenceBlock(references)
  return [
    `你是《${manifest.title}》（${manifest.workId}）的架构师子代理，负责基础设定：${labels[stage]}。`,
    `开工前先调用 skill 工具加载 ${roleSkills('architect', formOf(manifest)).map(id => `\`${id}\``).join('、')}，按其契约执行；` +
      (references.length === 0
        ? '方法参考是本技能目录下的 `references/foundation-design.md`，提交前必须先读它。'
        : `本阶段的 ${references.length} 份方法参考已由运行时加载在下方（${references.map(reference => `\`${reference.path}\``).join('、')}），不要再自行查找或读取其它参考。`),
    ...(proposal === undefined ? [] : ['', '## 作者已确认的提案', `前提：${proposal.premise}`, `人物：${proposal.characters}`, '只依据本任务的提案与已确认材料工作；不得延续其它会话或其它作品的内容。']),
    '',
    '## 本次任务',
    instruction.trim() === '' ? `生成${labels[stage]}。` : instruction.trim(),
    ...(context.length === 0 ? [] : ['', '## 已生成的基础设定', ...context]),
    '',
    referenceBlock,
    '',
    '## 输出契约',
    `必须调用 story_submit，delegationId 是 ${delegationId}。`,
    shapes[stage],
    '结构与字段必须符合契约；每段提交成功后继续下一 phase，四段都完成后再结束并只回「已提交」，不要手动调用落盘动作。',
    'story_submit 返回 ok:false 时，按 error.message 修正 payload 后重提，最多 3 次。',
  ].join('\n')
}
