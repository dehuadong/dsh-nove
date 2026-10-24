---
title: 故事工坊：L-R10a S2 ChapterSummary 迁移
status: implemented
created: 2026-10-24
updated: 2026-10-24
verification: 结构化摘要与 revision 绑定已落地，CI 通过；证据见 #57。
---

# Agent Note：故事工坊：L-R10a S2 ChapterSummary 迁移

## 问题

摘要的现行权威是 `summaries` 表：`writeSummary` 写 `text`/`revision`，brief 的 previous/recent、检索候选、facts 白名单、`readChapter(view:'summary')`、`story_read`、导出、`readWork`/`status`、settle 门禁与 delegate preflight 都读它；stale 只靠表内 `revision` 与 `chapters.current_revision` 比较。

A0 已登记 `summary:<n>` 身份与 ChapterSummary 字段（`rawText` 与 `bodyRevision` 各有语义），但没有生产者写 artifact、消费者也不读 artifact。S2 把摘要的生产与消费整体切到 artifact，并让旧表退役。

## 对拍参考

- `inkos-master/packages/core/src/models/runtime-state.ts`：`ChapterSummaryRowSchema` 只有 7 个字段（title/characters/events/stateChanges/hookActivity/mood/chapterType），没有 rawText，也没有正文版本字段；摘要随 runtime state 归约（`state/state-reducer.ts`），是派生状态。
- `inkos-master/packages/core/src/agents/settler-tool.ts`：`SettlementToolSchema.chapterSummary` 由 settler 在结算时提交，7 字段同构；host 不要求 child 提供章号。
- `inkos-master/packages/core/src/utils/memory-retrieval.ts`：摘要行作为检索候选与 `MemorySelection.summaries` 进入上下文；FTS 是可重建派生索引。
- 我们的裁决：
  - **采纳** 7 字段结构与“身份字段由 host 提供”的边界：`chapter` 与 `bodyRevision` 不让 child 填。
  - **等价适配**：保留 `rawText` 作为摘要的唯一文本来源（手动回退、brief、导出、`readChapter` 都渲染它），结构字段不承担渲染。
  - **差异**：参考实现的摘要不绑定正文版本，`docs/report/inkos/01.md` 的 R3 记录了“正文改动后下游状态与摘要不重算”的缺口；我们用 `bodyRevision` 做 stale 判定，避免同类问题。
  - **不采纳**把摘要并进 settler：我们的阶段机把摘要作为 settle 前的独立步骤，settler 与 review 生命周期归 #52。

## 与既有记录

- 切片排序与 owner 由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 承接其中 S2。
- 字段合同由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 的 ChapterSummary 拥有；本 Note 只定生产、stale、消费者切换与退役边界。
- 章号重映射由 [`2026-10-24-storycraft-chapter-artifact-remap.md`](2026-10-24-storycraft-chapter-artifact-remap.md) 拥有；S2 的 `summary:<n>` 已在其中改号。
- 本 Note **部分替代**以下已交付记录，冲突以本 Note 为准，交付时同步其机制表述：
  - [`2026-10-21-storycraft-summary-transport.md`](../../implemented/pipeline/2026-10-21-storycraft-summary-transport.md)：summarizer 的 `{summary: string}` payload 与 `summary-exists` 判定；角色、尝试次数、失败 envelope、面板固定指令继续适用。
  - [`2026-10-21-storycraft-summary-revision-binding.md`](../../implemented/pipeline/2026-10-21-storycraft-summary-revision-binding.md)：`summaries.revision` 的存储位置与读取路径；`bodyRevision` 的 stale 语义、manifest 的 `summaryRevision`/`summaryStale` 口径继续适用。
- observation/reviews 生命周期归 #52；本 Note 不改审稿轮次、reviser 与 observation 语义。

## 决定

### 1. 生产

- 单一写入口 `writeChapterSummaryOnDb`（`artifact-store.js`）在事务内写 `summary:<n>`，content 为 ChapterSummary；`chapter` 取当前章号、`bodyRevision` 取 `chapters.current_revision`，**由 host 盖章**，忽略调用方传入的同名字段。
- 两条生产路径：
  - 委派 summarizer：`story_submit` 的 summarizer payload 从 `{summary: string}` 改为 `{rawText, title, characters, events, stateChanges, hookActivity, mood, chapterType}`。`rawText` 必填、去空白后非空；结构字段可选，缺省为空串；不因结构字段全空而拒绝（清稿章只有 rawText 也合法）。
  - 手动 `story_summarize`：参数 `summary` 保留为文本，写入 `rawText`；7 个结构字段写空串。
- store 边界保留 `writeSummary({ text })` 作为手动路径 API（等价于 `rawText: text` + 空结构），委派路径传结构化 content；两者进同一事务入口。既有测试 fixture 与手动回退不需要改调用面。
- 长度：`rawText` 沿用 `SUMMARY_MAX_CHARS`（400 字）截断，回执保留 `chars` 与 `truncated`；每个结构字段上限 120 字，超出按码点截断而不报错。摘要 payload 因此有界（400 + 7×120），不随结构字段膨胀。
- 幂等：同一章写相同内容不新增 revision、不报错；不同内容写新 revision，旧 revision 保留可读。委派 summarizer 的 `summary-exists` 判定改为“最新 `summary:<n>` 的 `bodyRevision` 等于当前正文版本”。
- 落盘同一事务内 `syncSearchDoc`：doc_id 按章（`summary:<n>`），每次写入替换该章文档，文本 = `rawText` + 结构字段行；历史 revision 不进 FTS。

### 2. stale 与状态

- `summaryStateOf` 读最新 `summary:<n>` 的 `content.bodyRevision`：无 artifact → `missing`；等于 `chapters.current_revision` → `current`；小于 → `stale`；大于按数据损坏视为 `stale`。
- 投影里的 `revision` 继续表示**正文版本**（`bodyRevision`），不是 artifact revisionId；artifact revisionId 只在 `story_read`/`artifactRef` 暴露。两个字段名不得混用。
- 正文 rewrite/revise 不写摘要，stale 自然产生；`summaryStateMap`/`readSummaryState`/`listSummaryStates` 保留签名，内部改读 artifact。
- 摘要描述的是定稿正文，允许在 settled 章节写入（`putArtifactOnDb` 的定稿守卫只对 summary 生产放宽）；面板投影把无法解析的摘要行当作 `missing`，直接读取仍报 `artifact-invalid`。

### 3. 消费者

| 消费者 | 切换 |
| --- | --- |
| brief `previous` / `recentSummaries` | 取 `rawText`，trim 与长度处理沿用 |
| `context.js` 的 recent 与上一章结尾 | 同上 |
| 检索候选 | 仍只取 current 摘要；候选 `text` 用 `rawText`，结构字段只参与 FTS 匹配、不进 prompt |
| `facts.js` 白名单 | `rawText` + `characters` 字段 |
| `readChapter(view:'summary')` | 渲染 `rawText` |
| `bible.summaryIndex` | 章节、路径、字数从最新 artifact 的 `rawText` 计算 |
| `story_read(summary:n)` | 返回 ChapterSummary JSON 与 registry revisionId；显式旧 revision 可读；无摘要 `summary-not-found` |
| `readWork` / `status` / manifest | `hasSummary`/`summaryRevision`/`summaryStale` 从 artifact 投影 |
| 导出 | `summaries/<stem>.md` 写 `rawText`；manifest 摘要绑定用 `bodyRevision` |
| settle / state 门禁、delegate summarizer preflight、`nextStep` | 走新的 `summaryStateOf`，错误码不变 |

- 审稿与 settler 的输入不接摘要：review 生命周期归 #52，S2 不改审稿 prompt；合同 v2 的摘要消费者表述同步为“brief/检索/read/export/settle 在 S2 消费，reviewer/settler 归 #52”。

### 4. 边界

- 没有旧作品：`summaries` 行不再读，也不设计旧行回退；测试作品删除重建。
- `summaries` 表留在 v6 schema，不再写、不再读；删表随下一次作品 schema 版本；`applyChapterMapping` 对空表的改名循环保留到删表时。
- 章节删除/移动的摘要重映射沿用 S1b，不新增规则。
- 不改 `reviews`、observation、reviser 与审稿阶段机。

## 备选方案

- **结构化摘要并进 settler**（参考实现方式）：我们的 settle 是摘要之后的独立阶段，合并会把摘要与 #52 的 review 生命周期耦合；否决。
- **保留 `{summary: string}` 提交、host 解析结构**：要求 child 输出可解析的固定格式，脆弱且多一层格式契约；否决。
- **结构字段不设上限**：摘要 payload 会翻倍并挤占写前上下文；否决。
- **用 artifact revisionId 判 stale**：revision 是内容哈希，正文变化不会改它；否决，必须用 `bodyRevision`。
- **迁移旧 `summaries` 行为 artifact**：属旧作品迁移，全项目统一不做；否决。
- **S2 顺带把摘要接进 reviewer/settler**：与 #52 的 prompt 改造重叠，会二次改审稿输入；否决，归 #52。

## 后果

摘要写结构化 `summary:<n>` 并绑定正文 revision，过期由消费者识别。

## 验证

实际验证：summary/revision 测试与 `ci --no-e2e` 通过；证据见 #57。

1. 摘要只写 `summary:<n>`；测试断言 `summaries` 写入为 0。
2. 委派 summarizer 提交结构字段后落盘 ChapterSummary；`chapter`/`bodyRevision` 由 host 盖章，child 伪造值被忽略。
3. 手动 `story_summarize` 写 `rawText` + 空结构 + 当前 `bodyRevision`；超过 400 字截断并回执 `truncated`。
4. 正文 rewrite/revise 后 summaryState 变 `stale`，settle 返回 `summary-stale`；重新摘要后 `current`。
5. 消费者全部从 artifact 读：brief、context、检索候选、facts 白名单、`readChapter`、`story_read`、导出、`readWork`/`status`/manifest。
6. `story_read(summary:n)` 返回 ChapterSummary JSON 与 registry revisionId；旧 revision 可读；无摘要 `summary-not-found`。
7. 结构字段进 FTS 文档、不进 prompt；`rawText` 400 与结构字段 120 的上限可测。
8. 章节删除/移动后摘要随章号重映射（复用 S1b 覆盖）。
9. `summary-consumers.test.mjs` 覆盖上述路径；更新 `summary-binding`、`bible`、`volumes`、`tools`、`export-atomic`/`export-backup`、`state-check`/`state-settle`、`delegate`、`store-chapter` 中受影响断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
10. 不改 reviews/observation；不迁移旧作品；不新增旧格式兼容。

## 风险

- 结构字段由模型生成，可能与 `rawText` 重复；限制在 FTS 与 120 字上限内。
- 摘要缺失时面板显示 `missing`，不能静默当作已摘。
- 投影字段名 `summaryRevision` 表示正文版本，artifact revisionId 是内容哈希；两处文档与 schema 注释必须写清，否则消费者会拿错。
- 摘要 FTS 文档与产物 revision 同步更新，避免同一摘要出现重复命中。
