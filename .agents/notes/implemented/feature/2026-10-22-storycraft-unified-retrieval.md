# Agent Note: 故事工坊：素材与故事记忆的统一检索

Status: implemented

> 2026-10-22 补充（#31）：material 的 FTS tokens 现在含标题；正文片段/每类上限不变。

## 问题

B1 已把素材写入作品库并同步 `search_docs`（`kind='material'`），但 #16 的 `searchMemory` 只取 `summary/hook/volume`，所以作者导入的素材不会进入 `story_context`。素材正文可达 512 KB，不能整篇塞进 1200 字预算；BM25 又会按长度归一化，长素材天然排不到前 10，单靠 top-K 永远轮不到素材。

技能参考属于插件资源，不在作品库；本项不混入。

## 与既有记录

- **部分替代 #16 检索 Note §1/§3/§4**：`select` 从“只扫前 10 / sent 前缀”改为“扫全候选 / 每类上限 / hits=前10∪sent（≤15）”；#28 交付时同步更新 #16 的正文、`retrieval.js` 注释与 `retrieval.test` 的 5-sent/10-hit 预期。
- **部分替代 #26 素材 Note §6/AC5**：`searchMemory` 不再排除 material；交付时反转 `material.test` 的“searchMemory 不返回 material”断言。
- `retrieval.js` 的 hits 上限注释与 #16 §4 从“最多 10”改为“最多 15（前 10 ∪ sent）”；README 增加素材标题不索引的限制。
- **B2 不完整**：技能参考检索与素材标题索引都不在本项；#4 的 B2 保持“部分”，不能因 #28 关闭 B2。
- #22 的 artifact ID 表已有 `material:<id>`；本项只是把它放进 trace 的 `sourceIds`。

`searchMemory` 的片段 token 来自现有 `searchTokens`，不引入第二套分词。

## 决定

### 1. 素材候选

`searchMemory` 的 `MEMORY_KINDS` 增加 `material`：

- SQL 已按 `beforeChapter` 过滤；`material` 的 `chapter=0`，作品级，不受目标章限制；
- 素材正文直接取 `search_docs.body`（它已经是 content），不重复读 `materials.content`；
- 批量查 `materials` 只取 `id/title`，按 `doc_id` 映射；找不到行（孤儿索引）跳过，不抛错；
- 候选文本 = `titleExcerpt + '\n' + snippet`，**整段候选文本 ≤400 code point**；`titleExcerpt` 最多 60，snippet 用剩余预算；
- `sourceIds=['material:<id>']`，`chapter=0`，`score=-bm25`；
- 素材删除时 `search_docs` 同步删除，不会出现。

标题不进入 FTS（v1 只索引正文）；标题检索需要重建素材索引，另项。

### 2. 片段

`retrieval.snippetFor(text, tokens, max)`：

1. 只使用长度 ≥2 的 token（拉丁词或中文 bigram），按长度降序取最多 32 个；若没有，退回全部 token；
2. 按 token 长度降序、出现位置升序选锚点，避免“第/章/写”这类单字把片段拉到开头；
3. 从锚点前 80 字截取，总长 ≤max（含省略号）；
4. 没有命中时从开头截取；压缩连续空白；纯函数。

`searchMemory` 从 `searchTokens(query)` 取 token 列表，传给 `snippetFor`。

### 3. 每类上限与选择

`retrieval.select`：

- 按 score/chapter/id 排序后**遍历全部候选**（不只前 10），直到 5 条 sent 或候选耗尽；
- 每个 kind 最多 2 条 sent；
- 总长 ≤1200（候选文本 code point）；
- trace `hits` = 前 10 条候选 ∪ 全部 sent，去重后 ≤15，按候选 rank 排序；保证 `sent ⊆ hits`；
- `candidateCount` 是过滤后的候选总数（≤200），与 sent 数量无关；
- `sent:false` 只出现在 hits 中。

这样即使 10 条 hook 排在前，素材仍能被扫描到并拿到最多 2 个槽位；每类上限只防垄断，不保证素材一定命中（没有匹配素材时自然没有）。

### 4. 衔接

- `context.js` 无需新增段；`searchMemory` + `select` 自动带素材；
- trace schema 不变：`kind` 是 string，`sourceIds` 仍是 artifact ID；
- 预算/裁剪顺序不变（retrieval 先整段丢弃）；
- `story_brief` 不变；B4 另行决定；
- `written >= 3` 的启用条件不变：第 1–2 章没有检索段，素材也不进入；这是已知限制。

## 备选方案

- **整篇素材注入**：512 KB 直接爆预算；否决。
- **不做每类上限/不扫全候选**：真实第 4 章 5 条 hook 已说明垄断，长素材排不进前 10；否决。
- **标题也进 FTS**：需要重建素材索引；本项否决，另项。
- **素材摘要化（再调模型）**：增加模型调用/成本；否决，先用可解释片段。
- **技能参考一起检索**：插件资源不在作品库，路径与权限不同；否决混入本项。

## 后果

产品验收在 #28；本 Note 检查技术性质：

1. material 候选文本 ≤400（含标题前缀），无 origin/路径；孤儿索引跳过。
2. `select` 遍历全候选、每 kind ≤2、总 ≤5/1200；`sent ⊆ hits`，hits ≤15。
3. 删除素材后候选消失；旧 summary/hook/volume 的过滤/删除行为不变，但选择结果会受每类上限影响（同类超过 2 条时只发 2 条），排序也可能因 bm25 语料统计移动。
4. 相同候选集两次 select 一致；trace 字段不变。
5. 200 章 + 至少 3 条素材（含 1 条 512 KB）的 `searchMemory`+`select` ≤400ms。
6. `material.test` 的“searchMemory 不返回 material”断言反转；`retrieval.test` 的 5-sent/10-hit 期望按新规则更新；README 与 #16 Note §1/§3/§4 标记部分修订；`context.js` 的检索段 source 标签补 materials。

## 风险

- 片段可能在句子中间截断；省略号可见，后续可改按段落。
- 每类上限会让高分同类候选落选；这是有意的多样性取舍。
- 素材正文仍存两份（materials.content + search_docs.body）；本项不优化。
- 标题检索缺失；作者用标题词搜索时可能不命中，需在 README 说明。
- 200 条候选被素材占满时，摘要/伏笔可能被挤出候选；这是 FTS LIMIT 的既有边界。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- `retrieval.test`：material 后置仍被扫到、每类上限、sent/hits、limit>5。
- `material.test`：searchMemory 命中 material、文本 ≤400、标题前缀 ≤60、标题不可搜、删除后消失。
- `context-retrieval.test`：material 段、`beforeChapter=1`、work-scope planner。
- `store-perf.test`：200 章 + 3 条素材（含 512 KB）检索 <400ms。
- 真实 `雪线邮路`：导入 `B2 验收素材` 后 planner work-scope 命中 `material:<id>`、`sent:true`、标题+片段无路径；删除后 0 命中；副本已清理。

- 交付证据：ad61be4；29 个单测 + 13 条 E2E；真实雪线邮路 material 命中 ≤400、无路径、删除后 0 命中
