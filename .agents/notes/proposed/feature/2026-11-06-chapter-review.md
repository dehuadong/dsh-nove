# Agent Note: 故事工坊：chapter.review 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.review`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计登记为保真债：

- 源 `reviewChapterDraft` 在模型审稿失败时生成 `review-unavailable` observation，不中断；
- 当前 reviewer 失败直接让动作失败；
- observation 契约要求 `sourceRefs` 至少 1 条，源 `review-unavailable` 允许 `evidence: []`、无 quote；
- review 结果不含 wordCount/usage（usage 在 telemetry）；
- consumer 指向 `critique.test.mjs`，不是审稿路径。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/pipeline/chapter-review.ts:1-80` | 正文非空才审；模型审稿失败转 `review-unavailable` observation；结果含 wordCount/usage | 复刻失败回退 observation；wordCount/usage 记为后续债 |
| `artifact-contract.ts` 的 observation 契约 | id/summary/category/assessment 必填；sourceRefs 用于证据绑定 | 复刻正常 observation 仍要求 sourceRefs；`unavailable` 允许空 |
| `roles/reviewer/agent.ts` | quote 必须来自当前正文；quote 不匹配触发一次重试 | 保留重试；失败回退不伪造 quote |

## Proposal

### 范围

- `validateObservation`：
  - `assessment === 'unavailable'` 时允许 `sourceRefs: []`；
  - 其他 assessment 仍要求至少 1 条 sourceRef；
- reviewer 落盘失败路径：
  - 捕获审稿失败，写一条 `review-unavailable` observation：
    - id `O1`；
    - code `review-unavailable`；
    - summary 带错误码/短消息；
    - evidence `[]`；
    - category `quality`；
    - assessment `unavailable`；
  - 写 review artifact，返回 `problems.total=1, open=0`，不中断；
- consumer 改为 `tests/reviewer-retry.test.mjs` 或新增审稿失败测试；
- 真实回执：正常审稿一轮 + 失败回退一轮。

### 非目标 / 保真债

- **review 结果 wordCount/usage**：当前 review artifact 只存 observations；usage 在 `model_calls`。偿还路径：后续 review result 投影或 `chapter.review` 扩展；本行登记“后续”。
- 不改 quote 校验与一次重试。

### 失败行为

- reviewer 模型失败 → 写入 `review-unavailable`，不抛错；
- quote 不匹配 → 既有 `observation-source-unverified`，一次重试；
- 正文为空 → 既有 `empty-body`/chapter gate。

## Alternatives considered

**审稿失败直接报错。** 最强理由是保持失败可见；源工程明确转 unavailable observation，故不采用。

**unavailable 也伪造一条 sourceRef。** 最强理由是满足现有契约；会伪造 quote，故扩契约而不是伪造证据。

**本行补 usage 到 review artifact。** 最强理由是完整；usage 已由 telemetry 记录，本行先登记债。

## Acceptance criteria

1. 模型审稿失败写入 `review-unavailable`，动作不中断；
2. `unavailable` observation 允许空 sourceRefs；其他 observation 仍拒绝空 sourceRefs；
3. quote 不匹配仍触发一次重试；
4. consumer 指向审稿路径测试；
5. wordCount/usage 债在审计表有后续归属；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先补 fail-open 与 observation 契约，不伪造 quote；usage 登记债。
- Spec：失败回退、空 sourceRefs、重试、consumer 都可观察。
- Architecture：review artifact 仍是 observations；失败也是一轮 review。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 放宽 sourceRefs 只允许 `unavailable`，不能放宽 issue/resolved；
- 失败回退可能掩盖模型故障，需要 summary 带错误码；
- 真实回执需要可重复的失败注入，不能用真实模型随机失败。
