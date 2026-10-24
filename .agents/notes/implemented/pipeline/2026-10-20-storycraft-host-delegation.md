---
title: 故事工坊：宿主侧章节生产委派（主上下文不搬运正文）
status: implemented
created: 2026-10-20
updated: 2026-10-20
verification: 宿主侧委派已落地，delegate 测试与真实单章链路通过；证据见 #19。
---

# Agent Note：故事工坊：宿主侧章节生产委派（主上下文不搬运正文）

> 2026-10-20 部分替代：`proposed/pipeline/2026-10-20-storycraft-production-parity.md` 把全局角色词/对白词硬判定与“自造人名阻断”改为 warning-only；本 Note 的一致性硬判定段落仅保留历史依据，验收归 #21。
>
> 2026-10-20 传输段部分替代：`proposed/pipeline/2026-10-20-storycraft-role-submission.md` 把“子代理最终文本作为角色结果”改为 `story_submit` + SubmissionStore；DSH subagent、宿主侧编排与 `subagent-cannot-land` 保留。
>
> 2026-10-20 reviser 校验再修正：委派 reviser 的 min/max、mode 与 3 次提交校验并入 #23 的 `story_submit`。本 Note 正文里的“低于 min 只警告”“主编 patch→polish→rewrite / 超 max 重试”由 #23 取代；委派失败由子代理在提交工具内自我修正，主编不重试、不手动搬运正文。
>
> 2026-10-21 角色枚举扩展：新增 `summarizer` 角色，角色枚举、预检与回执由 `proposed/pipeline/2026-10-21-storycraft-summary-transport.md` 扩展；本 Note 的“delegate 只在预检会通过时出现”、writer/reviewer/reviser 契约与 `subagent-cannot-land` 保留。

## 问题

当前整章生产由主编编排：写手子代理把整章正文返回主编，主编再把它作为 `story_write` 的 `body` 传入；审稿/修订前，主编先调 `story_context` 取回含正文的 sections，再拼进子代理 prompt；修订稿又返回主编，再传给 `story_revise`。

同一条真实会话的测量：正文出现 7 次，含正文消息 12,240 字符；`subagent` prompt 10,123 字符；`story_context` 返回 15,021 字符；`story_write`/`story_revise` 的 body 参数 3,148 字符。主上下文被同一章正文与装配结果反复占用。

根因不是提示词，而是编排位置：writer/reviewer/reviser 的角色交接经过主编，正文与上下文没有由代码直接交给落盘层。

2026-10-20 首章真实验证（《余音》，第 1 章）暴露了实现缺口：27 次工具调用、主会话约 50,412 字符；writer 只落 1,867 字（范围 3,000–4,000），reviser 连续遇到 `亮当面` 误报与 `patch`/`polish` 字数超限，最后回退手动 `story_context` + `story_revise`，正文再次进入主会话。本设计因此把一致性误报、writer 字数校验与 reviser 模式重试纳入验收前置。

## 与既有记录的关系

本设计**部分反转**以下决定，并明确接受代价：

- `implemented/workspace/2026-10-19-storycraft-single-mode-delegation.md`：单预设、子代理继承组合、`delegationDepth > 0` 拒绝写工具与 `maxDepth: 1` 全部保留；改变的是**发起者**——由主编调用 `subagent` 改为宿主动作调用 `subagents` 服务。
- `implemented/pipeline/2026-10-18-storycraft-role-agents.md` 与 `implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md`：两份记录都曾以“绕开官方工具面与深度策略”否决私有派发动作。`story_delegate` 确实由宿主动作发起、不经过模型可见的 `subagent` 工具，这是对工具面的部分反转。保留的是：官方 `subagents` 服务、深度限制、模型选择、标准子会话记录、“子代理只返回文本，宿主侧动作负责落盘”。
- 成本证据只有一条：`rejected/workspace/2026-10-18-storycraft-role-presets.md` 的风险行“全文回传的 token 成本高于单代理”。该记录否决的是角色预设，不是这个风险；它仍是既有记录里的一条成本判断，且没有量化；`single-mode-delegation` 与 fork 记录另有成本判断，不重复引用。本次测量补上了量化，因此重新打开该取舍。
- `implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md` 规定输入由只读动作交付、派发一律走 `story_context`、前置校验只在 `story_context`。本设计**部分改变**该决定：`story_delegate` 由宿主直接装配 writer/reviewer/reviser 输入并做宿主侧预检，不再走 `story_context`；手动派发仍沿用原契约。交付时更新该记录。
- `implemented/pipeline/2026-10-18-storycraft-quality-layer.md` 决定字数只作审稿提示、不做硬判定。本设计**部分改变**该决定：`story_delegate` 的 writer/reviser 硬校验 `[min,max]`；手动 `story_write` / `story_revise` 不新增校验。委派 reviser 的校验由 #23 的 `story_submit` 执行。交付时更新该记录。

## 决定

### 边界

新增一个模型可见动作 `story_delegate`，把单个角色的“预检 → 取上下文 → 启动子代理 → 校验输出 → 落盘 → 生成回执”收进宿主侧代码。主编只发角色与一句任务，只收紧凑回执，不接触正文与 `story_context` sections。

角色限定为 `writer`、`reviewer`、`reviser`。章纲与全书计划仍由主编调用 `story_plan` / `story_outline`，不经过本动作；已有正文的 `rewrite` 与已定稿章的 `reopen` 也仍走现有动作。

无问题审稿在本项原按 `empty-review` 处理；**#21 已部分替代该限制**：允许清稿审稿，`story_next` 不再强制修订，阶段机与 `foldState` 需同步。验证 fixture 仍可含问题，但 clean chapter 的完成路径归 #21。

保留现有 27 个动作为底层原语：`story_write`、`story_review`、`story_revise` 仍是唯一落盘实现，`story_delegate` 只是宿主侧调用这些函数的编排层。不做整章全自动管线，阶段仍由 `story_next` 与主编判断。

### 前置修复：一致性角色词误报（已由 #21 替代）

真实运行中，`extractSpeakerNames` 把角色词与对话片段当作人名，writer/reviser 因此被反复拒收：

- `住户`、`师傅`、`师父`、`齐师傅`、`齐监理` 是角色/称谓，不是人名；
- `亮当面` 是“亮 + 当面”被“字 + 说/道”规则切出的片段；
- `齐师傅`、`齐监理` 通过增加角色词可覆盖；`亮当面` 需要把 `当面` 等对话副词加入停用片段。

**该节是历史方案，不再按此扩词或硬判定；#21 已改为 warning-only。** 原方案先修 `facts.js` 的 `extractSpeakerNames`：

- 扩充 `ROLE_NOUNS`：`住户`、`保安`、`邻居`、`师傅`、`师父`、`监理`、`值班`、`路人`、`过路人`、`门里的人`；
- 增加对话片段停用词：`当面`、`开口`、`低声`、`轻声`、`沉声`、`半晌`、`顿了顿`；
- 加回归测试：上述片段在 `X说/问/道` 语境中不得判成人名；真实人名仍能识别。

原硬阻断已由 #21 替代；现在未登记人名只 warning，不阻断 writer/reviser。

### writer / reviser 字数校验

writer 与 reviser 的正文在 `landing.js` 的 `checkWordRange` 中、`checkDraft` 之后、落盘之前用 `countWords` 对照 `manifest.wordRange`：

- 未设范围 → 不校验；
- writer：字数不在 `[min, max]` → 返回 `delegation-word-range`，不落库；
- reviser：只对 `字数 > max` 硬拒绝 `delegation-word-range`；低于 `min` 只写入 `warnings`，不阻断；
- writer 超界：由 #23 的 `story_submit` 在提交时硬拒绝，子代理带差额/目标修正后重提；章纲本身撑不住时，主编再改章纲并请作者重新确认；不自动改范围；动作不代签；
- reviser 超过 max：由 #23 的 `story_submit` 在提交时硬拒绝，子代理在最多 3 次提交内修正；`deslop` 不自动改 mode；字数与 mode 校验都在提交时完成；
- reviser 低于 min：由 #23 的 `story_submit` 硬拒绝，子代理可在 3 次内修正；主编不重试；
- 手动 `story_write` / `story_revise` 仍不硬判定，保持“字数只作审稿提示”；

### 动作契约

```
story_delegate(
  work: string,
  chapter: integer,
  role: 'writer' | 'reviewer' | 'reviser',
  instruction?: string,
  mode?: 'patch' | 'polish' | 'rewrite' | 'deslop',   // 仅 reviser，缺省 patch
)
```

成功回执（不含正文、sections、prompt）：

```
{
  ok: true,
  workId, chapter, role, stage,
  revision?, words?,
  reviewRound?, problems?: { total, open },
  resolved?: string[],
  warnings?: string[],
}
```

单次回执序列化上限 1,500 字符；不含 `next`，主编按需调 `story_next`。`warnings` 最多 5 条、每条 120 字符，超出截断并标记。

### 导向：story_next 的 delegate 字段

`story_next` 增加可选 `delegate: { role: 'writer' | 'reviewer' | 'reviser' }`：`action` 为 `story_write` / `story_review` / `story_revise` 且该阶段可执行时给出对应角色，`action` 本身保留，作为手动路径的稳定接口。主编按 `delegate.role` 调用 `story_delegate`，不再自行把 primitives 翻译成委派。

`delegate` 只在 `story_delegate` 的预检会通过时出现：`missing` 含 `outline` 或 `blocked` 非空时不出现（`blocked` 的审批语义由 [`2026-10-24-storycraft-chapter-identity-approval.md`](2026-10-24-storycraft-chapter-identity-approval.md) 拥有）；`action: 'story_revise'` 且 `missing: ['revision']`（审稿条目已处理完、只缺提交修订，没有未处理条目）时也不出现，主编应走手动 `story_revise`（`mode` 用 `polish` / `rewrite` / `deslop`）或先重新审稿。缺全书计划或章纲确认时，`story_next` 仍返回 `action: 'story_outline'` / `'story_write'` 与 `missing`/`blocked`，主编应引导作者去面板确认，不调用 `story_delegate`。

`story_next` 使用独立的输出契约（在共享 `OUTPUT` 基础上增加可选 `delegate`）；其他动作继续使用原共享 `OUTPUT`，不会因为该字段而要求所有动作声明它。`story_next` 的参数与业务错误码不变。

### 预检与落盘

在启动子代理前完成阶段预检，避免生成整章后才失败：

- writer：作品/章存在；章纲存在；`planApproval=required` 时章纲已确认；章节未定稿；当前无正文（已有正文返回 `chapter-exists`）。通过后由宿主调 `writeChapter`；
- reviewer：作品/章存在；当前章有正文（否则 `chapter-not-written`）；章节未定稿；通过后由宿主调 `writeReview`；
- reviser：作品/章存在；有正文（否则 `chapter-not-written`）；未定稿；有最新审稿、存在未处理条目，且审稿覆盖当前版本（`patch` 要求同一版本，其他模式允许上一版；否则 `review-required`）；通过后由宿主调 `reviseChapter`。

预检复用 `readManifest`、章节表与最新审稿读取；阶段错误沿用现有业务码，不新增同义码。

### 宿主侧流程

`story_delegate` 注册在 `tools.js` 的预设作用域，运行时通过 `ctx.get('subagents')` 取服务；不把 `subagents` 设为硬依赖，缺失时返回 `delegation-unavailable`。

1. 校验参数，执行上述预检；
2. 在宿主侧装配上下文：
   - writer 用 `assembleRoleContext({ role: 'writer' })`，不需要正文；
   - reviewer/reviser 由宿主读取当前正文与最新审稿，装配含正文、章纲与未处理条目的上下文；
3. 构造子代理 prompt：角色任务、章节定位、角色技能名（`storycraft-write-craft` / `storycraft-review` / `storycraft-revise-craft`）、输出契约、宿主装配的上下文；reviser 的 prompt 按 mode 区分：`patch`/`polish` 只改点名位置并保留未点名段落，`rewrite` 可重组但保留事实与章纲，`deslop` 只治腔调；不包含主会话历史；
4. `subagents.startActivation({ provider: 'spawn', label: '故事工坊-写手', request: { parent: exec.agent, cwd, prompt: [{ type: 'text', text: prompt }] }, signal: exec.signal, delivery: 'caller' })`；子代理省略 `agentPreset`，加入父方故事工坊组合；
5. 等待 `activation.result`，读取 `stopReason`、`output` 中的 text blocks 与 `structured`；失败、取消、超时或 `stopReason !== 'completed'` 时不落库，`dispose()` 后返回 `delegation-failed`；
6. 输出校验：
   - writer：按 `storycraft-write-craft` 的 TITLE/CHAPTER 输出契约解析，正文非空、首尾完整；
   - reviser：按 `storycraft-revise-craft` 的 CHAPTER 输出契约解析；
   - reviewer：优先用 `request.outputSchema` 约束 `storycraft-review` 的 items 契约，读取 `structured`；provider 不支持结构化输出时回退解析 text JSON；
7. 落盘：
   - writer：`checkDraft` 白名单校验；未登记人名按 #21 只 warning 不阻断（本 Note 原“自造人名阻断”已被替代），地名/尺寸告警 → `countWords` 对照作品字数范围（超界返回 `delegation-word-range`）→ `writeChapter({ requirePlanApproval })`；
   - reviewer：把 `where` 映射为 `location`、`problem` 映射为 `problem`、`fix` 映射为 `suggestion` 后调 `writeReview`；`impact`、`severity`、`mode` 不落库（现有审稿表只存位置/问题/建议），也不进回执。`items` 为空时按 #21 的清稿审稿契约落一轮“无问题”审稿，不再返回 `empty-review`；
   - reviser：`checkDraft` → #23 的 `story_submit` 对照 min/max 与 mode（失败不落盘，子代理最多 3 次）→ `reviseChapter({ problemIds: 全部未处理条目, mode })`；
8. 读取落库后的章节/审稿/状态，返回紧凑回执。

### 子代理与权限

子代理继承故事工坊组合与角色技能，仍受既有守卫约束：`delegationDepth > 0` 时 `write`、`edit`、`pwsh`、`bash` 与所有 `mutates` 动作（包括 `story_delegate` 自身）被拒绝；子代理只能读、加载技能、返回文本。落盘只发生在宿主侧。

### 错误与回退

- `delegation-unavailable`：没有 `subagents` 服务或 `spawn` provider；
- `delegation-failed`：启动失败、取消、超时、`stopReason !== 'completed'`；
- `delegation-output-invalid`：缺少首尾标记、正文为空、审稿 JSON 不合契约；不做自动重试；
- `delegation-word-range`：writer/reviser 超 min/max；不落库。错误消息给出实际字数、范围。校验失败由 #23 的 `story_submit` 回给子代理，子代理在最多 3 次提交内自我修正；主编不重试、不换 mode、不手动搬运正文；
- 现有业务错误码（`plan-not-approved`、`chapter-not-written`、`chapter-exists`、`chapter-settled`、`review-required`、`revise-mode-violation`、`bible-missing` 等）原样透传；`bible-missing` 可能来自角色上下文缺人物卡，行为与手动路径一致；
- reviser 的 `revise-mode-violation` 由 #23 的 `story_submit` 回给子代理；子代理在最多 3 次提交内修正；主编不重试、不自动换 mode；
- 失败时现有手动路径仍可用：主编可调 `story_context` + 官方 `subagent` + `story_write`，或直接调用底层动作；`story_delegate` 不自动回退，以免再次把正文带回主上下文。

### 生命周期、取消与超时

- 不声明工具级 `timeoutMs`；宿主在等待子代理时用内部 10 分钟计时器与 `exec.signal` 竞速，结果返回后清除计时器再落库，避免落库提交后又被工具超时改写成失败；
- `exec.signal` 只保证取消发布前已开始的动作，不能直接取消已发布的子代理；
- 发布后宿主在 `result` 与内部计时器/abort 之间竞速；任一后者胜出时 `dispose()` 并返回 `delegation-failed`；
- 落库前检查 abort；落库是同步事务；重试时 writer 会得到 `chapter-exists`，reviser 会得到过期审稿错误，不会静默覆盖；
- 无论成功、失败还是取消，都在 `finally` 中 `dispose()` 释放 activation；`dispose()` 失败只记录，不覆盖已落库的回执；
- 不声明 `isConcurrencySafe`：工具运行时按独占调度执行，同一时刻只有一个 delegate 动作；数据库事务只是第二道保护。

### 模块边界

- 新模块 `delegate.js`：角色预检、prompt 构造、activation 调用、输出解析、落盘编排与回执；
- `tools.js`：注册 `story_delegate` 并为它定义独立 `DELEGATE_OUTPUT` 回执 schema（成功字段 + 共享 `error` 信封）；同时为 `story_next` 增加独立 `NEXT_OUTPUT`（共享 `OUTPUT` + 可选 `delegate`）；其他动作仍用共享 `OUTPUT`；
- `store-db.js` 的 `nextStep`：在 `action` 为 write/review/revise、`missing` 不含 `outline`、`blocked` 为空，且 `story_revise` 不是 `missing: ['revision']` 时增加 `delegate` 字段；
- `delegate.js` 不导入 `tools.js`，避免循环；
- 新建 `landing.js`（或同级 landing 帮助模块）承载 `checkDraft` 与 `checkWordRange` 等“读白名单/作品范围并校验”的 IO 帮助函数；`delegate.js` 的 writer/reviser 共用；`consistency.js` 保持纯比较；
- 角色输入读取抽到可复用函数，避免 `story_context` 与 `story_delegate` 各自维护一份正文/审稿加载逻辑；
- 新增模块加入 `package.json` 的 `files`。

### 人设、技能与文档同步

实现时同步更新：

- 人设（`cordis.patch.yml`）：writer/reviewer/reviser 阶段优先调用 `story_delegate`；手动 `story_context` + `subagent` 只作兜底；委派字数/mode 校验由 #23 的 `story_submit` 处理，子代理最多 3 次提交；主编不重试、不换 mode、不手动搬运正文；
- `storycraft-studio-orchestration` 与 `storycraft-longform-chapter`：派发/流程说明改为 `story_delegate`，保留手动回退，并写入 reviser/字数重试规则；`storycraft-write-craft` 与长度预算参考说明“章纲撑不住时先改章纲，不靠注水”；
- `implemented/pipeline/2026-10-18-storycraft-role-agents.md` 与 `implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md`：交付时补 partial replacement 链接，说明 delegate 由宿主装配/预检，手动路径仍保留原契约；
- `facts.js`：修正 `extractSpeakerNames` 的角色词与对话片段误报，`consistency` 测试覆盖；同步 `implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md` 的误报防线；`implemented/pipeline/2026-10-18-storycraft-quality-layer.md` 记录 delegate 路径的字数硬校验；
- `client.js` 的固定指令文案（`flowFull`、`flowToRevision`、`nextChapter`、`step`、`review`、`revise`、`planApproved`）：优先按 `story_next.delegate` 调 `story_delegate`；没有 `delegate` 时才回到对应 primitive。面板布局与按钮不改变；
- `storycraft/README.md`：动作数从 27 改为 28，补充 `story_delegate` 的职责、`story_next.delegate` 与回退；
- `index.js` 的 `/api/dsh-storycraft/next`：响应透传新增的 `delegate` 字段，路由参数与错误不变；
- `tests/tools.test.mjs`：动作数断言 28，`story_next` 的独立输出契约，新增假 `subagents` fixture；
- 路线图登记本阶段，不另建路线图。

### 兼容与数据

- 不新增数据库表、staging 文件或 TTL；不改变现有表结构；
- 不改现有动作的名称、参数与业务错误码；除 `story_next` 增加可选 `delegate` 输出字段外，现有动作的返回契约不变；
- 实现时同步更新 `tests/tools.test.mjs` 的动作数（27→28）、输出 schema 断言，并加入假 `subagents` fixture；
- 需要当前 DSH 版本提供 `subagents` 服务、`delivery: 'caller'` 与 text/structured result；旧版本直接报 `delegation-unavailable`。

### 验证切入点

- 假 `subagents` 服务返回 writer/reviewer/reviser 输出，断言落库版本、审稿轮次、条目关单与回执字段；
- 断言回执不含 `body` / `sections` / `prompt`，序列化 ≤1,500 字符；
- 预检错误、服务缺失、取消/超时、输出不合约、reviewer 空条目；
- writer/reviser 超 min/max 由 #23 的 `story_submit` 拒绝且不落库；
- `extractSpeakerNames` 对角色词与对话片段不判人名；
- 脚本化流程复现一次 `submit-mode-violation`/`submit-word-range`，子代理在同一运行内修正并成功；覆盖 3 次上限与 `deslop` 不改 mode；
- 真实模型在全新单章 fixture 跑完，clean delegate 路径主会话工具参数+结果 ≤4,000；允许一次恢复 episode（writer 或 reviser），episode 内 `story_brief`/`story_plan`/作者确认/全部重试合计 ≤10,000（容纳 story_brief 的 8,192 字节上限），单独记录；超过一次 episode 或手动正文回退判失败；窗口前预加载技能，窗口内 `skill` 不计。

## 备选方案

- **整章全自动管线（writer→review→revise→settle 一次调用）**：主上下文最小，但把审稿与修订决策从作者/主编手里拿走，阶段与作者闸门都要重写；本项不做，留作后续独立工作项。
- **数据库暂存 + token 落盘**：宿主 `startActivation` 已经能把子代理结果直接交回代码，暂存层多余，且会重新引入 #18 已删除的 staging 语义（见 `implemented/pipeline/2026-10-19-storycraft-sqlite-store.md` 的“与既有记录”）；否决。
- **只让子代理自取上下文（仍由主编落盘）**：能砍掉主编拼接的 sections，但正文仍要回主会话一次；只能部分降本，不作为本项方案。
- **允许子代理直接调用 `story_write`**：主上下文最小，但绕过主编校验与落盘控制，重演已否决的“子代理落盘”风险；否决。
- **保持现状，只改提示词禁止贴正文**：最终回复可以不贴，但子代理交接、`story_context` 返回和 `story_write` 参数仍重复；不解决根因；否决。

## 后果

该设计已按决定落地；生产与消费路径已切换，旧路径不再写入，未保留旧作品迁移或兼容层。

## 验证

本设计证明：

1. writer/reviewer/reviser 三条路径都能由宿主启动子代理并落盘，主编只收紧凑回执；writer 字数在作品范围内；reviser 在 patch/polish/rewrite 中至少一次成功，不触发手动回退；
2. 回执不含正文/上下文/prompt；
3. 预检、现有阶段闸门与业务错误码在宿主侧保持；
4. `subagents` 不可用或子代理失败时不会产生部分落库，手动路径仍可用；
5. 不新增持久化结构，现有动作与页面接口不受影响；
6. 有可复现的假服务测试覆盖成功、失败、取消与输出不合约；
7. `extractSpeakerNames` 回归测试覆盖 `住户`、`师傅`、`师父`、`齐师傅`、`齐监理`、`亮当面` 不判人名；
8. writer/reviser 超 min/max 由 `story_submit` 拒绝且不落库；失败由子代理在同一运行内修正，最多 3 次；主编不重试、不换 mode；
9. 全新单章 fixture 的 clean delegate 路径（到修订完成）主会话工具参数+结果 ≤4,000；允许一次恢复 episode，episode 内 `story_brief`/`story_plan`/作者确认/全部重试合计 ≤10,000，单独记录，不并入 clean 值；超过一次 episode 或发生手动正文回退判失败。

## 风险

- 宿主 `subagents` 服务是可选能力，不同组合可能缺失；必须保留手动兜底；
- 子代理调用是长任务，工具超时、用户取消与子代理取消需要一起处理；
- 子代理输出是自然语言或结构化 JSON，解析与校验必须严格，否则坏稿会落库；
- `mode` 的幅度限制（如 `patch` 超过 20%）在 #23 的 `story_submit` 内判断并回给子代理；子代理最多 3 次提交修正，主编不重试、不换 mode；
- 一致性角色词硬判定已由 #21 以 warning 替代；不再补词，也不再因误报阻断正文；
- reviser 重试由主编按规则发起，属于模型行为；若真实旅程未触发模式失败，retry ladder 只由脚本化测试覆盖，不宣称真实旅程已验证；若未执行而直接手动回退，验收测量判失败；
- 主上下文下降不等于总 token 下降：子代理自身仍消耗上下文；本设计只消除主会话的重复搬运；
- 宿主侧启动子代理涉及父 Agent 身份、权限与子会话生命周期，需要在实现阶段用真实运行时验证；
- 子代理会话仍会出现在会话目录，作者可能看到；不影响作品库隔离。






