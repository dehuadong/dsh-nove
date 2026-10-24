---
title: 故事工坊：基于作品库 FTS5 的上下文检索
status: implemented
created: 2026-10-21
updated: 2026-10-22
verification: f491ed6；27 个单测 + 11 条 E2E；真实第 4 章 `story_context` 返回 retrieval 5 条 / candidateCount 13–14，stale summary:2 不进入 hits
---

# Agent Note：故事工坊：基于作品库 FTS5 的上下文检索

> 2026-10-22 补充（#30 B3）：searchMemory 增加 purposes，material 候选可按用途过滤；其他 kind/预算不变。

> 2026-10-22 已修订（#28 B2）：`searchMemory` 增加 material（§1 语料表/kind 列表）；`select` 改为“扫全候选 + 每类上限 2 + hits=前10∪sent（≤15）”（§3/§4）；`retrieval.test` 已同步。

## 问题

`story_context` 的「最近脉络」只覆盖最近 3 章摘要；更早的伏笔与卷记忆无法按需召回。作品库已有 FTS5 + BM25（`store-db.js` 的 `search_docs` / `search_fts`），但只有内部 `search()` 使用，没有接入角色上下文；#25 补了摘要 revision 绑定，过期摘要不能再被当成当前记忆。

旧设计 [检索召回的设计（纯 JS BM25）](../../implemented/pipeline/2026-10-19-storycraft-retrieval.md) 以“读摘要文件、不引入 SQLite/FTS5”为前提，已被 #18 的作品库取代。本 Note 承接其“段位置、预算、trace”结论，替换语料与排名实现；角色查询表、开启条件与产品验收由 [#16](https://github.com/dehuadong/dsh-nove/issues/16) 拥有。

参考实现（InkOS）的可验证做法：FTS5/BM25、前一章摘要保底、Hook ID 定向回溯、retrieval trace；它还会把未命中文档交给 LLM 语义选择。第一版只吸收确定性部分。

## 与既有记录

- 复用 #18 的单作品 SQLite 与库内 FTS5；不新增依赖、不新建持久化索引。
- 复用 #25 的 `summaryStateOf`：只召回 current 摘要。
- 扩展 [角色输入契约](../../implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md) 的 `story_context` 段与 trace；不改变现有段的保护级别。
- 部分替代旧设计：旧记录的 corpus/纯 JS BM25 不适用；段位置、预算与 trace 的历史依据保留，角色查询与开启条件以 #16 为准。

## 决定

### 1. 语料与过滤

只从作品库读取，不读文件：

| 来源 | 文档 kind | 过滤 |
| --- | --- | --- |
| 章节摘要 | `summary` | `state === 'current'`（#25）；`chapter < target`（无 target 时全部）；`recent` 已发出的条目不重复 |
| 未解伏笔事件 | `hook` | 事件 seq 晚于本章最后一次 `reopen`；`chapter < target`（无 target 时全部）；**该伏笔最新 post-reopen 事件状态**不是 resolved |
| 卷摘要 | `volume` | 关联 `volumes` 表取 `to_ch`；`to_ch < target`（无 target 时全部） |
| 素材 | `material` | 当前作品；作品级，不受目标章限制；标题前缀 ≤60 + 片段，总候选文本 ≤400 |

排除：整章正文（`kind='chapter'`）、人物卡、人物事实（entity）事件、目标章及之后、过期摘要、已解伏笔、reopen 前的旧事件。

`store-db.searchMemory(root, work, query, { beforeChapter })`：

- 复用 `searchTokens` 与 FTS5 `MATCH`，SQL 限定 `kind IN ('summary','hook','volume','material')`；
- SQL 先按 `bm25`、`chapter DESC`、`doc_id` 排序再 `LIMIT 200`，避免 LIMIT 前无排序导致的不确定；
- `summary`：用 `summaryStateOf` 过滤 current；
- `hook`：事件 id 为 `event:<seq>`，先查 `events` 表得到**该事件所在章**最后一次 `reopen` 的 seq，早于它的不进入候选；**已解判定看同一伏笔文本的最新 post-reopen 事件状态（用 `foldEvents` 的规则折叠），不能只看候选事件自己的 `state`**——否则 ch2 opened、ch5 resolved 的旧 opened 文档会漏过过滤；
- `volume`：`JOIN volumes` 校验 `to_ch`，不能只看 `search_docs.chapter`（那里存 from）；
- `material`：`search_docs.body` 已含正文，批量回查 `materials.title`；孤儿索引跳过；`snippetFor` 生成 ≤400 候选文本。
- 返回内部候选 `{id, kind, source, chapter, text, score}`；`id = search_docs.doc_id`，`source = search_docs.source`（虚拟路径），`score = -bm25`（越高越相关）。`source` 只供内部映射，不进入模型输出。

`search()` 与 `searchMemory()` 共用一个内部 `queryDocs(db, { match, kinds, beforeChapter, limit })`，避免复制 FTS 引号/排序/映射逻辑；`search()` 保持现有签名，目前仅供测试/后续动作，不把 `searchMemory` 的过滤规则塞进它。

### 2. 查询

`retrieval.js` 的 `buildQuery({ role, taskText, chapterPlan, openHooks, instruction })` 拼接：

```text
本章任务
+ 章纲五段（目标/阻力/代价/结尾变化/视角）
+ 当前未解伏笔文本
+ 作者 instruction（截断）
```

summarizer 不启用检索；空查询（token 为空）直接返回 `enabled:false` 的 trace，不建段。

### 3. 选择与预算

`retrieval.js` 的 `select(candidates, { excludeIds, limit=5, budget=1200, perKindLimit=2 })`：

1. 去掉 `excludeIds`（`recent` 已发出的摘要 id）；
2. 按 `score` 降序、`chapter` 降序、`id` 升序稳定排序；
3. 遍历全部候选（不再只扫前 10），每类最多 2 条，累计 `codePointLength(text)` ≤1200 且 ≤5 条；
4. 返回 `{ text, hits, chars }`；段文本按 `sent:true` 的顺序逐条换行，每条前加 `〔id〕` 前缀，便于把正文和 trace 对应；`chars` 只计各条 `text` 的 code point 之和，不含段标题、换行与 `〔id〕` 前缀；`hits` = 前 10 ∪ sent，最多 15 条、按候选 rank 排序；`sent` 标记实际进入文本的条目。

`recent` 已覆盖前章摘要，检索段不重复加入；不再用 `-1e6` 之类的强制分数。

### 4. 段、裁剪与 trace

段 `retrieval` 为 compressible，位置在「最近脉络」之后、「文风/审稿标准」之前。

`context.js` 的 `TRIM_ORDER` 改为 `['retrieval','recent','state','characters','style']`：检索段先被整段丢弃。裁剪循环对 `retrieval` 直接置空并记 `dropped`，**不进入 `slice` 字符压缩分支**；整段被丢弃后，`trace.retrieval.hits` 全部改 `sent:false`。段内也只做整条丢弃。

`trace.retrieval` 始终存在：

```json
{
  "enabled": true,
  "query": "…",
  "candidateCount": 17,
  "hits": [
    { "id": "summary:3", "kind": "summary", "sourceIds": ["summary:3"], "score": 2.4, "sent": true }
  ]
}
```

- `enabled`：正文章数 ≥3 且角色不是 summarizer，由 `context.js` 计算；空查询时 `false`；
- `candidateCount`：过滤后、取 5 条前的候选数，最多 200（受 SQL LIMIT 限制）；
- `hits` 最多 15 条（前 10 ∪ sent），每项为 `{id, kind, sourceIds, score, sent}`；`sourceIds` 只放 artifact ID（summary → `summary:<n>`，hook → `state`，volume → `volume:<id>`，material → `material:<id>`），不放虚拟路径，模型输出经 `sanitizeOutput` 不会改写它；
- `sent` 在最终裁剪后统一写；
- 检索抛错时：不建段，`enabled` 仍按能力为 `true`，`hits: []`、`candidateCount: 0`，并加 `error: <code>`；其余段照常。

### 5. 接缝

1. `retrieval.js`：`buildQuery` / `select` / `codePointLength`，纯函数，无 I/O；
2. `store-db.js`：`searchMemory` 与共享 `queryDocs`；过滤 current/stale、reopen、hook、volume；
3. `context.js`：计算 `enabled`/target/`excludeIds`（循环最近摘要时收集 id），在 `recent` 之后调用，生成段；裁剪后写最终 trace；同步更新 #12 的段/裁剪顺序记录；
4. `tools.js`：`OUTPUT_PROPERTIES.trace` 增加 `retrieval` 对象（`hits` 用 `sourceIds`，含可选 `error`），顺手修正现有 `trace.sections` 的 `source`/`sourceIds` 声明漂移；
5. 根目录运行时 `.js` 由 `package.json` 的 `*.js` 覆盖；
6. `context.test` fixture 至少 3 章有正文，并构造一个能词法命中的查询；`dropped[0]` 只在 `retrieval` 段存在时断言为 `retrieval`，禁用/零命中时仍断言 `recent`；新增 `retrieval.test`；AC1 的命中摘要必须比最近 3 章更旧，否则会被 `recent` 去重。

### 6. 明确不做

- 不做 LLM 语义重排/选择；不做向量/embedding；
- 不做素材文件入库（B1 的 txt/md/epub/pdf）；
- 不检索整章正文、人物卡、人物事实事件；
- 不把检索结果写入白名单，不改变一致性 warning；
- 不做跨作品检索。

## 备选方案

- **照搬 InkOS 全候选 + LLM 语义选择**：召回率高，但候选可能接近全部历史记忆，增加模型调用与预算；第一版否决，保留为后续评估。
- **纯 JS 线性 BM25**：无 SQL 依赖，但 200 章要读大量摘要，且已有 FTS5；否决。
- **向量检索**：需要嵌入服务与成本；当前无必要；否决。
- **检索整章正文/人物卡**：召回更细，但体积与噪声大；否决，先用摘要/伏笔/卷。
- **只在 `story_brief` 加检索**：brief 是写前固定装配，不适合按角色动态查询；否决，统一放 `story_context`。

## 后果

本 Note 只证明技术性质；产品验收在 #16。

1. 语料来自作品库 current 摘要、reopen 后的未解伏笔、`to_ch` 合规的卷摘要与当前作品素材（标题前缀 + 片段）；stale/已解/reopen 前/目标章及之后的文档被过滤；`hits` 只含 `id/kind/sourceIds/score/sent`，无路径。
2. `searchMemory` 的过滤有测试：current/stale、reopen、hook resolved、volume `to_ch`；查询与选择纯函数有测试。
3. `TRIM_ORDER` 包含 `retrieval` 且跳过字符压缩；整段丢弃后 `sent` 全部为 `false`，有断言。
4. `trace.retrieval` 在启用、零命中、禁用、检索错误四种情况下都有固定字段；`hits` 最多 15 条。
5. 同一候选集两次 `select` 结果一致；SQL 的 `ORDER BY` 在 `LIMIT` 前。
6. 200 章摘要 + 事件 fixture 下，`searchMemory` + `select` 的增量 ≤400ms；测量点与 `store-perf.test` 一致。

## 风险

- FTS5 词法匹配不能理解同义、别名与隐含因果；第一版接受漏召回，先看 trace 再决定是否加语义重排。
- 事件文档是 JSON，格式化后可能仍偏长；由整条丢弃与 1200 字总预算兜底，不做字符级截断。
- `reopen` 过滤需要额外查 `events`，200 章测量要含这一段。
- 过期摘要被过滤后，早期章节的检索覆盖会变窄；这与 #25 的“过期不当 current”一致，需在 README 说明。
- 检索失败走 fail-open（只少一段），trace 的 `error` 让作者可诊断。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- `retrieval.test`：current/stale、reopen、latest-post-reopen resolved、volume `to_ch`、目标章过滤、5/1200 预算、每类上限、15 条 trace、determinism。
- `context-retrieval.test`：段位置、`recent` 去重、整段丢弃后 `sent:false`、零命中、fail-open `work-busy`、work-scope planner。
- `store-perf.test`：200 章摘要 + 20 条 hook 事件 + 一次 reopen + 3 条素材（含 512 KB），`searchMemory` + `select` < 400ms。
- 真实第 4 章 `story_context`：`trace.retrieval.enabled: true`、`candidateCount` 13–14、5 条 `sent`；临时把第 2 章摘要置 stale 后，`hits` 中没有 `summary:2`；探测后已恢复 revision。
