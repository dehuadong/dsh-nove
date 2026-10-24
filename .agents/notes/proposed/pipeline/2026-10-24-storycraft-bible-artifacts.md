---
title: 故事工坊：L-R10a S4a bible 条目迁移
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a S4a bible 条目迁移

## 问题

`bible` 表同时存五件真值：world / characters / style / plan / intent。world/style/plan/intent 是作者可编辑的长文本，却和 characters 的六字段 JSON 挤在同一张无 revision 语义的表里：内容哈希没有，历史版本不可读，检索与导出按表行直接投影。

A0 已登记 `world`/`style`/`intent`/`outline` artifact 与消费矩阵，但生产者仍写 `bible` 表。S4a 把四个文本条目切到 artifact，`bible` 表只保留 characters（角色索引/卡由 R10b 生产）。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect-tool.ts`：foundation 由 architect 产出 `storyFrame`/`volumeMap`/`bookRules`/角色索引与卡，是带确认闸门的结构化工件；`FoundationOutlineToolSchema` 直接提交可读 Markdown。
- `inkos-master/packages/core/src/pipeline/runner.ts`：foundation 与全书计划落成文件 `story/outline/story_frame.md`、`story/outline/volume_map.md`，另有 `story/style_guide.md`、`story/author_intent.md`、`story/brief.md`；导出与备份按文件树复制，不按数据库行投影。
- `inkos-master/packages/core/src/harness/builtin-profiles.ts`：artifactKind 里有 `foundation`，说明参考实现把 foundation 当作一等工件，而不是“若干真值行”。
- 我们的裁决：**采纳**“foundation/outline 是一等工件、可读 Markdown 为正交内容、有作者确认”；**等价适配**为 artifact registry 的 `world`/`style`/`intent`/`outline`（内容哈希 revision，可读历史）；**不采纳**参考实现的整目录文件树权威——我们的工作库是 SQLite，文件只在导出时生成。
- 参考实现的 story_frame/volume_map/book_rules/roles 生产归 #44（R10b），本项只迁移作者可编辑的四个文本条目；foundation 消费归 S4b。

## 与既有记录

- 切片排序与 owner 由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 承接其中 S4a。
- 字段与 ID 由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 拥有：`world`/`style`/`intent`/`outline`，artifactId 前缀沿用 `bible:world` 等与 `outline`。
- 作者闸门（outline 确认）沿用 #15 与 #55 的“模型不能代签”；本 Note 不改变闸门位置，只改变存储。
- characters 的六字段合同与 `bible_write` 校验仍归现有实现（`bible.js` 的 `validateBibleContent` 与 README 的真值说明）；S4a 不迁移它。
- foundation（story_frame/volume_map/book_rules/roles）消费归 S4b，生产归 #44；本项不写这四类 artifact。

## 提案

### 1. 存储与生产者

| 条目 | 权威 | 生产者 |
| --- | --- | --- |
| world | `world` artifact（Markdown） | `story_bible_write` / `story_bible_import` |
| style | `style` artifact（Markdown，含受管样例块） | `story_bible_write` / `story_style_extract` |
| intent | `intent` artifact（Markdown） | `story_bible_write` |
| 全书计划 | `outline` artifact（Markdown） | `story_outline` |
| characters | `bible` 表的 `characters` 行（六字段 JSON） | 保持现状；roles 由 R10b 生产 |

- 四个文本 artifact 用 `kind` 同名、`artifactId` 为 `bible:world`/`bible:style`/`bible:intent`/`outline`，`revisionId` 为内容哈希；内容统一加尾部换行后入 registry。
- 每次写入生成新 revision；旧 revision 可读（`story_read` 按 ID 与 revisionId），不做原地覆盖。
- `writeOutline` 在同一事务内写 outline artifact 并更新 `meta.outline_written_at`、清空 `outline_approved_at`；`approveOutline` 只记录确认时间。**不新增 `outline_revision` 列**：outline 的唯一写入口就是 `story_outline`，写入即清批准，时间戳就足以表达“确认的是当前文本”；无需 schema 升级。
- `story_bible_write` 的 `file` 枚举保持 world/characters/style/intent；`plan` 仍禁止经它写入（全书计划只走 `story_outline` + 作者确认）。
- `story_style_extract` 写 style artifact，受管样例块的合并/去重逻辑不变。

### 2. 读取与消费者

| 消费者 | 切换 |
| --- | --- |
| `story_bible` | world/style/intent 读 artifact；characters 读表；`plan` 读 outline artifact |
| brief 的 intent/style/plan 段 | 从 artifact 渲染；虚拟路径保持 `bible/world.md`、`bible/style.md`、`bible/intent.md`、`outline/plan.md` |
| `context.js` 的 authority 段 | 同上 |
| 检索 | `world`/`style`/`intent`/`outline` 加入 `MEMORY_KINDS`，FTS 文档 kind 同名、doc id 用 artifactId；`card:characters` 不变 |
| `story_read` | `bible:world`/`bible:style`/`bible:intent` 读 artifact 最新或显式 revision；`outline` 读 outline artifact |
| 导出 | `bible/world.md`、`bible/style.md`、`bible/intent.md`、`bible/characters.json`、`outline/plan.md`（全书计划）从 artifact 投影；`outline/<n>.plan.md` 仍是章节 memo；不再写 `bible/plan.md` |
| `story_bible_import` | world 写入 world artifact；不导入 outline/characters（现状保持） |
| 面板 | 真值编辑区按 artifact 内容读写；显示 `bible` 只剩 characters（文案不把 plan 列成可编辑项） |

- `readBible`/`readBibleMap` 保留返回形状（`{name, content, version}`），`version` 改用 artifact revisionId（字符串）；`writeBible` 的内部 `expectedVersion` 与最新 revisionId 比较，冲突仍返回 `bible-conflict`；工具输出 schema 的 `version` 同步为字符串。
- 错误码保持：`bible-missing`、`bible-invalid`、`outline-required`、`outline-not-approved`；artifact 层新增错误按 registry 既有码（`artifact-not-found`/`artifact-invalid`）透传。

### 3. 旧数据与边界

- 不迁移旧作品：`bible` 表的 world/style/plan/intent 行不再读，旧作品的这四个条目显示为空、需要重新填写；characters 行继续有效。与 S2/S3 的旧数据边界同一口径。
- `bible` 表保留（characters 仍用），不删列、不改 schema；world/style/plan/intent 行成为历史。
- 不写 foundation 四类 artifact（S4b/#44）；不改 characters 字段合同；不改 outline 闸门位置与“模型不能代签”。

## 备选方案

- **继续用 bible 表 + 加 revision 列**：同一张表继续混两种形状，且无法给 world/style/intent 独立 ID；否决。
- **outline 也留在 bible 表，只迁 world/style/intent**：闸门与导出仍走两套路径；否决。
- **新增 `outline_revision` 列做批准绑定**：需要作品 schema 升级与旧库迁移，而 outline 只有单一写入口、写入即清批准，时间戳已足够；否决，避免无收益的 v7。
- **把 characters 也搬成 `role_index`/`role_card`**：characters 的六字段与 roles 的 tier/卡片不同构，生产归 R10b；否决（S4b/#44）。
- **迁移旧 bible 行**：全项目不做旧作品迁移；否决。
- **参考实现的整目录文件权威**：我们的工作库是 SQLite，文件只是导出产物；否决。

## 验收条件

1. world/style/intent 只写 artifact、不写 `bible` 表；characters 仍写表；`bible` 表不再出现 plan 行写入。
2. 四类 artifact 的 revisionId 是内容哈希；旧 revision 可读；同内容重复写入是幂等 no-op。
3. `story_outline` 写 outline artifact 并清批准；`approveOutline` 后闸门通过；再写 outline 使批准失效（`outline-required`/`outline-approval` 语义保持）。
4. `story_bible`/`story_bible_write`/`story_style_extract`/`story_bible_import` 的读写都落在 artifact（characters 除外），错误码不变。
5. brief/context/检索/导出/`story_read` 消费 artifact；虚拟路径与现有测试口径一致。
6. 导出目录含 `bible/world.md`、`bible/style.md`、`bible/intent.md`、`bible/characters.json`、`outline/plan.md`，内容来自对应 artifact。
7. 旧 `bible` 行的 world/style/plan/intent 不再被读取；characters 行继续生效。
8. `bible-artifacts.test.mjs` 覆盖生产、revision、闸门、消费者、导出、旧行忽略；更新 `bible`/`tools`/`storage`/`foundation-chapter-artifacts`/`export-*`/`retrieval`/`context` 中受影响断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
9. 不写 foundation 四类 artifact；不改 characters 合同；不做旧作品迁移；不改闸门位置。

## 风险

- 旧作品的 world/style/intent/plan 显示为空，作者需要重填；面板要说明原因，不能静默当“未填”。
- outline 批准仍是时间戳绑定：若将来出现第二个 outline 写入口，必须补 revision 绑定；本项以“唯一写入口”为前提。
- 检索把四类文本加入 FTS 后，短作品可能出现摘要/真值重复命中；需要类目上限沿用现有 per-kind 规则。
- characters 与四类 artifact 的读写路径分叉，`readBible` 的返回形状虽不变，实现要避免两套缓存/两套错误码。
