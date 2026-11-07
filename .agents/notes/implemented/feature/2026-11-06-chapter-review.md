# Agent Note: 故事工坊：chapter.review 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.review`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计登记：模型审稿失败会中断，源工程转 `review-unavailable` observation；observation 契约要求 sourceRefs 至少 1 条，源 unavailable 允许空；consumer 指向 critique 而非审稿路径。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/pipeline/chapter-review.ts:1-80` | 正文非空才审；模型审稿失败转 `review-unavailable` observation，不中断；结果含 wordCount/usage | 复刻失败回退 observation；wordCount/usage 登记后续债 |
| `artifact-contract.ts` 的 observation 契约 | 正常 observation 需要 sourceRefs 证据绑定 | 复刻 `unavailable` 允许空 sourceRefs，其他 assessment 仍至少 1 条 |
| `roles/reviewer/agent.ts` | quote 必须来自当前正文；quote 不匹配一次重试 | 保留 quote 校验与一次重试，不伪造 quote |

## Decision

- `validateObservation`：`assessment === 'unavailable'` 时 sourceRefs 允许 `[]`；issue/resolved 仍至少 1 条；
- `story_delegate` reviewer 失败路径：
  - 捕获失败；
  - `writeReview` 写一条 `review-unavailable`（空 evidence/sourceRefs）；
  - 返回 `ok:true`、`reviewRound`、`problems.total=1/open=0`、warning；
- consumer 改为 `review-unavailable.test.mjs`；
- review 结果 wordCount/usage 仍留在 telemetry，登记后续债。

## Alternatives considered

- **审稿失败直接报错。** 最强理由是失败可见；源工程转 unavailable，故不采用。
- **伪造一条 sourceRef。** 最强理由是满足旧契约；会伪造 quote，故扩契约。
- **本行加 usage 到 review artifact。** 最强理由是完整；usage 已在 telemetry，登记债。

## Consequences

- **收益**：审稿故障不再丢整轮；空证据不被伪造成 quote；正常审稿仍走 quote 重试。
- **代价**：action 层多一个 fail-open 分支；unavailable 可读但不可当 issue 修复。
- **边界**：review wordCount/usage 未进 artifact，后续投影补。

## Verification

```text
node storycraft/tests/review-unavailable.test.mjs   # ALL CHECKS PASSED
node storycraft/tests/reviewer-retry.test.mjs       # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e             # PASS: 104 unit files
npm run verify                                      # 18 verified / 22 missing
```

真实 fixture `伏笔回执`：`review:1:r1:1`，observation `review-unavailable`，sourceRefs `[]`。

回执：`artifacts/real-runs/chapter.review.json`。
