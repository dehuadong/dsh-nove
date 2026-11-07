# Agent Note: 故事工坊：chapter.summary 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.summary`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计已判定摘要字段等价，但 consumer 只测字段，未覆盖 current/stale 绑定；能力行没有真实回执。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/writer.ts:342-355` | chapterSummary 含七个结构化字段，绑定章号 | 复刻 `summary:<n>` 保存同字段 |
| `agents/writer.ts:600-620` | 摘要章号由权威值覆盖 | 复刻 `writeSummary` 由宿主戳 chapter/bodyRevision |
| `models/input-governance.ts` 的 ChapterSummary | 摘要只描述已发生正文 | 复刻 bodyRevision 绑定，正文改写后 stale |

## Decision

- consumer 从 `summary-consumers.test.mjs` 改为 `summary-binding.test.mjs`；
- `summary-consumers` 保留为字段/消费者补充；
- 不改存储、prompt 或多语言；
- 真实回执记录摘要 artifact、bodyRevision、current/stale。

## Alternatives considered

- **只补真实回执。** 最强理由是审计已等价；consumer 未覆盖 stale/readWork，故改。
- **把 summary 存回 chapters 表。** 最强理由是读简单；旧表已退役，工件是权威，故不回退。
- **允许子代理覆盖 chapter/bodyRevision。** 最强理由是灵活；会伪造绑定，故拒绝。

## Consequences

- **收益**：current/stale 绑定有主消费者；readWork/status 与 artifact 对齐；真实摘要可追溯。
- **代价**：stale 后 `hasSummary` 为 false，需重写摘要；这是现有语义。
- **边界**：不改 summarizer prompt；多语言摘要未做。

## Verification

```text
node storycraft/tests/summary-binding.test.mjs    # ALL CHECKS PASSED
node storycraft/tests/summary-consumers.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e           # PASS: 105 unit files
npm run verify                                    # 20 verified / 20 missing
```

真实 fixture `伏笔回执`：`summary:1` revision `f73de774004a`，bodyRevision 2；改写正文后 stale。

回执：`artifacts/real-runs/chapter.summary.json`。
