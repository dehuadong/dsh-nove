# Agent Note: 故事工坊：chapter.settle 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.settle`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计已判定结算等价，但能力行没有真实回执。需要证明：

- factOps/hookOps 写入事件；
- newHookCandidates 由宿主铸 id；
- hook 状态只走 op，不靠 upsert；
- 结算前摘要必须存在且绑定正文；
- conflict 校验拒绝未知条目。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/settler-tool.ts:35-75` | 结算提交 postSettlement/factOps/hookOps/newHookCandidates/chapterSummary | 复刻 state-settle 校验并折入 state 事件 |
| `settler-tool.ts:20-30` | postSettlement 是变更叙述；newHooks 不分配 id | 复刻 newHooks 宿主铸 id；postSettlement 不是 capability 字段 |
| `models/input-governance.ts` 的 ChapterSummary | 结算携带摘要，摘要绑定正文 | 复刻结算前摘要存在且 current |

审计：`docs/fidelity-audit.md` 的 `chapter.settle` 判定等价，无债。

## Proposal

### 范围

- consumer 保持 `state-v2-settle.test.mjs`（已覆盖 fact/hook/state draft/conflict）；
- 真实回执：
  - 真实章节写摘要；
  - 结算 factOps upsert/expire、newHooks、hook progress；
  - 读回 counts、folded facts/hooks、state draft；
- 不新增产品字段；不把 postSettlement 当持久化产物。

### 非目标

- 不把 postSettlement 文本单独存 artifact；
- 不做旧表迁移；
- 不改变 hook 状态机。

### 失败行为

- 无摘要结算 → `summary-required`；
- 未知 hook/fact → `hook-not-found` / `fact-not-found`；
- upsert 改 hook 状态 → `hook-transition-invalid`。

## Alternatives considered

**把 postSettlement 存成 artifact。** 最强理由是源返回该文本；源是结算结果叙述，不是持久化合同，故不做。
**保留 chapterSummary 到 summary artifact。** 强；但摘要由 `chapter.summary` 独立产出，结算只校验绑定，故不重复写。
**只靠 state-v2-settle 单测。** 强；能力验收还要真实回执，故补。

## Acceptance criteria

1. 结算前摘要 current；无摘要拒绝；
2. factOps upsert/expire 写入并折入；
3. newHooks 宿主铸 id，重复文本去重/mention；
4. hook op 改状态，upsert 改状态拒绝；
5. 未知 fact/hook 拒绝；
6. consumer 与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：审计等价，实施只补真实回执与 consumer 确认。
- Spec：counts、folded state、summary 绑定、错误码都可观察。
- Architecture：结算仍是 state 事件；postSettlement 不做新存储。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 真实回执需要已写正文 + 摘要，fixture 必须齐；
- folded state 可能包含历史章事件，回执要限定本章；
- conflict 测试依赖已有 fact/hook 条目，fixture 要最小。
