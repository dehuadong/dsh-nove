---
title: 故事工坊：单一工作模式与子代理强制
status: proposed
created: 2026-10-19
updated: 2026-10-19
---

# Agent Note：故事工坊：单一工作模式与子代理强制

## 问题

故事工坊把四个工作角色（规划、写手、修订者、审稿人）声明成四个 Agent 预设，于是模式选择器里出现五个可切换项；角色每增加一个就多一张卡。角色是任务分工，不是用户可切换的工作模式。

DSH 0.2.1 移除了 `dsh-tool-subagent` 的 `persona` 与 `toolFilter`：子代理要换人设或工具面，只能选另一个预设。不接受每角色一个预设，就必须回答两件事：子代理如何拿到角色，以及「只返回文本、不落盘」由谁强制。

产品行为与验收由工作项 #11 拥有，不在这里。

## 提案

### 组合是模式，角色是任务

故事工坊只声明一个预设 `storycraft`，它是一套能力组合：标准基线 + 故事工坊行。角色不属于组合，而是派发时写进任务提示的角色说明；角色方法与输出契约留在四个技能文档里。

### 组合内容

- 基线：整份标准预设列表（含 `delegation`、`planning`、`compaction`、`goal`、`jobs`、`schedule`、`time-context`、`web`），减去 `tool-subagent-fork`，并按 D7 去掉 `tool-subagent` 的 `modelSelectionSettings: true`；
- 委派：一条 `dsh-tool-subagent`，`provider: spawn`、`toolName: subagent`、`maxDepth: 1`，不写 `agentPreset`；
- 故事工坊行：人设、`dsh-storycraft/skills`（`mode: all`）、`dsh-storycraft/tools`；
- 不启用 `modelSelectionSettings`。

### 子代理加入父方组合

省略 `agentPreset` 时，spawn 子代理加入父方当前预设代际，继承同一套工具、技能与人设；角色只由任务提示区分。这样只有一个预设，子代理的冷恢复沿用父方组合的既有规则。

### 强制：守卫 + 动作断言

组合级只读需要第二个预设，所以强制放在运行时：

- 预设作用域注册 `ctx.tools.guard`：`delegationDepth > 0` 的 agent 调用 `write`、`edit`、`pwsh`、`bash` 时被拒绝，理由指明「子代理只返回文本，由派发者落盘」；
- 故事工坊的写动作在公共入口断言 `delegationDepth === 0`；读动作（`story_brief`、`story_status`、`story_next`、`story_bible` 等）不受限；
- `maxDepth: 1` 保证子代理不能再派发。

守卫注册在预设作用域，作用域链覆盖主 Agent 与子 Agent，谓词按深度区分。子代理的文件读、真值读、技能加载与网络检索仍是原生工具。

### 人设两用

人设描述工作模式而不是单一身份：主会话是主编（判断、派发、验收、落盘），被派发时按任务指定的角色执行、只把文本返回。主编的编排方法由技能承载，不依赖人设长度。

### 角色内容

写手、审稿、修订、规划四个技能保持不变，继续拥有判断标准与输出契约；主编派发时从技能与 `story_brief` 取任务段和契约，写进子代理的 prompt。

## 备选方案

- **每角色一个预设**（现方案）：卡片随角色增长、角色出现在模式选择器；否决。
- **一个只读的「子代理」预设**：只需两张卡并能保留组合级只读，但仍是第二个可切换模式，与「故事工坊是唯一工作模式」冲突；否决。
- **子代理继承组合但不加强制**：子代理拿到原生 `write` 就能直接改文件，作品目录与阶段机可被绕过；否决。
- **恢复 per-child persona / toolFilter**：当前版本加载即报错，且运行时注入的身份不在会话日志里，破坏「模型可见即已记录」；否决。
- **保留 `story_*_agent` 私有动作**：绕开官方工具面、模型选择与深度策略，session 里没有标准委派记录；否决。

## 后果

- 子代理的工具目录仍显示 `write`/`edit` 等工具，只是执行被拒；可能多一次失败调用与相应 token。
- 主 Agent 与子代理共用一段人设；主编身份靠技能补足，不再靠人设独占。
- 继承标准基线后，故事工坊会话拥有 goal、plan-mode、workflow、jobs 等标准工具面。
- 守卫是运行时策略，不改变工具 schema；拒绝理由进入对话记录。

## 验收条件

产品行为与验收由 #11 拥有；本节只记这份设计怎么被验证。

- 名册与组合由宿主读出：`/api/dsh-storycraft/roster` 只能出现一个 `storycraft` 且 `broken` 为空；`/api/dsh-storycraft/document?id=storycraft` 与 `id=standard` 的行级比对见 `e2e/preset.spec.cjs`，任何部署都可执行。
- 守卫与动作断言在单元层验证：`tests/tools.test.mjs` 以 `delegationDepth: 1` 的 exec 检查 `write`/`edit`/`pwsh`/`bash` 被拒、读动作保留、`story_write` 返回 `subagent-cannot-land`。
- 标准基线在 DSH checkout 存在时由 `tests/presets.test.mjs` 做整行比对；checkout 缺失时由运行时 spec 兜底。
- 模型驱动的真实派发（子代理返回文本、主编落盘、作品目录不变）不在这份设计的自动化验证内，留待带模型的端到端验收。

## 风险

- 标准基线随 DSH 升级变化，需要一致性测试拦截漂移；
- 守卫依赖 `delegationDepth`；外部后端不共享该元数据，故事工坊只支持 spawn；
- 人设两用可能让主会话的「主编」姿态变弱，需要技能与验收兜底；
- 子代理被拒后可能重试或绕行，拒绝理由必须指明正确做法。
