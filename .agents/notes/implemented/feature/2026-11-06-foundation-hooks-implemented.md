# Agent Note: 故事工坊：foundation.hooks 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `foundation.hooks`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

`pendingHooks` 需要成为 v2 hook 账本的种子，并在 folded、brief、search、dashboard 中一致；状态机必须拒绝源 reducer 不允许的转移。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/state/state-reducer.ts:76-110` | 按 hookId 合并；未知 hook 的 resolve/defer 抛错；superseded 不可 resolve/defer | 复刻 `applyHookOp` 按 hookId 查账本；未知返回 `hook-not-found`，状态转移由 `HOOK_TRANSITIONS` 校验 |
| `state-reducer.ts:124-140` | `resolved → superseded` 抛 `HOOK_RESOLVED_HISTORY`；supersede 缺 notes 抛 `HOOK_WITHDRAWAL_REASON_REQUIRED` | 复刻移除 `resolved: ['superseded']`，supersede 必须带非空 notes |
| `state-reducer.ts` 的 pendingHooks 种子 | chapter 0、deferred、hookId 原样保留 | 复刻 `seedFoundationHooksOnDb` 种子；re-seed 的移除写入带理由的 supersede |

## Decision

- `HOOK_TRANSITIONS.resolved` 改为空数组；
- `hookTransition`：
  - `resolved → superseded` 抛 `hook-resolved-history`；
  - supersede 缺 notes 抛 `hook-withdraw-reason-required`；
  - supersede 事件带 notes，投影保留撤回理由；
- `seedFoundationHooksOnDb` 移除种子时写 `notes: '从初始伏笔中移除'`；
- 种子仍为 chapter 0、status deferred、hookId 原样。

## Alternatives considered

- **保留 resolved→superseded。** 最强理由是允许撤回顾虑；源 reducer 明确拒绝，故不采用。
- **supersede 不带理由。** 最强理由是简化；源工程要求撤回授权/理由，故不采用。
- **重 seed 直接 upsert 覆盖。** 最强理由是简单；但会丢状态历史，故按 hookId diff + supersede。

## Consequences

- **收益**：种子、状态机与源 reducer 对齐；撤回有理由；folded/brief/search/dashboard 共用同一账本。
- **代价**：旧事件若缺 supersede notes 会在投影时报错；测试数据重建，不做迁移。
- **边界**：只做长篇 foundation；短篇/剧本 hook 未做。

## Verification

```text
node storycraft/tests/foundation-hooks.test.mjs      # ALL CHECKS PASSED
node storycraft/tests/state-projection.test.mjs       # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e               # PASS: 101 unit files
npm run verify                                        # 10 verified / 29 missing
```

真实 fixture `伏笔回执`：

- `ledger-debt`：chapter 0，deferred，text「那本没人认领的旧账本」；
- `stopped-watch`：chapter 0，deferred，text「停摆的怀表」。

回执：`artifacts/real-runs/foundation.hooks.json`。
