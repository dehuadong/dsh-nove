# Agent Note: 故事工坊：foundation.hooks 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `foundation.hooks`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

基础设定阶段的 `pendingHooks` 要成为 v2 hook 账本的种子：

- 写入 `bible:hooks` 工件；
- 在 chapter 0 以 `deferred` 进入状态；
- 保留 architect 给的 `hookId`；
- 同一个 hook 在 brief、检索、看板与状态投影里一致；
- 后续 `resolve/defer/promote` 只按状态机改，不靠 upsert 改状态。

当前已有 `state-settle.ts`、`state-projection.ts`、`foundation-hooks.test.mjs`，但没有真实运行回执；也没有逐条对照源工程的未知 hook、superseded、resolved 历史保护。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/state/state-reducer.ts:76-90` | 按 hookId 合并；未知 hook 的 resolve/defer 抛错 | 复刻 hook 操作按 hookId 查账本，未知 id 拒绝 |
| `state-reducer.ts:88-110` | resolve 拒绝 superseded；defer 拒绝 superseded | 复刻 `HOOK_TRANSITIONS` 与 `assertHookTransition` 必须先校验 |
| `state-reducer.ts:119-130` | 按 hookId 排序；superseded 不可被重新打开；resolved 不可 withdraw | 复刻排序与历史保护需要消费者测试 |
| `state-reducer.ts` 的 pendingHooks 种子 | 基础设定把 pendingHooks 写成 chapter 0 deferred 的 hook | 复刻 `writeFoundationBundle` 种子与 `folded.hooks` 投影一致 |

## Proposal

### 范围

- 审计 `writeFoundationBundle` 的 pendingHooks 种子：
  - chapter 0；
  - status deferred；
  - hookId 原样保留；
  - text/expectedPayoff/notes 进入 `bible:hooks`；
- 审计 `state-projection.ts` 的 hook 合并/排序：
  - 同 hookId 更新；
  - superseded 不可 reopen；
  - resolved 不可 withdraw；
- 消费者测试覆盖：
  - 两个种子在 folded/brief/search/dashboard 一致；
  - 未知 hook resolve/defer 拒绝；
  - superseded 不可 resolve/defer；
  - resolved 历史不可撤回。
- 真实回执：真实作品执行基础设定后读 `bible:hooks` 与 `story_state`，确认种子。

### 非目标

- 不改 hook 文案/类型；
- 不实现短篇/剧本 hook；
- 不引入旧作品迁移。

### 失败行为

- pendingHooks 缺 hookId/text → `artifact-invalid`；
- 未知 hookId resolve/defer → `hook-not-found`；
- superseded resolve/defer → `hook-superseded`；
- resolved withdraw → `hook-resolved`。

## Alternatives considered

**只补真实回执，不改测试。** 最强理由是现有 foundation-hooks 测试已覆盖种子与投影；但它目前没有逐条覆盖源 reducer 的未知/superseded/resolved 拒绝，无法证明状态机等价，故不采用。

**把 hook 状态放进正文事件。** 最强理由是随章走；但 hook 是跨章账本，故不采用。

**upsert 直接改 status。** 最强理由是简单；源工程用 hookOps 且禁止 upsert 改状态，故不采用。

## Acceptance criteria

1. pendingHooks 两条种子在 chapter 0、status deferred、hookId 不变；
2. `bible:hooks`、folded、brief、search、dashboard 五处文本/状态一致；
3. 未知 hook resolve/defer 被拒绝；
4. superseded resolve/defer、resolved withdraw 被拒绝；
5. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先审计现有实现，不新增 hook 种类；失败码与源 reducer 对齐。
- Spec：种子、投影一致、状态机拒绝都可观察。
- Architecture：hook 账本留在 state projection；工件 `bible:hooks` 是基础设定产物。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有投影可能已经覆盖大部分行为，差额主要在错误码与历史保护；
- 真实回执需要真实基础设定，不能用纯 fixture 代替；
- 若发现源 reducer 的 `resolved` withdraw 规则不可观测，登记为不可观测而不是放宽。
