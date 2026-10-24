---
title: 故事工坊：L-R10a 生产者/消费者迁移
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a 生产者/消费者迁移

## 问题

A0 已交付 v6 artifact registry 与 typed 读写，但生产动作仍写旧表：`writePlan` 写 `chapter_plans`，`writeSummary` 写 `summaries`，settler/state 写 text-hook/string-fact，review 写旧文本。foundation（story_frame/volume_map/book_rules/roles）没有生产动作。新 artifact 目前只有测试在写，brief/context/检索/审稿/结算/导出仍走旧结构，`#45` 验收 4 的“真实消费者”没有生产链路。

路线图的 A0 退出条件是合同/初始化；L 才要求“长篇产物、角色、技能、消费者、重建测试全过”。本 Note 拥有 L 的第一段：按 artifact 把生产者与消费者迁到 v2，并明确哪些产物在 A0 只交合同、由后续阶段验收。

## 与既有记录

- 产物字段、权威与消费者表由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 拥有；本 Note 只拥有**迁移顺序、生产者/消费者切换点、旧结构退役与延期归属**，不重写字段合同。本 Note 部分替代该 Note 验收 4 的“A0 内完成真实消费者”，改为按下方矩阵分工。
- 路线图 [`2026-10-19-storycraft-roadmap.md`](../workspace/2026-10-19-storycraft-roadmap.md) 拥有 L 的范围与退出条件；#44 是 R10b（architect 生成 foundation），#51 是本 Note 的 R10a。
- R11 的 [`2026-10-23-storycraft-settler-auto-projection.md`](../../implemented/pipeline/2026-10-23-storycraft-settler-auto-projection.md) 的“审稿→修订→摘要→settle”顺序与一次重算规则保留；其 settler payload `{entities,hooks}` 与 `foldState` 的阶段/事件写入由 S3 **部分替代**。替代理由：v2 合同要求 hookOp/factOp 与 fact 有效期，旧 payload 无法表达；R11 的旧引用不进入新作品。
- R6a 的 [`2026-10-23-storycraft-longform-method-references.md`](../../implemented/pipeline/2026-10-23-storycraft-longform-method-references.md) 已部分替代；R10a 不改方法正文。

## 提案

### 1. 边界与 #45 AC4 的归属

A0 只负责字段合同、v6 registry、消费者映射与可测试的消费契约；真实生产者/消费者按下表由 L/S/D/R12 验收。#45 可在 A0 合同与映射交付后关闭，不再把“真实消费者”算作 A0 的完成条件。

| A0 产物 | 真实消费者 owner | 说明 |
| --- | --- | --- |
| world / style / intent / outline | L-R10a S4a | `bible` 表迁移；brief/context/检索/导出 |
| characters | R10b 生产 roles index/card + S4b 消费 | 本段保留 `bible.characters` 只读 |
| current_focus | R10b | 当前无生产者；R10b foundation 产出后接消费 |
| story_frame / volume_map / book_rules | R10b 生产 + L-R10a S4b 消费 | 计划与规则；brief/context/检索/审稿/结算/导出 |
| roles index / role card | R10b 生产 + L-R10a S4b 消费 | brief 人物段、检索、审稿、结算、导出；本段保留 `bible.characters` 只读 |
| ChapterMemo `plan:<n>` | L-R10a S1 | `story_plan` 生产；brief/context/read/export/审批 |
| ChapterSummary `summary:<n>` | L-R10a S2 | summarizer / `story_summarize` 生产；brief/检索/settle/read |
| hooks / facts | L-R10a S3 | settler/`story_state` 生产；brief/state-check/settle |
| observation | #52（延期切片） | `reviews` 轮次/阶段机迁移需要单独合同；本段不声称已完成 |
| context / trace | R12 | A0 只交字段合同 |
| short_story / script | S / D | 独立流水线与验收 |
| volume / material / export / backup | 现有表/路径 | R10a 不迁移；A0 只登记 ID/envelope |
| storyboard / interactive_film / play_world / cover / translation | R8 | A0 只登记 kind/envelope |

### 2. 切片

每个切片一次切换一个产物组：生产、读取、测试、导出在同一提交完成；旧结构在成功切片后不再写、不再读。

**S0 章节编辑的非 artifact 部分**

- 删除、移动、重排章节时，只处理 chapters/versions、v2 hook/fact 事件字段与检索文档等非 artifact 数据；并对被删章/每个 `old !== new` 章无条件清空 `plan_revision`/`plan_approved_at`（无 artifact 也清）。这些是既有章节编辑行为，本切片不新增。
- **按章 artifact（plan/summary/review）的重映射归 S1b**，[Note](2026-10-24-storycraft-chapter-artifact-remap.md) 是唯一 owner；context/trace 的 ID 方案归 R12，在此之前只同步 `scope_chapter`；state 是作品级，不参与；S0 不拥有 memo/artifact remap。
- 测试：`store-chapter` 保留章节/事件用例；artifact 生命周期用例归 S1b。

**S0.5 检索与导出基础设施**

- artifact 写入时同步检索文档；导出提供统一的 artifact 投影，供 S2/S4 在各自切片内接入；memo/章节 artifact 导出归 S1a-demo/S1b，不在 S0.5 重复。
- 测试：`artifact-export.test.mjs`（索引同步、删除清理、导出 ID/内容）。
- 该切片先于 S2；S2/S4 不再各自造一套导出。

**S1 ChapterMemo**

- `story_plan` 写 `plan:<n>`；`goal` 必填；`body` 与 `threadRefs` 数组按 ChapterMemo 合同必填（`threadRefs` 可为空）；`perspective/obstacle/cost/turn` 在 artifact contract 可选，但 `story_plan` action 继续要求五项。旧调用方同步更新，缺失按 `plan-incomplete` 拒绝。
- 新增单一渲染器 `renderChapterMemo(memo)`（归属 `artifact-store.js`）：把 memo 渲染为读者/旧消费者需要的 Markdown（视角/目标/阻力/代价/结尾变化 + body）；brief/context/read/export 只通过渲染器取文本。
- 迁移 `chapter_plans` 全部 call site，至少包括：`story_plan`、`approveChapterPlan`、`writeChapter`、`nextStep`、`readWork`、`status`、`readChapter(view:'plan')`、`story_read`、`context.js`、`bible.js`、`facts.js`（readPlan）、export、`verifyObservationSources`。实施 ticket 必须再 grep 全仓 call site。
- `story_read`/`artifactRef` 对新 artifact 使用 registry 的 `revisionId`，不再用渲染文本的内容哈希；否则写入与读取 revision 不一致。
- 旧 `chapter_plans` 不再写、不再读。
- 测试：`memo-consumers.test.mjs`（写入、渲染、批准绑定、brief/context/read/export、改写失效、revision 一致）。

**S2 ChapterSummary**

- summarizer 提交结构化 `ChapterSummary`：title/characters/events/stateChanges/hookActivity/mood/chapterType/bodyRevision/rawText；`bodyRevision` 绑定当前正文版本，stale 判定必须用它。
- `story_summarize` 手动回退至少写 `rawText` 与 `bodyRevision`，结构字段允许空字符串。
- 迁移 `summaries` 全部 call site，至少包括：`assembleBrief`、`listSummaries`、`readChapter(view:'summary')`、`story_read`、`facts.js`、`context.js`、`assertStateGate`、`state-check`、`state-settle`、`readWork`/`status`、export。实施 ticket 必须再 grep 全仓 call site。
- `story_read`/`artifactRef` 同样使用 registry revisionId。
- 旧 `summaries` 不再写、不再读。
- 测试：`summary-consumers.test.mjs`（结构化写入、bodyRevision stale、brief/settle/检索/export、revision 一致）。
- 生产/消费细节、提交形状与旧数据边界见 [L-R10a S2 ChapterSummary 迁移](2026-10-24-storycraft-summary-migration.md)。

**S3 hooks / facts**

- settler 提交 `{hookOps, factOps}`；`story_state` 手动动作也写 v2 事件；`state-events.js` 是唯一投影。
- **一个共享 settle writer**：抽取/改造 `settleChapterState` 的核心为 `settleState`，同时服务自动 `story_settle` 与手动 `story_state`；它负责状态门禁、写 hook/fact 事件、写 `settle` 标记、设置 `stage='settled'`。`foldState` 不再承担 stage，删除或仅供旧测试；`appendStateEvent` 只负责底层事件。
- `state-check`/`state-settle` 的 prompt、schema、校验改为 v2；旧 `state-validation.js` 的 `normalizeStateDelta`/`foldState` 不再被动作导入。
- 迁移状态读取消费者：`readWork`/`status`/`foldedOf`/`foldEvents` 改读 v2 投影（面板不能显示零实体/零伏笔）；`facts.js`、`bible.js`、`context.js` 的 `readEventsText`/`readFoldedState` 同样改读 v2。
- 旧 text-hook/string-fact 事件不再写、不再读；旧事件仍留在库里但被当作历史忽略。
- 测试：`state-v2-settle.test.mjs`（ops、投影、自动/手动 settle、面板/ brief/context 消费、非法转移、旧事件忽略）。
- 提交面、settle writer 边界、消费者切换与旧数据边界见 [L-R10a S3 hooks/facts 迁移](2026-10-24-storycraft-state-migration.md)。

**S4a bible 条目迁移**

- `world`/`style`/`intent` 从 `bible` 表迁到 `bible:<name>` artifact；`story_bible_write` 生产、brief/context/导出消费。
- `outline`/`bible('plan')` 迁到 `outline` artifact；`writeOutline` 生产、`approveOutline` 绑定、brief/context/export/`story_read` 消费。
- `characters` 不在本切片迁移：六字段 characters 无法满足 roles index 的 `tier` 与角色卡字段；R10a 保留 `bible.characters` 只读，R10b 生产 roles index/card 后由 S4b 接消费。
- 旧 `bible` 表的 world/style/intent 与 `bible('plan')` 不再写、不再读；`characters` 延到 R10b，`bible` 表如保留只作历史。
- 测试：`bible-consumers.test.mjs`（world/style/intent、outline、导出、characters 行不被误删）。
- 存储、生产者、消费者、版本语义与旧数据边界见 [L-R10a S4a bible 条目迁移](2026-10-24-storycraft-bible-artifacts.md)。

**S4b foundation 消费**

- story_frame/volume_map/book_rules/roles 的消费段接入 brief/context/检索/审稿/结算/导出；生产归 R10b；current_focus 由 R10b 产出。
- 新增段必须纳入 `TRIM_ORDER` 与保护级别：story_frame/book_rules 为 protected，volume_map/roles 按预算 compressible；不得让 8KB 预算静默溢出。
- 测试用 `writeFoundationDocument` 写真实 artifact 验证消费，不只测 absent；R10b 后再补生产端测试。这不是“A0 假消费者”：R10b 是明确的后续生产者，#50 在 L 完成后验收。
- 测试：`foundation-consumers.test.mjs`（foundation 段、审稿/结算约束、预算裁剪、导出）。
- 段顺序、保护裁剪、roles 回退、检索 kind 与导出树见 [L-R10a S4b foundation 消费](2026-10-24-storycraft-foundation-consumers.md)。

### 3. 不双写与回退

- 每个切片的生产者与消费者在同一提交切换；运行时不存在“新旧双读”。
- 切片失败时回退该切片的代码提交，旧路径整体恢复；不允许在运行中保留双写或双读。
- 旧表可以暂时留在 v6 schema 中但不写不读，作为后续清理项；不新增旧格式消费者。

### 4. 延期的 owner

- **observation / reviews**：本段不迁移，由 **#52** 拥有。`writeReview`/`reviews` 仍是审稿轮次与阶段机的现行来源；reviser 已能读 observation artifact，但生产者与“已处理/已解决”语义需要单独合同。`reviews` 在本段**不退役**，不得声称 observation 生产链已完成。
- **context / trace**：R12；A0 只交合同。
- **short_story / script**：S/D；不写长篇章表。
- **current_focus**：R10b。
- **R8 产物**：只登记 kind/envelope。

## 备选方案

- **A0 内只做消费路径 + 种子测试**：测试能读、生产不写，AC4 名实不符；否决。
- **双写新旧结构**：违反产物合同 v2 的“不保留旧格式双写”，也让 stale 判定复杂；否决。
- **一次迁移全部产物**：失败面过大、无法逐段验收；改为按产物组切片。
- **保留旧表读取作为回退**：会长期双源；旧路径只在回退提交中恢复，不在运行时并存。
- **把 observation 与 reviews 一起并入本段**：需要新增 observation ID/解决语义与审稿轮次合同，超出本段；单独立项。

## 验收条件

1. 每个切片的生产者只写新结构；该切片的旧表/旧事件不再写、不再读（observation/reviews 明确除外）。
2. 每个 artifact 有**具名消费者**，不是“某个通道命中一次”：
   - memo → brief 章纲、context writer、`story_read`/`readChapter(view:'plan')`、export、审批绑定；
   - summary → brief recent/previous、`story_read`/`readChapter(view:'summary')`、settle 摘要门禁、检索；
   - hooks/facts → brief 未解伏笔、state-check、settle；
   - world/style/intent/characters/outline/foundation → brief/context、检索、审稿/结算、导出；
   - observation → reviser（已存在，生产迁移归 #52，不属本段）。
3. 章节删除/移动/重排后 artifact 与检索文档同步，测试覆盖旧 ID 不可读、content.chapter 与 ID 一致。
4. 每个切片有正常、缺产物、失败回滚、消费者测试；命令为 `node storycraft/scripts/ci.mjs --no-e2e`，并新增/更新对应 `*.test.mjs`。
5. #51 只验收“seeded artifact 下消费路径可用”；foundation/current_focus 的真实生产由 #44 R10b 验收，不作为 #51 的关闭条件。
6. #50 在 L 完成后一次性跑真实链路；R10a 不单独跑真实模型。

## 风险

- 迁移期间旧表仍在 schema 中，容易被误读；用测试断言“不再写/不再读”锁住。
- 结构化摘要依赖 summarizer 输出质量；dev 测试只验契约，真实质量由 #50/作者验收。
- hooks/facts 迁移与 R11 的 settle 顺序强耦合，必须一次切片完成，不能半迁移。
- observation/reviews 延期会让审稿阶段机暂时保留旧结构；必须在 #45/路线图中写明 owner，避免被当成已迁移。
- foundation 段新增受保护上下文会挤占 8KB 预算；S4 必须先定 TRIM_ORDER 与降级顺序。
