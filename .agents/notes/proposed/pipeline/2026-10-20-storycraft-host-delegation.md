---
title: 故事工坊：宿主侧章节生产委派（主上下文不搬运正文）
status: proposed
created: 2026-10-20
updated: 2026-10-20
---

# Agent Note：故事工坊：宿主侧章节生产委派（主上下文不搬运正文）

## 问题

当前整章生产由主编编排：写手子代理把整章正文返回主编，主编再把它作为 `story_write` 的 `body` 传入；审稿/修订前，主编先调 `story_context` 取回含正文的 sections，再拼进子代理 prompt；修订稿又返回主编，再传给 `story_revise`。

同一条真实会话的测量：正文出现 7 次，含正文消息 12,240 字符；`subagent` prompt 10,123 字符；`story_context` 返回 15,021 字符；`story_write`/`story_revise` 的 body 参数 3,148 字符。主上下文被同一章正文与装配结果反复占用。

根因不是提示词，而是编排位置：writer/reviewer/reviser 的角色交接经过主编，正文与上下文没有由代码直接交给落盘层。

## 与既有记录的关系

本设计**部分反转**以下决定，并明确接受代价：

- `implemented/workspace/2026-10-19-storycraft-single-mode-delegation.md`：单预设、子代理继承组合、`delegationDepth > 0` 拒绝写工具与 `maxDepth: 1` 全部保留；改变的是**发起者**——由主编调用 `subagent` 改为宿主动作调用 `subagents` 服务。
- `implemented/pipeline/2026-10-18-storycraft-role-agents.md` 与 `implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md`：两份记录都曾以“绕开官方工具面与深度策略”否决私有派发动作。`story_delegate` 确实由宿主动作发起、不经过模型可见的 `subagent` 工具，这是对工具面的部分反转。保留的是：官方 `subagents` 服务、深度限制、模型选择、标准子会话记录、“子代理只返回文本、主编落盘”。
- 成本证据只有一条：`rejected/workspace/2026-10-18-storycraft-role-presets.md` 的风险行“全文回传的 token 成本高于单代理”。该记录否决的是角色预设，不是这个风险；它仍是既有记录里唯一写下的成本判断，且没有量化。本次测量补上了量化，因此重新打开该取舍。

## 提案

### 边界

新增一个模型可见动作 `story_delegate`，把单个角色的“预检 → 取上下文 → 启动子代理 → 校验输出 → 落盘 → 生成回执”收进宿主侧代码。主编只发角色与一句任务，只收紧凑回执，不接触正文与 `story_context` sections。

角色限定为 `writer`、`reviewer`、`reviser`。章纲与全书计划仍由主编调用 `story_plan` / `story_outline`，不经过本动作；已有正文的 `rewrite` 与已定稿章的 `reopen` 也仍走现有动作。

无问题审稿沿用现有契约：`reviewer` 返回空 items 时 `writeReview` 报 `empty-review`，不写审稿，也无法进入修订/定稿；这是 #18 之前就存在的阶段机限制，本项不修复。验证 fixture 必须含至少一个真实问题，clean chapter 的完成路径不在本项范围。

保留现有 27 个动作为底层原语：`story_write`、`story_review`、`story_revise` 仍是唯一落盘实现，`story_delegate` 只是宿主侧调用这些函数的编排层。不做整章全自动管线，阶段仍由 `story_next` 与主编判断。

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

`delegate` 只在 `story_delegate` 的预检会通过时出现：`missing` 含 `outline`、`plan-approval` 时不出现；`action: 'story_revise'` 且 `missing: ['revision']`（审稿条目已处理完、只缺提交修订，没有未处理条目）时也不出现，主编应走手动 `story_revise`（`mode` 用 `polish` / `rewrite` / `deslop`）或先重新审稿。缺全书计划或章纲确认时，`story_next` 仍返回 `action: 'story_outline'` / `'story_write'` 与 `missing`，主编应引导作者去面板确认，不调用 `story_delegate`。

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
3. 构造子代理 prompt：角色任务、章节定位、角色技能名（`storycraft-write-craft` / `storycraft-review` / `storycraft-revise-craft`）、输出契约、宿主装配的上下文；不包含主会话历史；
4. `subagents.startActivation({ provider: 'spawn', label: '故事工坊-写手', request: { parent: exec.agent, cwd, prompt: [{ type: 'text', text: prompt }] }, signal: exec.signal, delivery: 'caller' })`；子代理省略 `agentPreset`，加入父方故事工坊组合；
5. 等待 `activation.result`，读取 `stopReason`、`output` 中的 text blocks 与 `structured`；失败、取消、超时或 `stopReason !== 'completed'` 时不落库，`dispose()` 后返回 `delegation-failed`；
6. 输出校验：
   - writer：按 `storycraft-write-craft` 的 TITLE/CHAPTER 输出契约解析，正文非空、首尾完整；
   - reviser：按 `storycraft-revise-craft` 的 CHAPTER 输出契约解析，标题沿用现有章节标题；
   - reviewer：优先用 `request.outputSchema` 约束 `storycraft-review` 的 items 契约，读取 `structured`；provider 不支持结构化输出时回退解析 text JSON；
7. 落盘：
   - writer：`checkDraft` 白名单校验（自造人名阻断，地名/尺寸只告警）→ `writeChapter({ requirePlanApproval })`；
   - reviewer：把 `where` 映射为 `location`、`problem` 映射为 `problem`、`fix` 映射为 `suggestion` 后调 `writeReview`；`impact`、`severity`、`mode` 不落库（现有审稿表只存位置/问题/建议），也不进回执。`items` 为空时按现有契约返回 `empty-review`，不写审稿；
   - reviser：`checkDraft` → `reviseChapter({ problemIds: 全部未处理条目, mode })`；
8. 读取落库后的章节/审稿/状态，返回紧凑回执。

### 子代理与权限

子代理继承故事工坊组合与角色技能，仍受既有守卫约束：`delegationDepth > 0` 时 `write`、`edit`、`pwsh`、`bash` 与所有 `mutates` 动作（包括 `story_delegate` 自身）被拒绝；子代理只能读、加载技能、返回文本。落盘只发生在宿主侧。

### 错误与回退

- `delegation-unavailable`：没有 `subagents` 服务或 `spawn` provider；
- `delegation-failed`：启动失败、取消、超时、`stopReason !== 'completed'`；
- `delegation-output-invalid`：缺少首尾标记、正文为空、审稿 JSON 不合契约；不做自动重试；
- 现有业务错误码（`plan-not-approved`、`chapter-not-written`、`chapter-exists`、`chapter-settled`、`review-required`、`empty-review`、`bible-missing` 等）原样透传；`bible-missing` 可能来自角色上下文缺人物卡，行为与手动路径一致；
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
- `store-db.js` 的 `nextStep`：在 `action` 为 write/review/revise、`missing` 不含 `outline` / `plan-approval`，且 `story_revise` 不是 `missing: ['revision']` 时增加 `delegate` 字段；
- `delegate.js` 不导入 `tools.js`，避免循环；
- 新建 `landing.js`（或同级 landing 帮助模块）承载 `checkDraft` 等“读白名单并校验”的 IO 帮助函数；`consistency.js` 保持纯比较，不引入数据库读取；
- 角色输入读取抽到可复用函数，避免 `story_context` 与 `story_delegate` 各自维护一份正文/审稿加载逻辑；
- 新增模块加入 `package.json` 的 `files`。

### 人设、技能与文档同步

实现时同步更新：

- 人设（`cordis.patch.yml`）：writer/reviewer/reviser 阶段优先调用 `story_delegate`；手动 `story_context` + `subagent` 只作兜底；
- `storycraft-studio-orchestration` 与 `storycraft-longform-chapter`：派发/流程说明改为 `story_delegate`，保留手动回退；
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
- 真实模型跑 1 章，按工作项测量步骤记录主会话中该章工具调用与结果总字符数。

## 备选方案

- **整章全自动管线（writer→review→revise→settle 一次调用）**：主上下文最小，但把审稿与修订决策从作者/主编手里拿走，阶段与作者闸门都要重写；本项不做，留作后续独立工作项。
- **数据库暂存 + token 落盘**：宿主 `startActivation` 已经能把子代理结果直接交回代码，暂存层多余，且会重新引入 #18 已删除的 staging 语义（见 `implemented/pipeline/2026-10-19-storycraft-sqlite-store.md` 的“与既有记录”）；否决。
- **只让子代理自取上下文（仍由主编落盘）**：能砍掉主编拼接的 sections，但正文仍要回主会话一次；只能部分降本，不作为本项方案。
- **允许子代理直接调用 `story_write`**：主上下文最小，但绕过主编校验与落盘控制，重演已否决的“子代理落盘”风险；否决。
- **保持现状，只改提示词禁止贴正文**：最终回复可以不贴，但子代理交接、`story_context` 返回和 `story_write` 参数仍重复；不解决根因；否决。

## 验收条件

本设计证明：

1. writer/reviewer/reviser 三条路径都能由宿主启动子代理并落盘，主编只收紧凑回执；
2. 回执不含正文/上下文/prompt；
3. 预检、现有阶段闸门与业务错误码在宿主侧保持；
4. `subagents` 不可用或子代理失败时不会产生部分落库，手动路径仍可用；
5. 不新增持久化结构，现有动作与页面接口不受影响；
6. 有可复现的假服务测试覆盖成功、失败、取消与输出不合约。

## 风险

- 宿主 `subagents` 服务是可选能力，不同组合可能缺失；必须保留手动兜底；
- 子代理调用是长任务，工具超时、用户取消与子代理取消需要一起处理；
- 子代理输出是自然语言或结构化 JSON，解析与校验必须严格，否则坏稿会落库；
- `mode` 的幅度限制（如 `patch` 超过 20%）只能在拿到修订稿后判断，会返回现有 `revise-mode-violation`；主编可改用 `rewrite` 重试；
- 主上下文下降不等于总 token 下降：子代理自身仍消耗上下文；本设计只消除主会话的重复搬运；
- 宿主侧启动子代理涉及父 Agent 身份、权限与子会话生命周期，需要在实现阶段用真实运行时验证；
- 子代理会话仍会出现在会话目录，作者可能看到；不影响作品库隔离。





