# Agent Note: 故事工坊：对拍基线重审与角色职责边界整改

Status: rejected — 历史基线重审：诊断保留，R1–R4 计划已结束；见 implemented/process/2026-11-03-storycraft-status-evidence-ownership.md

工作项：当前任务（不新建 GitHub issue）。先重审对拍基线，更新 parity-matrix 与 roadmap，再按角色职责边界分阶段整改。

## Problem

当前实现与 `inkos-master` 的差距不是 architect 一个节点的提示词位置，而是**系统性的职责边界缺失**：

- 参考实现按角色拆 agent、prompt、tool schema、state 与编排；
- 我们把这些压进 `delegate.ts`、`tools.ts`、`submission.ts`、`store-db.ts`、`client.ts`；
- 技能（Skill/References）被用来补代码 prompt 的缺口，代码 prompt 又复制技能里的方法；
- 结果是“方法、任务、提交合同、校验、存储”混在一起，无法逐层对拍。

因此不能继续以“技能按需加载”或“B 方案减派发”作为局部修补。

## Evidence

### 参考实现的职责

- `packages/core/src/agents/architect.ts`：architect 一个 agent 内四次顺序调用：
  1. `submit_foundation_outline`（storyFrame/volumeMap）；
  2. `submit_foundation_details`（bookRules/data/hooks，输入继承 frame/volume）；
  3. `submit_foundation_cast_index`（cast index，代码硬编码 system prompt + castContext）；
  4. `submit_foundation_cast_documents`（cards，代码硬编码卡片 prompt + 按 cast 动态生成的 tool schema）。
- 其它角色也各自有 agent 与 tool schema：`planner.ts`/`planner-tool.ts`、`writer.ts`/`writer-tool.ts`、`reviser.ts`、`continuity.ts`、`settler-tool.ts`、`state-validator.ts`、`composer.ts`。
- `packages/core/src/agents/*-prompts.ts` 负责角色提示词，`*-tool.ts` 负责提交 schema，`state/` 负责状态；Skill/References 负责通用方法。

### 我们的职责

| 文件 | 规模 | 当前承担 |
|---|---:|---|
| `src/store-db.ts` | ~230 KB | 存储、foundation 写入、stage、next、状态、计划、审批 |
| `src/tools.ts` | ~126 KB | 全部动作注册、schema、执行、面板数据 |
| `src/delegate.ts` | ~54 KB | 所有角色派发、prompt、landing、submission 桥接 |
| `src/submission.ts` | ~21 KB | 所有角色 payload shape 校验 |
| `src/client.ts` | ~227 KB | UI、类型、数据访问 |
| `src/context.ts` / `bible.ts` | ~33/30 KB | 上下文装配、brief、真值 |

这不是“文件大”本身的问题，而是**一个文件同时拥有多个可独立对拍的职责**。

### 当前已确认的偏差

- 参考 architect 是**一个 agent 内四段**；当前正常流程是**两个子代理**（design + cards），此前是四个子代理；
- 参考 cast/cards 的任务 prompt 在代码中，并与动态 cast schema 绑定；我们把卡片方法放进 architect skill/`foundation-design`，代码 prompt 只给 shape/context；
- 参考有 `pendingHooks/initialHooks`；当前 architect 不产 hooks；
- 参考 `composer` 独立负责 context 选择；我们由 `context.ts` + `bible.ts` + `store-db.ts` 共同承担；
- 技能数量/资源也已过时：当前 18 技能、17 份 references；parity-matrix 仍写 14 技能、9 份。

## 对拍参考

- `docs/report/inkos/01.md:105-151`：Skill/References 按任务调用；Architect 分阶段生成。
- `packages/core/src/agents/architect.ts:269-332`：四段调用、中间结果继承、cast/cards 专用 prompt。
- `packages/core/src/agents/architect-tool.ts`、`planner-tool.ts`、`writer-tool.ts`、`review-tool.ts`：按角色拆 schema。
- `packages/core/src/agents/writer-prompts.ts`、`planner-prompts.ts`、`settler-prompts.ts`：角色 prompt 独立文件。
- `docs/report/inkos/2026-10-23-full-project-parity-audit.md` 与 `2026-10-23-artifact-and-resource-parity-audit.md`：产物/资源对拍证据。

| 参考做法 | 我们的目标 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| 角色 agent 文件 | `roles/<role>/agent.ts` 或等价 | 角色边界可审查 | 采纳（DSH 等价） | 结构测试 |
| 角色 prompt 文件 | `prompts.ts` | 任务提示词与方法分离 | 采纳 | 快照/契约 |
| 角色 tool schema | `tool-schema.ts` | 提交合同独立 | 采纳 | schema 测试 |
| 方法在 Skill/References | 技能只放方法 | 避免代码 prompt 复制方法 | 采纳 | 技能测试 |
| 一次 agent 内多阶段 | R1 恢复四段/等价 runtime | 参考的四段在同一 agent 内 | **已裁决：B 不保留** | 真实链路 |

## Proposal

### 职责边界

目标结构（名称可按 DSH 适配，但职责必须分离）：

```text
storycraft/src/
  roles/
    architect/{agent,prompts,tool-schema,contract}.ts
    planner/{agent,prompts,tool-schema}.ts
    writer/{agent,prompts,tool-schema}.ts
    reviewer/{agent,prompts,tool-schema}.ts
    reviser/{agent,prompts,tool-schema}.ts
    settler/{agent,prompts,tool-schema}.ts
  runtime/
    delegate-runner.ts
    submission.ts
    stage-machine.ts
  domain/
    foundation.ts
    chapters.ts
    state.ts
  storage/
    db.ts
    repositories/*
  context/
    composer.ts
    brief.ts
  tools/
    registry.ts
    actions/*
```

原则：

1. **Skill/Reference**：只放通用创作方法，不放阶段字段、工具 schema、本次任务数据；
2. **role prompt**：只放本次任务、阶段、作者意图、当前事实、上下文选择结果；
3. **tool schema**：只放可提交结构与校验；
4. **agent**：只放阶段编排、失败回退、提交/重试边界；
5. **storage**：只放持久化，不决定阶段；
6. **composer/context**：只放来源选择与装配，不写作品事实；
7. **client**：只消费 API，不拥有领域规则。

### 分阶段

**R0 基线重审（本项）**

- 更新 parity-matrix 与 roadmap；
- 明确参考每个角色的 agent/prompt/tool schema/方法边界；
- **裁决 architect 四段 vs design/cards**：保留并登记偏差，或回退到参考的四段；
- 不写业务代码；
- 旧“已交付”状态的重置与重排期拆到 [交付状态重审与对拍基线重排期](../process/2026-11-02-storycraft-delivery-status-replan.md)（R0b）；R0b 盘点已完成，见[交付状态盘点](../../archived/process/2026-11-02-storycraft-delivery-status-inventory.md)。

**R1 architect 试点**

runtime 合同见 [architect 多阶段提交与原子落地](../../archived/architecture/2026-11-02-storycraft-architect-multistage-runtime.md)。

- 按 R0 裁决拆出 architect agent/prompt/schema/contract；
- 目标恢复四段顺序：`outline → details → cast index → cards`，同 architect 上下文；
- 若 DSH 一次提交限制不可绕开，先立 runtime 适配，不把 B 当完成；
- 恢复或明确 hooks/cast 的输入输出；
- 真实链路验证。

当前 `submission.ts` 的 `story_submit` 一次 consume/close、无阶段间结果反馈；这是“同一 subagent 内四段”必须新增的 runtime 约束，R0 不得把它当作已有能力。

**R2 其它角色**

- writer、reviewer、reviser、planner、settler 逐个拆 prompt/schema/contract；
- 与参考的 `*-prompts.ts`/`*-tool.ts` 对齐；
- 保留 DSH 的 `story_submit`/subagent 机制，不复制 provider。

**R3 基础设施**

- `store-db.ts` 按存储/领域/阶段拆分；
- `tools.ts` 按动作注册与角色 schema 拆分；
- `context.ts`/`bible.ts` 收敛为 composer/brief；
- `client.ts` 只保留 UI 与 API 类型。

**R4 回归**

- 每个角色有独立契约测试；
- 不新增无关数量上限；现有 94 单元 + 49 E2E 全过；
- 真实链路抽查 architect、writer、reviewer、settler。

### B 方案处置（R0 裁决）

**裁决：不保留 B 作为目标形态。** 参考 architect 是一个 agent 内四段顺序调用；当前 `design + cards` 是两个独立子代理，不能作为对拍完成。

- 当前代码暂时保留，避免中断使用；
- R1 目标改为：同一 architect 上下文内四段顺序提交（`outline → details → cast index → cards`），或 DSH 的等价多阶段 runtime；
- `submission.ts` 当前一次 consume/close，R1 需要新增多阶段提交支持；
- 在 R1 完成前，文档把 B 标为**临时偏差**，不写“已对齐”；
- 本项不改代码。

### 文档更新

- `2026-10-18-storycraft-parity-matrix.md`：
  - 修正技能/资源计数与名称；
  - 修正 architect 行；
  - 新增“角色职责边界”与“当前偏差”；
  - 标注旧 foundation 交接“已对齐”行过时。
- `2026-10-19-storycraft-roadmap.md`：
  - 新增 R0 阶段与队列；
  - 修正技能基线（`long-prose`/`long-outline` 等实际名称）；
  - 修正 Proposed Note 处置与 F14 等已交付状态；
  - 移除“#4 拥有状态”的过期口径，改为 Note/roadmap 分工。

## Alternatives considered

**A. 只修 architect。** 最强理由是范围小。否决原因：writer/reviewer/planner/settler 的 prompt/schema 同样混在 monolith，单修 architect 会再次形成局部偏差。

**B. 按参考文件一比一复制目录。** 最强理由是结构最接近。否决原因：参考运行时是 Agent 类 + Provider + 文件状态；DSH 是 Plugin + subagent + SQLite。必须按 DSH 机制等价适配，不能复制运行时。

**C. 继续用技能补代码 prompt。** 最强理由是改动少。否决原因：职责边界继续模糊，无法验证方法是否真正进入角色输入。

**D. 保持 B 并直接拆文件。** 最强理由是当前代码已工作。否决原因：B 的阶段边界本身与参考不同，先拆文件会固化错误结构。

## Acceptance criteria

1. parity-matrix 的 architect、技能计数、资源名称、状态与当前代码一致；
2. roadmap 新增 R0，且当前队列不再把 B 当作对拍完成；R0b 接管旧交付状态盘点；
3. 两篇文档明确“参考 architect 是同一 agent 内四段；当前 design+cards 是偏差”；
4. 角色职责边界表覆盖 architect/planner/writer/reviewer/reviser/settler/composer；
5. R0 有明确的 B 处置裁决点，R1 有对应实现与验证方式；
6. 本项不修改业务代码；
7. 两篇文档通过 `verify-notes`。

## Risks

- 参考实现本身有弱点；结构采纳不等于复制缺陷；
- DSH 的 `story_submit` 当前一次 consume/close；同一 session 四段需要新增 runtime 支持，R0 先确认约束；
- 拆分 monolith 会产生过渡期双入口，必须设退出条件；
- roadmap/matrix 是 living docs，更新后仍需随实现同步。
