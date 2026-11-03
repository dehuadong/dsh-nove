# Agent Note: 故事工坊：architect 多阶段提交与原子落地

Status: implemented

工作项：当前任务（不新建 GitHub issue）。R1a 已实现同一 architect child 内四段提交、阶段校验与一次性原子落地。

## Problem

R0 已裁决：architect 目标不是 `design + cards` 两个子代理，而是参考实现的一个 architect 上下文内四段：

```text
outline → details → cast index → cards
```

当前 runtime 做不到：

- `story_submit` 一次成功即 `consumed=true` 并关闭 entry，同一 delegation 只能提交一个 payload；
- `writeFoundationStage` 一个阶段一个事务，没有四段原子 bundle；
- `architectPrompt` 只描述单阶段 payload；
- `story_next` 当前返回 `design`/`cards`，不是 `foundation`；
- cards 1:1、stale cards、proposal/主角守卫只在单 stage 路径上；
- hooks 未纳入（见“范围”）。

本项是 R1 的合同，覆盖 runtime 与 architect 角色模块拆分；不实现 hooks。R1 的 agent/prompt/schema 拆分是整改的一部分，不能只改 `submission.ts`。

### 范围

- **R1a（本项）**：一个 architect child、四 phase 提交、bundle 原子落地、`story_next` 改为 `foundation`；同时拆出 `roles/architect/{agent,prompts,tool-schema,contract}`（可先内部模块，不改变工具名）；
- **R1b**：architect hooks（参考 details 的 `pendingHooks`）另立；
- 不改变四阶段面板布尔，不迁移旧作品；
- 不删除手动 frame/rules/roles/cards/design 入口，但正常流程不再使用。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect.ts:269-332`：同一 agent 内四段顺序 submit，后段继承前段输出；cards 使用动态 cast schema。
- `docs/report/inkos/01.md:151`：architect 分阶段生成，避免一次巨大结构化输出。
- 本地 `submission.ts:186-384`：architect 按 stage 校验；`389/473` 一次 consume/close。
- 本地 `store-db.ts:1222-1394`：单 stage 事务落盘；`foundationStateOf` 四布尔。
- 参考 details 还带 `pendingHooks`；当前项目无 architect hooks 产物（planner/settler 产生），R1 先不扩 hooks，另立 R1b。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| 同一 agent 四段、每段独立 completion | 一个 architect child + 四个 `story_submit` phase（同一 completion） | DSH child 不能换 system prompt 重开 completion；保留上下文，避免四冷启动 | **等价适配，登记偏差** | runtime 测试 |
| 四段后一次写 | `writeFoundationBundle` 单事务 | 任一失败不落半成品 | 采纳 | 原子测试 |
| 动态 cast schema | 固定 `roleCards` 数组 | DSH tool schema 限制 | 等价适配 | schema 测试 |
| details 带 hooks | R1a 不含 hooks | 先限 runtime，产品合同另裁 | **偏差，R1b 排期** | R1b |

## Decision

### 派发合同

`story_delegate(role='architect', stage='foundation')`：

- 只启动**一个** architect child；
- prompt 规定固定顺序：
  1. `outline`：storyFrame / volumeMap / currentFocus；
  2. `details`：bookRules；
  3. `cast_index`：rolesIndex；
  4. `cards`：roleCards；
- 子代理通过同一 delegation 调用四次 `story_submit`，每次带 `phase`；
- `story_next` 在 foundation 未完成时返回一个 `foundationStage:'foundation'`，不再返回 design/cards；
- 面板仍显示 frame/rules/roles/cards 四格，由四段全部落地后的派生状态填充。

### `story_submit`

新增可选参数：

```ts
{
  delegationId: string
  phase?: 'outline' | 'details' | 'cast_index' | 'cards'
  payload: object
}
```

规则：

1. `phase` 只在 architect `stage='foundation'` 的 entry 上合法；其他角色/阶段传 phase 拒绝；
2. 每次提交按 phase 校验 shape；
3. 同一 phase 首次成功即锁定；后续重复提交返回 `submit-already-accepted`，失败重试仍可重提；
4. 顺序守卫：`outline` 先；`details` 需要 outline；`cast_index` 需要 details；`cards` 需要 cast_index；
5. 四段未齐前不得 `consume`/落盘；`consumed` 只在 bundle 成功后置 true；
6. 任一段失败只返回该段错误，不落任何 artifact；
7. 四段齐后，宿主调用一次 bundle 落地；成功后 entry consumed；
8. 单 phase payload 仍受 64 KB 上限。

### entry 模型

当前 entry 是“单 payload + 单 consumed + 全局 3 attempts + 10 分钟 TTL”；foundation 要改为：

- `phases: Map<phase, payload>`；
- `phaseAttempts: Map<phase, number>`，每个 phase 最多 3 次，不共享全局次数；
- `consumed` 只在 bundle 成功后为 true；
- `FOUNDATION_TTL_MS` 大于 `FOUNDATION_DELEGATE_TIMEOUT_MS`（或每次成功 phase 刷新 `expiresAt`），避免第四段落时 entry 已过期；
- foundation 派发使用独立 `FOUNDATION_DELEGATE_TIMEOUT_MS`（至少覆盖四段；不能复用 10 分钟的普通单步 timeout），并记录每 phase 的耗时；
- `submit-already-accepted` 只针对同一 phase 的已成功 payload；`submit-already-consumed` 只在整个 bundle 消费后；
- `consumeFoundationSubmission` 返回四 phase map；单 phase 的 `consumeSubmission` 行为不变。

### 原子落地

新增 `writeFoundationBundle(root, {work, phases})`：

- 在一个 SQLite transaction 内校验并构建五组记录：
  - outline → `bible:story_frame` / `bible:volume_map` / `bible:current_focus`；
  - details → `bible:book_rules`；
  - cast_index → `roles:index`；
  - cards → `role:*`；
- 复用现有 proposal-token、主角一致性、roles/cards 1:1、stale-card drop 逻辑；
- **所有跨段守卫必须读 phase payload，不读尚未写入的 DB**：rules 主角检查用 `details.bookRules` 对 `outline.storyFrame`；cards 1:1 用 `cast_index.rolesIndex`；stale-card 用新 index；
- 全部通过后一次 `putArtifactOnDb`；
- 任一失败抛错，事务回滚，foundation 状态不变；
- 手动 `frame/rules/roles/cards` 入口保留，`design` 仅作旧兼容，不再由 `story_next` 使用；
- bundle 成功后 `foundation.complete` 仍由四布尔派生，供面板与 `story_next` 使用。

### 失败与重试

- phase 校验失败：返回可重试错误；同一 child 修正后重提该 phase；
- child 未提交全部四段：`delegation-no-submission`，不落地；
- 重复 accepted phase：不可覆盖；只能在前一 phase 失败时重试；
- bundle 失败：整批不写，错误返回；entry 关闭；
- 超时/取消：不落地。

### Schema/枚举

- `FOUNDATION_DISPATCH_STAGES` 改为 `['foundation']`；`design`/`cards`/手动 `frame/rules/roles` 只保留为 write/manual 入口，不再由 `story_next` 返回；
- 新增 `FOUNDATION_WRITE_STAGES = ['design','frame','rules','roles','cards']`；`writeFoundationStage` 的 whitelist 使用 write 列表，不能复用 dispatch 列表，否则手动 `design` 会失效；`foundation` 只走 `writeFoundationBundle`，不进入 `writeFoundationStage`，否则会落到 cards 分支；
- `foundationState.dispatchStage` 只在未完成时返回 `foundation`；完成后无；
- `nextStep` 直接使用 `foundation.dispatchStage`，**删除 `?? foundation.nextStage`**，避免 frame/rules/roles 部分完成时回退到 `cards`；
- `story_delegate.stage` 与 `NEXT_OUTPUT.delegate.stage` 增加 `foundation`（design 保留兼容）；
- `story_next.foundationStage` 增加 `foundation`；
- `story_submit` 增加 `phase` 枚举；
- `DELEGATE_OUTPUT.foundation` 的 `dispatchStage` 仍为 `foundation`（或删除旧 design/cards）；
- client 类型同步；面板不新增控件。

### 测试

- 一个 fake architect child 连续提交四 phase，bundle 写五类 artifact；
- 缺一 phase → 无 artifact；
- 某 phase 非法 → 无 artifact，重提可成功；
- 重复 accepted phase → `submit-already-accepted`；
- bundle 的 cards 1:1/非法 tier → 回滚；
- 顺序守卫；
- `story_next` 从 foundation 到 approval；
- 既有手动 frame/rules/roles/cards 测试保持；`design` 仅保留手动兼容测试；
- 更新依赖 `story_next.foundationStage==='design'` 的测试（foundation-production、memo-consumers、foundation-premise、submission）；
- 测试每个 phase 的 3 次重试独立、TTL 在 phase 成功时刷新、64 KB 按 phase 计；
- 手动 `design/frame/rules/roles/cards` 写入仍通过 whitelist；部分 state 时 `dispatchStage` 仍为 foundation，不回退 cards；
- foundation timeout 覆盖四段，TTL 不早于 timeout；
- 单 child：fake 记录一次 startActivation；最终真实链路由作者验收。

## 与既有决定

- **部分取代** [role-submission](2026-10-20-storycraft-role-submission.md)：单 payload/3 attempts/TTL 仍适用于非 architect 角色；architect foundation 改多 phase/按 phase 重试/刷新 TTL。
- **部分取代** [design-cards dispatch](2026-11-02-storycraft-design-cards-dispatch.md)：B 的 design/cards 降为手动兼容，不再由 `story_next` 使用。
- [对拍基线重审](../../rejected/architecture/2026-11-02-storycraft-parity-rebaseline.md) 的 R1 目标由本项提供 runtime 合同。

## Alternatives considered

**A. 四个独立子代理。** 最强理由是现有实现成熟、失败隔离最好。否决原因：R0 已确认它是旧结构，四冷启动和重复上下文不符合参考的同一 architect 上下文。

**B. 一个子代理一次提交五块（design）。** 最强理由是简单。否决原因：cards 体量不可控，且与参考四段不符。

**C. 一个子代理四段，但每段单独落盘。** 最强理由是改动小。否决原因：后续段失败会留下半成品；参考是整批写。

**D. 复用同一 session 的多次 delegate。** 最强理由是保留上下文。否决原因：当前 `story_delegate` 每次新建/销毁 child；需要另一套 session 生命周期，且不等价于一个 agent。

## Verification

1. 正常 foundation 只派发一个 architect child；
2. `story_submit` 支持同一 delegation 的四 phase，顺序/重复/错误规则明确；
3. 四段全部校验后 `writeFoundationBundle` 单事务落盘；任一失败零 artifact；
4. `story_next` 只返回 `foundation`，完成后 approval；`nextStep` 不回退 `nextStage`；面板四格不变；
5. 手动 stage 与 design 兼容入口保留且不被正常流程使用；`FOUNDATION_WRITE_STAGES` 与 dispatch 列表分离；
6. foundation timeout/TTL 覆盖四段，不沿用普通单步 10 分钟；
7. `story_submit`/`story_delegate`/`story_next` schema、prompt、ARCHITECT skill、README 同步；architect 的 prompt/schema/contract 从 `delegate.ts`/`submission.ts`/`tools.ts` 拆到 `roles/architect` 模块；
8. 测试覆盖四 phase、原子回滚、1:1、顺序、重复、单 child；最终真实链路由作者验收；
9. 本项不改 hooks；hooks 另立 R1b；
10. 94 单元 + 49 E2E 通过。

## Testing

- `node storycraft/scripts/ci.mjs`：94 单元 + 49 E2E 通过；
- 单 child fake 测试断言只启动一次 architect；
- foundation-production 覆盖四 phase、缺段、坏卡 bundle 回滚；
- submission 覆盖 phase 顺序、重复 accepted、四段 consume；
- `verify-notes` 通过。

## Consequences

- 同一 child 多轮工具调用依赖模型遵守顺序；host 顺序守卫兜底，但仍可能浪费一次 child；
- `story_submit` 从一次性变为多阶段，会影响所有 architect 测试与错误码；
- bundle 复用现有守卫需要抽取，避免两套校验逻辑漂移；
- 64 KB 是单 phase 上限，不是四段总和；需要真实链路观察整体输出；
- hooks 仍缺，R1 不能声称 architect 完全对拍。
