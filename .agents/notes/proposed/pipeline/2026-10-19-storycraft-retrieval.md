---
title: 故事工坊：检索召回的设计（纯 JS BM25）
status: proposed
created: 2026-10-19
updated: 2026-10-19
---

# Agent Note：故事工坊：检索召回的设计（纯 JS BM25）

## 问题

`story_context` 的「最近脉络」只覆盖最近 3 章；早期伏笔、旧场景与人物细节无法按需召回。参考实现用 FTS + BM25；我们不引入 SQLite 或第三方依赖。

## 提案

### 语料收集：新 `corpus.js`

现有 `context.js` 只读最近 3 章摘要，`foldEvents` 又把事实折叠成无章号的字符串，所以**不复用**它做检索语料。新增 `corpus.js` 负责收集：

- 摘要：读 `summaries/*.md` 中 `chapter < target` 的章（无 target 时读全部）；
- 事实：直接读 `state/events.jsonl`，每条 entity/hook 事件带 `chapter` 与 `seq`；按章记录 `reopen` 之后的才计数（与 foldEvents 的重开语义一致）；
- 卷摘要：`bible/volumes.json` 中已结束的卷；
- 人物卡：仅规划角色使用。

片段结构 `{id, source, text, chapter}`，id 唯一：

| 来源 | id |
| --- | --- |
| 摘要 | `summary:ch-0007` |
| 事实 | `entity:<seq>:<factIndex>` |
| 伏笔 | `hook:<seq>` |
| 卷 | `volume:<id>` |
| 人物卡 | `card:<name>` |

`context.js` 调 `corpus.collect(root, work, {beforeChapter})`，把结果传给 `retrieval.rank`；两个模块都加进 `package.json` 的 `files`。

### 排名：`retrieval.js`

纯函数 `rank(query, fragments, {limit})`，不读文件。CJK 二元 + 一元（一元权重 0.5），拉丁词按空白/标点；BM25 `k1=1.2, b=0.75`；至少一个词重叠才入选；同分按 `chapter` 降序、`id` 升序。

### 段、裁剪与轨迹

- 段 `retrieval`，标题「相关片段」，位置在「最近脉络」之后、「文风」之前；
- **检索段不做字符级压缩**：按分数从低到高整条丢弃，直到 ≤1200 字且 ≤5 条；这样 `sent` 语义清楚；
- 裁剪顺序 `retrieval → recent → state → characters → style`（`retrieval` 整段丢弃）；
- `trace.retrieval = {enabled, query, candidateCount, hits:[{id, source, score, sent}]}`：`enabled` 表示是否满足开启条件，`candidateCount` 是重叠过滤后的候选数，`sent` 表示该条是否在最终文本中；禁用或零命中时仍返回该结构（`hits: []`）。

### 开启条件

- 作品里 `currentRevision > 0` 的章数 ≥3；
- 有 target 时只收集 `chapter < target`；作品级规划无 target，收集全部已有正文的章；
- 章数不足时 `enabled: false`，不加段。

## 备选方案

- **SQLite FTS5**：依赖与版本风险；否决。
- **向量检索**：需要嵌入模型；否决。
- **检索正文全文**：体积与噪声大；否决，先用摘要与事实。
- **复用 foldEvents 的实体**：丢章号、且被客户端状态 UI 依赖；否决，改为 corpus 直读事件。
- **持久化索引**：暂缓，性能验收兜底。

## 验收条件

产品行为与验收由 #16 拥有。本设计只证明以下实现性质：

1. 分词、排序、同分次序与确定性由 `retrieval.test` 覆盖；
2. `corpus.collect` 的章号过滤、重开过滤与 id 唯一性由 `corpus.test` 覆盖；
3. `context.test` 更新旧断言（`dropped[0]` 从 `recent` 改为 `retrieval`），并覆盖 `retrieval` 段的裁剪与 `trace.retrieval` 的 `sent`；
4. `node scripts/decisions/check.mjs` 通过。

## 风险

- 200 章需要读约 199 个摘要文件，增量主要是 I/O；验收把总量与排名分开计；
- 一元 + 二元增加索引体积；
- 检索段挤占预算，命中率靠 trace 观察。

## 与既有记录的关系

- 扩展 #12 的上下文契约：新增段与裁剪顺序；实现落地时同步 #12 记录。
- 白名单规则不变：检索片段不参与派生。
- 路线图 R5 的触发条件与实现方式由本项更新。
