---
title: 故事工坊：素材标题索引
status: implemented
created: 2026-10-22
updated: 2026-10-22
verification: 29 单测 + 13 E2E；真实雪线邮路 v4→v5、标题命中/重命名失效；清理后 schema v5
---

# Agent Note：故事工坊：素材标题索引

## 问题

素材的 FTS tokens 只来自正文，标题只在 `searchMemory` 的结果前缀展示。标题词不在正文时，`search`/`searchMemory` 找不到素材；重命名标题也不会改索引。

B2/B4 已让素材正文进入 context/brief，B3 已有用途筛选；本项只补标题索引，不新增检索源。

## 决定

### 1. 共享分词

- 新增纯模块 `search-text.js`，导出 `searchTokens(text)` 与 `materialIndexText(title, content)`（`title + '\n' + content`，换行是分词边界，import/rename/migration 共用）；
- `store-db.js` 重新导出 `searchTokens`，保持现有 `storage.searchTokens` 调用不变；
- `db.js` 迁移直接 import 该纯函数，避免从 store 反向依赖。

### 2. 索引文本

- 素材搜索文档：`tokens = searchTokens(title + '\n' + content)`，`body` 仍是 content；
- `syncSearchDoc(db, ..., body, indexText = body)` 增加可选索引文本；
- 导入素材传 `title + '\n' + content`；
- 重命名标题后重建该素材的搜索文档（同 content/source，indexText 用新标题）；
- 改用途不重建；删除照旧 drop。

标题命中时，`searchMemory` 的候选文本仍是“标题前缀 + 正文片段”；如果正文不含查询词，片段从开头截取，标题在前缀里仍可见。空标题按 `tokens = 正文` 处理；测试用“标题独有词、正文不含”的夹具，并按 material id 断言，避免同名标题的另一份素材干扰。

### 3. schema v4→v5

- `WORK_SCHEMA_VERSION` 4→5；
- v3→v4 步骤只 stamp **4**（不再 stamp 最终版）；新增 v4→v5 步骤：
  1. 从 `materials LEFT JOIN search_docs` 取每份素材（缺文档的也补建），拿 title/body/doc_id/tokens；
  2. 用 `materialIndexText` 生成新 tokens，更新/插入 `search_docs`（缺失文档补建，body=content、source=`materials/<id>`、chapter=0）；
  3. 执行 `INSERT INTO search_fts(search_fts) VALUES('rebuild')`，再 stamp 5；
- 失败整事务回滚到进入版本（v1–v3 链式时回到起始版本），FTS 与 `search_docs` 保持一致；
- `openWork`/`migrateWorkSchema` 接受 1–4；v1–v3 链式经过 v4/v5；
- 新库直接用 v5；material 表形状不变。

### 4. 与既有记录

- **部分替代 B1** [material-ingest](../../implemented/pipeline/2026-10-21-storycraft-material-ingest.md) §6/§7：重命名会重建索引；“标题不索引”失效。
- **补充 B2** [unified-retrieval](../../implemented/pipeline/2026-10-22-storycraft-unified-retrieval.md) §1/风险与 `material.test:43`：标题可搜；正文片段规则不变。
- **补充 B4** [brief-retrieval](../../implemented/pipeline/2026-10-22-storycraft-brief-retrieval.md)：brief 的候选现在含标题命中；用途筛选不变。
- **补充 B3** [material-purpose](../../implemented/pipeline/2026-10-22-storycraft-material-purpose.md) 与 #18 [sqlite-store](../../implemented/pipeline/2026-10-19-storycraft-sqlite-store.md)：库版本 v4→v5；导出仍 v4。
- README 删除“素材标题暂不索引/标题本身不建索引”，schema 改 v5，模块清单加 `search-text.js`；`package.json.files` 同步。

### 5. 边界

- 导出 manifest 仍 v4，不新增字段；
- **文档/打包**：README 的 schema v5、去除“标题不索引”、模块清单加入 `search-text.js`；`package.json.files` 加入 `search-text.js`；B1 §6/§7、B2 §1/risk、B4 §1 标记部分修订；B3/#18 的 v4 文案补 v5。
- `story_context`/`brief` 不改代码，标题命中自动进入候选；
- 不改变 `search()` 返回的 body（仍是正文）；
- 不做标题高亮；标题只在既有前缀里。

## 备选方案

- **标题单独 LIKE 查询**：排序与 FTS 分数不可比，且 snippet/去重复杂；否决。
- **把标题写进 body**：会改变 `search()` 返回原文和导出/上下文文本；否决。
- **每次检索时临时拼标题**：无法用 FTS 命中标题；否决。
- **不升 schema，导入新素材时新索引、旧作品不补**：旧作品标题仍不可搜，验收不完整；否决。

## 后果

产品验收在 #31；本 Note 检查技术性质：

1. 标题词可命中 material；`searchMemory` 文本仍含标题与正文片段。
2. 重命名后旧标题词失效、新标题词命中；内容/哈希/用途不变。
3. v4→v5 更新 tokens 并 `rebuild`；v1/v2/v3 链式迁移；失败回滚且 FTS 与 docs 一致；用旧标题词 0 命中、正文词命中来断言，而不是只看 integrity-check。
4. 导出 manifest 仍 v4；`story_context`/`brief` 不改代码。
5. 迁移与 200 章+512KB 素材检索在现有 400ms 边界内；迁移夹具含 1 条 512KB 素材，单独计时。
6. `material.test`/`migration.test`/`bible.test` 覆盖；E2E 不新增；`package.json.files` 加入 `search-text.js`。
7. README 的“标题不索引”文字被删除；B1/B2/B4/B3/#18 的反向指针与 v5 文案同步。

## 风险

- 迁移会重写所有 material 搜索文档；大量素材时耗时，但只一次。
- 标题与正文都被索引，同一词可能提高分数；排序仍是 bm25。
- 标题命中但正文不含查询时，片段可能从开头截取；可接受。
- v5 让旧插件拒绝打开；升级插件即可。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- 迁移：v4→v5（512KB 素材，<400ms）、缺失搜索文档回填、失败缺 FTS 回滚 v4、v1/v2/v3 链式。
- `material.test`：标题/正文均可命中；重命名后旧词失效、新词命中，hash/purpose 不变。
- `bible.test`：标题独有词进入 brief 候选。
- 真实 `雪线邮路`：v4→v5；标题 `紫电河` 命中；重命名 `青石桥` 后旧词失效；删除后 0 行、副本清理，schema v5。
