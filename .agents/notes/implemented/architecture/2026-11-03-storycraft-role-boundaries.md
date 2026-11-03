# Agent Note: 故事工坊：角色边界（R2）

Status: implemented

工作项：当前任务（不新建 GitHub issue）。writer / planner / reviewer / reviser / summarizer 五个委托角色、settler 与 validator 的提示词、提交合同、输入契约与入账已从三个 monolith 搬回角色模块，并抽出共享 runtime；行为与失败语义保持不变。

## Problem

R0 已定目标结构 `roles/<role>/{agent,prompts,tool-schema,contract}.ts` 与 `runtime/`，R1a 只落了 architect 一个角色。当前其余角色的职责仍散在四处：

| 位置 | 承载 | 规模 |
|---|---|---|
| `storycraft/src/delegate.ts` | 六个角色的 prompt 内联在 `promptFor` 的 if 链（244-297）；入账/回执内联在 `delegateRole` 的分支（planner 904、writer 931、reviewer 962、summarizer 1035、reviser 1055）；reviewer 还有一段引文重试特例（969-1014） | 49 KB |
| `storycraft/src/submission.ts` | 全部角色的 payload 校验集中在一个 `validateSubmissionShape`（191-330） | 24.5 KB |
| `storycraft/src/role-input.ts` | 每个角色要读什么、哪些前置错误（chapter-not-written、polish-noop、review-required、planner 任务文本） | 6.1 KB |
| `storycraft/src/state-settle.ts` | settler 的 prompt（284-323）、schema 校验、重试与入账 | 25 KB |

结果是同一个角色的信息要改三四个文件，`delegate.ts` 对每角色各长一段（divergent change），R3 又不负责 `delegate.ts`。R0b 把其中 8 篇标为 `rework-required`：role-agents、role-input-contracts、host-delegation、role-submission、form-aware-delegation、planner-delegation、role-model-parity、longform-method-references。

### 范围

- 六个 delegate 角色的 prompt / 提交 schema / 输入契约 / 入账迁入角色模块；
- 抽出 `runtime/child-run.ts`、`runtime/delegate-runner.ts`、`runtime/role-input.ts`、`runtime/prompt-kit.ts`，`submission.ts` 归入 `runtime/`；
- 角色注册表成为「角色名 → 模块」的唯一来源；
- 不改阶段机、动作名、错误码集合、payload 字段、提示词实质内容与落盘语义。

不做的：不确定性检查库（parity-matrix 的「确定性检查库」差距，另立）；不统一失败码分类（另立）；不拆 `store-db.ts`/`tools.ts`/`context.ts`/`client.ts`（R3）；不做 S/D。

## 对拍参考

- `inkos-master/packages/core/src/agents/`：`planner.ts` + `planner-prompts.ts` + `planner-tool.ts`；`writer.ts` + `writer-prompts.ts` + `writer-tool.ts`；`reviser.ts` + `reviser-tool.ts`；`continuity.ts` + `review-tool.ts`；`settler-tool.ts` + `settler-prompts.ts` + `state-validator.ts`；`base.ts` 是共享的 agent/turn 基类。
- `planner-tool.ts`（`ChapterMemoToolSchema: goal/body/threadRefs`）与 `writer-tool.ts`（`ChapterDraftToolSchema: title/content`）：`*-tool.ts` 只放可提交字段。
- `planner-prompts.ts` / `writer-prompts.ts` / `settler-prompts.ts`：提示词是纯构建函数，输入是书配置、规则、风格、长度。
- `planner.ts:47-70`：agent 负责上下文选择、prompt 组装、typed submit 与可读投影落盘；结构化状态落 runtime。
- 我们的映射与偏差：

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| 每角色一个 typed tool | 统一 `story_submit` + 角色 payload 校验模块 | R0 已裁决保留 DSH 的 submit/subagent 机制 | 采纳（等价适配） | schema 测试 |
| `BaseAgent` 内含 LLM 循环与工具调用 | subagent child + 宿主 runner；角色模块不持有循环 | 不复制 provider/loop | 采纳（等价适配） | runner 测试 |
| `composer` 选上下文 | `assembleRoleContext` + 每角色 input 契约；选择逻辑留 R3 | R3 收敛 composer | 部分（input 归角色，选择留 R3） | context 测试 |
| 角色 agent 落可读投影 | 角色 `agent.ts` 落 artifact + 回执字段；trace/telemetry 在 runner | 可读投影是角色产物，trace 是运行时诊断 | 采纳 | delegate 测试 |
| settler 的落盘在 state reducer | 我们的状态投影是 `story_settle`/`story_state` 共享路径，settler 只出 prompt/schema/contract | 一份投影两个入口，搬进角色会造双入口 | 等价适配（登记不对称） | settle 测试 |
| R0 目标结构只列 `runtime/{delegate-runner,submission}` | 增加 `runtime/{child-run,role-input,prompt-kit}` | `runChild` 有两个消费者（delegate 与 settle/state-check），通用装载与共享提示骨架都不属于某一个角色 | 等价适配（名称按 DSH 适配） | import 与结构测试 |

## Decision

### 1. 目标结构

```text
storycraft/src/
  runtime/
    child-run.ts        # runChild、可用性判断、abort/delay、child 类型
    delegate-runner.ts  # delegateRole：门禁 → 输入 → prompt → child → consume → land → 回执
    role-input.ts       # 通用装载器：manifest/entry、共享 helpers、分发到角色 input 契约
    prompt-kit.ts       # 共享提示词骨架：WORKER_POLICY、技能行、上下文块、submit 尾
    submission.ts       # 由 src/submission.ts 迁入；transport、attempts、bytes、phase 生命周期
  roles/
    registry.ts         # 角色名 → { contract, prompts, schema, agent }；枚举与标签唯一来源
    architect/...       # 既有四件套；补 tool-schema 的 validate，agent 仍为 barrel
    planner/{agent,contract,prompts,tool-schema}.ts
    writer/{...}
    reviewer/{...}
    reviser/{...}
    summarizer/{...}
    settler/{agent,contract,prompts,tool-schema}.ts   # agent 为 barrel，入账留在共享投影
```

`runtime/prompt-kit.ts` 与 `runtime/role-input.ts` 是对 R0 目标结构的 DSH 适配（R0 只列了 `delegate-runner`/`submission`）；理由见偏差表与备选。

### 2. 角色模块职责

| 文件 | 只放 | 不放 |
|---|---|---|
| `contract.ts` | 角色名、标签、`nextAction`、是否要章、`task(form, chapter)` 文本、scope、输入门禁（body/review/deslop 前置）、`traceAfterLand` | prompt 正文、字段校验、落盘 |
| `prompts.ts` | 本角色的任务段、输出契约段、角色规则；用 `prompt-kit` 拼共享块 | 共享执行规约、上下文装配、技能方法正文 |
| `tool-schema.ts` | 本角色 payload 的键与校验（含 store 相关检查，如 reviser 的 revision mode）；`validate(payload, ctx): string \| undefined` | transport、attempts、字节数 |
| `agent.ts` | `land(input): Promise<RoleLanding>`：payload → store 落盘 → 角色专属回执字段；可选 `landRetry(error, input)` 声明角色专属重试；architect/settler 为 barrel | child 生命周期、telemetry、trace |

角色模块是**薄契约**：prompts 只写本节点任务与提交字段，创作方法仍由 `skill-routing` 选中的技能与 references 提供，不复制进代码。

`RoleLanding` 只带角色字段（artifact、words、revision、problems、planApproved、summaryChars、resolved、reviewRound 等）；runner 负责基础回执（duration/usage/retries/ok/workId/chapter/role/stage/submissionAttempts）与 `fitReceipt`。

### 3. 输入契约

`roles/<role>/contract.ts` 持「这个角色读什么」，`runtime/role-input.ts` 只做通用装配：

- 共享 helpers（`readBodyOrChapterNotWritten`、`readOpenReview`、`polishFirst`）留在 runtime，角色契约调用它们；
- planner：允许无章号（作品级 scope）、任务文本「全书计划 / 第 N 章章纲」、不读正文；
- writer：不读正文、不读审稿清单；
- reviewer / summarizer：读正文；reviewer 还读最新 review；
- reviser：读正文 + 未处理 review；`deslop` 先跑确定性润色规则，无改动抛 `polish-noop`，无未处理条目抛 `review-required`；
- 错误码与文案保持现状：`chapter-required`、`chapter-not-found`、`chapter-not-written`、`polish-noop`、`review-required`。

依赖方向：`runtime/{role-input-kit,child-run,submission}` 是叶子模块（不 import registry/角色）；`registry → 角色模块 → domain/storage/skill-routing`；`runtime/{delegate-runner,role-input}` 依赖 registry 与叶子模块。角色契约**不 import** `runtime/role-input.ts`（否则经 registry 成环）；共享 helpers（`readBody`、`readOpenReview`、`polishFirst`）放在叶子 `runtime/role-input-kit.ts`，角色 `loadInput(deps)` 只组合与判门禁。

### 4. runner 与角色重试

`delegate-runner.ts`：

1. 角色 → 契约（`nextAction`、标签）；`not-next-action`/`revision-limit` 门禁不变；
2. `loadRoleInput`（通用装载器 + 角色契约）；
3. reviewer 的机械检查仍并入任务文本（`withMechanicalFindings`）；
4. 非 planner 先写 trace；planner 在 land 之后写；
5. `prompts.build` 出提示词；`openSubmission` → `runChild` → `consumeSubmission`；
6. `agent.land`；成功则完成调用记录、拼基础回执；land 抛错时结束调用记录并原样抛；
7. land 失败且角色提供 `landRetry`（reviewer 引文被拒）：再开一次 submission、把角色的修正说明拼进提示词、跑一次 child、再 land；仍失败按现有错误抛出。重试上限仍是一次。

settler 走自己的 `state-settle.ts`，只 import `roles/settler/{contract,prompts,tool-schema}`；两次 attempt、validator 复核与 unresolved 语义不变。

### 5. 迁移切片与退出条件

| 切片 | 内容 | 完成标志 |
|---|---|---|
| S0 | 建 `runtime/{child-run,delegate-runner,role-input,prompt-kit}.ts` 与 `roles/registry.ts`；architect 纳入 registry；architect 的 payload 校验从 `submission.ts` 的 architect 分支搬进 `roles/architect/tool-schema.ts` | 既有测试全绿，行为无变化 |
| S1 | planner 四件套 | delegate/submission/role-input 的 planner 分支删除 |
| S2 | writer | 同上 |
| S3 | reviewer（含 `landRetry`） | 引文重试移出 runner，`reviewer-retry` 测试仍绿 |
| S4 | reviser | `polish-noop`/`review-required` 归 reviser 契约 |
| S5 | summarizer | 同上 |
| S6 | settler（prompts/tool-schema/contract；agent barrel） | `state-settle.ts` 不再含 prompt 与 payload 校验 |
| S7 | 删 `src/delegate.ts`，更新 11 处 import；`src/submission.ts` 迁 `runtime/submission.ts` 并更新 13 处 import；`state-check.ts`/`state-settle.ts` 改从 `runtime/child-run.ts` 取 `runChild`；registry 收口；文档与状态更新 | `grep delegate.ts` 零命中；CI 全绿 |

退出条件：**不存在第二条派发路径**——`delegate.ts` 被删除而不是保留兼容 shim；每个切片自带测试迁移，任一时刻只保留一种实现。

### 6. 测试

- 新增 `tests/role-boundaries.test.mjs`：registry 覆盖 delegate 角色 + architect + settler；每角色四件套导出齐全；`nextAction`/标签唯一；prompt 含 payload 键与技能行；schema 接受合法、拒绝非法（与既有 submission 期望一致）；registry 的 `nextAction` 与 store-db 的 `story_next` 动作名一致。
- 结构检查（评审时跑，不进 CI）：`grep -n "role ===" storycraft/src/runtime/delegate-runner.ts` 为空；`grep -rn "from './delegate.ts'\|from '../src/delegate.ts'" storycraft` 为空。
- 迁移既有用例的 import（`delegate.test`、`retry-budget`、`skills`、`model-calls`、`worker-policy`、`submission`、`reviewer-retry`、`foundation-*`、`state-settle`、`state-check`）。
- 行为回归靠既有 95 个单元文件：`not-next-action`、`chapter-not-written`、`polish-noop`、`review-required`、字数超界、引文重试、summary ifAbsent、settle unresolved 都必须原样通过。
- E2E 49 条不变（动作名、面板、story_submit 行为不变）。

### 7. 文档与状态

- `storycraft/README.md` 的角色/动作表只改路径引用（如有）；
- roadmap 加 R2 行；parity-matrix 的角色表在**实现后**按角色更新状态（本项只登记计划）；
- R0b 的 8 篇 `rework-required` 在本项实现后按「部分取代 / 保留互链」处理，不批量归档。

## 与既有决定

- [对拍基线重审](../../rejected/architecture/2026-11-02-storycraft-parity-rebaseline.md) 的 R2 目标与目标结构由本项承接。
- [R1a 多阶段提交](2026-11-02-storycraft-architect-multistage-runtime.md) 的 `roles/architect` 模板被复制到其余角色；architect 的行为不变。
- [role 输入契约](2026-10-19-storycraft-role-input-contracts.md)、[host 委派](2026-10-20-storycraft-host-delegation.md)、[role-submission](2026-10-20-storycraft-role-submission.md) 等由本项**部分取代**（实施后加横幅互链），本项不改它们的已交付结论。

## Alternatives considered

**A. 每个角色一个工作项（6 次门禁）。** 最强理由是审查粒度细、失败隔离。否决原因：同一机械模式重复六遍，过渡期双入口拖得更久；切片已能逐片复看，门禁不增加质量。

**B. 只搬 prompt，schema/landing 留在原处。** 最强理由是风险最小。否决原因：`delegate.ts` 仍是每角色一段 landing 的 divergent change，R3 不覆盖它；角色边界只做了一半。

**C. 保留 `delegate.ts` 作为转出 shim。** 最强理由是 import 不用改、并行分支不冲突。否决原因：shim 就是第二条派发入口，与「退出条件」冲突；本项目没有外部消费者，11 处 import 一次改完即可。

**D. 每个角色自带 child 循环（复制 `BaseAgent`）。** 最强理由是贴近参考结构。否决原因：复制 subagent 生命周期会得到六套超时/重试/telemetry，违背「方法共享、薄契约」；参考的循环由 `base.ts` 共享，我们对应的是 `runtime/child-run.ts`。

**E. 把 settler 的落盘也搬进 `roles/settler/agent.ts`。** 最强理由是四件套齐全、名称统一。否决原因：状态投影是 `story_settle` 与手动 `story_state` 的共享路径，搬进角色会造出第二个入口；settler 的 `agent.ts` 保持 barrel 并登记不对称。

**F. 把 role-input 的门禁留到 R3 的 composer。** 最强理由是减少本项范围。否决原因：R0b 已把 `role-input-contracts` 归入 R2；输入门禁（polish-noop、review-required）是角色契约而不是上下文选择。

## Testing

- `node storycraft/scripts/ci.mjs`：96 单元 + 49 E2E 通过（新增 `role-boundaries.test.mjs`）；
- `role-boundaries.test.mjs`：旧 monolith 消失、runtime 叶子模块存在、registry 覆盖八个角色、每角色合同齐全、delegate 动作与标签唯一、每个章节角色自带 prompt 行、schema 接受/拒绝、runner 无按角色分支、settle/check 从 `runtime/child-run.ts` 取 `runChild`；
- 既有回归：`delegate`、`reviewer-retry`（一次引文重试）、`review-stale`、`observations`、`state-settle`（unresolved 语义）、`state-check`、`skills`、`worker-policy`、`model-calls`、`retry-budget`、`foundation-*`、`submission`、`tools`、`acceptance-multichapter` 全部原样通过；
- `npm run verify-notes` 通过；安装形态由 `npm pack` + `plugin_manager install_bundle` 验证。

## 实施与偏差

- 七个角色落成：五个委托章节角色四件套齐全；settler 与 validator 的 `agent.ts` 是 barrel（入账分别留在 `state-settle.ts`/`state-check.ts` 的共享投影路径）——与「角色独占落盘才进 agent」的规则一致；
- 共享 helpers 放在叶子 `runtime/role-input-kit.ts`，而不是由装载器注入（同样避免 registry 环，且可直接单测）；
- AC1 的「无按角色分支」指章节角色 ladder；architect 的 foundation 是独立 pipeline（foundation bundle，而非章节 runner），仍由 runner 顶部显式分派到 `delegateArchitect`，并在 `role-boundaries` 中作为唯一例外列出；
- AC5 的「payload 校验只在 tool-schema」指形状校验；consume 阶段还需要按 entry 校验字数区间、摘要长度与 revision mode，这些依赖绑定状态，留在 `runtime/submission.ts`，行为与错误码不变；
- 先用 `git mv` 把 `delegate.ts`/`submission.ts`/`role-input.ts` 移入 `runtime/`，再逐角色迁移；退出条件仍是旧 monolith 不存在、无兼容 shim；
- `ROLE_META` 与 `story_delegate` 的 role 枚举由 registry 派生；registry 的 `nextAction` 镜像 `story_next` 动作名，由 `role-boundaries` 测试锁定；
- validator 在规划里只被当作「不搬落盘」的旁支，实现时把它的 prompt 与 schema 也搬入模块，否则 `submission.ts` 仍会残留角色分支。

## Consequences

- 角色信息从四个文件收敛为一个模块；新增角色或改提交字段只动角色目录与 registry；
- `delegate.ts`/`submission.ts`/`role-input.ts` 的 import 路径整体迁移，历史 import 失效，没有兼容层；
- `runtime/role-input-kit.ts` 与 `prompt-kit` 承担共享逻辑，角色方法正文仍只在技能/references；
- settler/validator 的 `agent.ts` 是 barrel，与五个章节角色的「入账家」不同名同义，模块注释已写明；
- R3 仍会重排 store-db/tools/context/client，角色模块的 store 依赖面可能再动一次；
- 错误码、重试、回执与 settle unresolved 语义没有变化，既有测试是回归网。
