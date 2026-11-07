# Agent Note: 故事工坊：chapter.settle 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.settle`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计已判定结算等价，但能力行没有真实回执。需要证明 factOps/hookOps、newHooks 宿主 id、状态 op、摘要绑定与 conflict 拒绝都在真实作品上成立。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/settler-tool.ts:35-75` | 结算提交 postSettlement/factOps/hookOps/newHookCandidates/chapterSummary | 复刻 state-settle 校验并折入 state 事件 |
| `settler-tool.ts:20-30` | newHooks 不分配 id；postSettlement 是叙述 | 复刻 newHooks 宿主铸 id；postSettlement 不作为持久化合同 |
| `models/input-governance.ts` 的 ChapterSummary | 结算携带摘要，摘要绑定正文 | 复刻结算前摘要 current |

## Decision

- consumer 保持 `state-v2-settle.test.mjs`；
- 真实回执记录 counts、factOps、newHooks、hook status；
- 不新增 postSettlement 存储；摘要由 `chapter.summary` 独立产出；
- 不改 hook 状态机。

## Alternatives considered

- **把 postSettlement 存成 artifact。** 最强理由是源返回该文本；它是结算叙述，不是持久化合同，故不做。
- **重复写 chapterSummary。** 最强理由是结算自带摘要；摘要已由 `chapter.summary` 独立产出，故不重复。
- **只靠单测。** 最强理由是覆盖完整；能力验收还要真实回执，故补。

## Consequences

- **收益**：真实结算显示 fact 1、hook 1、newHook 1；newHook 宿主铸 id；hook op 推进状态。
- **代价**：真实 fixture 需先有 clean review + current summary。
- **边界**：postSettlement 不持久化；摘要仍独立。

## Verification

```text
node storycraft/tests/state-v2-settle.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e          # PASS: 105 unit files
npm run verify                                   # 21 verified / 19 missing
```

真实 fixture `伏笔回执`：counts `{facts:1,hooks:1,newHooks:1}`，`ledger-debt` 推进为 progressing。

回执：`artifacts/real-runs/chapter.settle.json`。
