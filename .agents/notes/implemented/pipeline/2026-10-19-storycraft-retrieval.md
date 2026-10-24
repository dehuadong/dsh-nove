---
title: 故事工坊：检索召回的设计（纯 JS BM25）
status: implemented
created: 2026-10-19
updated: 2026-10-21
verification: FTS5 检索与 BM25 排序已落地，search 测试与 CI 50 个单元文件通过；证据见 #16。
---

# Agent Note：故事工坊：检索召回的设计（纯 JS BM25）

> 2026-10-21 被 [基于作品库 FTS5 的上下文检索](../../implemented/pipeline/2026-10-21-storycraft-retrieval-fts.md) 取代：语料、排名与索引改为作品库 FTS5；本记录只保留段位置、预算与 trace 的历史依据，角色查询表与开启条件以 #16 为准。
>
> 2026-10-19 暂停：作品入库方案（#18）改变了语料来源，本记录的 corpus/纯 JS 部分待 #18 后重写；只有段位置、预算与 trace 继续有效，排序以新 Note 为准。

## 问题

`story_context` 的「最近脉络」只覆盖最近 3 章；早期伏笔、旧场景与人物细节无法按需召回。参考实现用 FTS + BM25；我们不引入 SQLite 或第三方依赖。

## 决定

### 语料收集：新 `corpus.js`

现有 `context.js` 只读最近 3 章摘要，`foldEvents` 又把事实折叠成无章号的字符串，所以**不复用**它做检索语料。新增：

```
corpus.collect(root, work, { beforeChapter, role })
```

- 摘要：`chapter < beforeChapter` 的章；无 target 时取全部有正文的章；
- 事实：直读 `state/events.jsonl`，entity/hook 事件均带 `chapter` 与 `seq`；只保留 `chapter < beforeChapter`（无 target 时全部），并按章只取最后一次 `reopen` 之后的事件；
- 伏笔：只取**未解**（`state !== 'resolved'`）且 `chapter < beforeChapter`；
- 卷摘要：只取 `to < beforeChapter` 的卷（无 target 时全部）；
- 人物卡：仅当 `role === 'planner'` 时加入。

片段结构 `{id, source, text, chapter}`，id 唯一：

| 来源 | id |
| --- | --- |
| 摘要 | `summary:ch-0007` |
| 事实 | `entity:<seq>:<factIndex>` |
| 伏笔 | `hook:<seq>` |
| 卷 | `volume:<id>` |
| 人物卡 | `card:<name>` |

`context.js` 调 `collect`，把结果传给 `retrieval.rank`；根目录运行时 `.js` 由 `package.json` 的 `*.js` 覆盖，无需逐条列 `files`。

### 查询与位置

查询文本按角色取，`trace.retrieval.query` 记录同一份文本：

| 角色 | 查询 | 段位置 |
| --- | --- | --- |
| 写手 | 本章章纲 + 作者要求 | 「最近脉络」之后、「文风」之前 |
| 规划（章级/作品级） | 任务说明 + 作者要求 | 同上 |
| 审稿 | 本章章纲 + 未处理条目 | 「最近脉络」之后、「审稿标准」之前 |
| 修订 | 未处理条目 + 模式 | 「最近脉络」之后、「修订标准」之前 |

### 排名：`retrieval.js`

纯函数 `rank(query, fragments, {limit})`，不读文件。CJK 二元 + 一元（一元权重 0.5），拉丁词按空白/标点；BM25 `k1=1.2, b=0.75`；至少一个词重叠才入选；同分按 `chapter` 降序、`id` 升序。

### 段、裁剪与轨迹

- 段 `retrieval`，compressible，但**只做整条丢弃、不做字符级压缩**：按分数从低到高丢弃，直到 ≤1200 字且 ≤5 条；`context.js` 的字符压缩分支必须跳过该段；
- 裁剪顺序 `retrieval → recent → state → characters → style`；`retrieval` 仍可被整段丢弃；
- `trace.retrieval = {enabled, query, candidateCount, hits:[{id, source, score, sent}]}`：`enabled` 表示是否满足开启条件，`candidateCount` 是重叠过滤后的候选数，`sent` 表示该条是否在最终文本中；禁用或零命中时仍返回该结构（`hits: []`）。

### 开启条件

- 作品里 `currentRevision > 0` 的章数 ≥3；
- 章数不足时 `enabled: false`，不加段。

## 备选方案

- **SQLite FTS5**：依赖与版本风险；否决。
- **向量检索**：需要嵌入模型；否决。
- **检索正文全文**：体积与噪声大；否决，先用摘要与事实。
- **复用 foldEvents 的实体**：丢章号、且被客户端状态 UI 依赖；否决，改为 corpus 直读事件。
- **持久化索引**：暂缓，性能验收兜底。

## 后果

检索段由 FTS5/BM25 提供，`story_context` 与素材检索使用同一索引；未引入语义重排。

## 验证

实际验证：`search.test.mjs` 与 `ci --no-e2e` 50 个单元文件通过；证据见 #16。

产品行为与验收由 #16 拥有。本设计只证明以下实现性质：

1. 分词、排序、同分次序与确定性由 `retrieval.test` 覆盖；
2. `corpus.collect` 的章号过滤（摘要/事实/伏笔/卷）、重开过滤、角色开关与 id 唯一性由 `corpus.test` 覆盖；
3. `context.test` 更新旧断言（fixture 需有 ≥3 章正文，`dropped[0]` 从 `recent` 改为 `retrieval`），并覆盖 `retrieval` 段的整条丢弃与 `trace.retrieval.sent`；
4. `node scripts/decisions/check.mjs` 通过。

## 风险

- 200 章需读约 199 个摘要文件，增量主要是 I/O；收集与排名合计计入 400ms；
- 一元 + 二元增加索引体积；
- 检索段挤占预算，命中率靠 trace 观察。

## 与既有记录的关系

- 扩展 #12 的上下文契约：新增段与裁剪顺序；实现落地时同步 #12 记录。
- 白名单规则不变：检索片段不参与派生。
- 路线图 R5 的触发条件与实现方式由本项更新。
