# Agent Note: 故事工坊：chapter.summary 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.summary`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

摘要要：

- 以 `summary:<n>` 工件保存；
- 含 chapter/title/characters/events/stateChanges/hookActivity/mood/chapterType；
- chapter/bodyRevision 由宿主戳，子代理不能覆盖；
- 正文改写后摘要标记 stale；
- 消费者从 artifact 读取，不读旧表。

当前审计已判定等价；能力行 consumer 指向 `summary-consumers.test.mjs`，另有 `summary-binding.test.mjs` 覆盖 current/stale。缺真实回执。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/writer.ts:342-355` | chapterSummary 含七个结构化字段，绑定章号 | 复刻 `summary:<n>` 保存同字段 |
| `agents/writer.ts:600-620` | 摘要在正文/结算链上产生，章号由权威值覆盖 | 复刻 `writeSummary` 由宿主戳 chapter/bodyRevision |
| `models/input-governance.ts` 的 ChapterSummary | 摘要只描述已发生正文 | 复刻 bodyRevision 绑定；换正文后 stale |

审计：`docs/fidelity-audit.md` 的 `chapter.summary` 判定等价，无债。

## Proposal

### 范围

- 审计现有 `writeSummary`：
  - 七个结构化字段裁剪/空值；
  - chapter/bodyRevision 宿主戳；
  - `ifAbsent` 幂等；
  - 正文改写后 `summaryStale`；
- consumer 改为 `summary-binding.test.mjs`（stale 绑定），`summary-consumers.test.mjs` 保留为字段/消费者补充；
- 真实回执：真实作品写摘要，读回 artifact 与 readWork/status 的 summaryRevision/summaryStale。

### 非目标

- 不改 summarizer prompt；
- 不做多语言摘要；
- 不做旧表迁移。

### 失败行为

- 未写正文 → `body-not-found`；
- 已定稿章节写摘要 → 既有 `chapter-settled`；
- 正文 revision 变化 → summary stale，不自动重写。

## Alternatives considered

**只补真实回执。** 最强理由是审计已等价；consumer 仍只测字段，覆盖不到 stale/readWork，故改 consumer。

**把 summary 存回 chapters 表。** 最强理由是读简单；旧表已退役，工件是权威，故不回退。

**允许子代理覆盖 chapter/bodyRevision。** 最强理由是灵活；会伪造绑定，故拒绝。

## Acceptance criteria

1. 七个字段保存/裁剪正确；
2. chapter/bodyRevision 由宿主戳，子代理覆盖被忽略；
3. 正文改写后 summaryStale 为 true，恢复当前需重写摘要；
4. readWork/status 的 summaryRevision/summaryStale 与 artifact 一致；
5. consumer 与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：审计等价，实施只补 consumer 与回执，不改存储。
- Spec：字段、宿主戳、stale、readWork/status 都可观察。
- Architecture：summary 是 artifact；chapters 表不再存摘要。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有 summary-consumers 使用 `ifAbsent`，真实回执需覆盖首次/重复写；
- stale 判定依赖 current revision，需在改写后读取；
- 真实作品摘要需要已写正文，fixture 必须至少一章。
