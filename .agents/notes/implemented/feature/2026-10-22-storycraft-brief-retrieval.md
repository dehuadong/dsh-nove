# Agent Note: 故事工坊：写前装配接入素材检索

Status: implemented


> 2026-10-22 部分修订（#30 B3）：story_brief 只取 setting/character/scene 素材；3 条/1200/8KB/位置/裁剪规则不变；#31 后标题命中也会进入候选。

## 问题

> 与 A7 的关系：本文部分替代 `implemented/architecture/2026-10-17-storycraft-bible-and-brief.md` 的“固定段”描述；A7 的 9 段结构不变（`BRIEF_SECTION_ORDER` 当前只有 7 项，交付时补全 recent/volume/retrieval），只在末尾追加可选 material 段。

B2 已让素材进入 `story_context`，但写正文前的 `story_brief` 仍是固定段。作者导入的素材在写前装配里看不到。

`story_brief` 已经覆盖全部未解伏笔、卷摘要与最近摘要；把 B2 的全部 kind 再灌一遍会重复并挤占 8 KB。因此本项只补**素材**。

## 决定

### 1. 段

`assembleBrief(root, work, chapter, dependencies = {})` 增加可选 `retrieval` 段：

- 只取 `kind='material'` 的候选；`searchMemory` 增加可选 `kinds`（默认 `MEMORY_KINDS`，未知 kind 忽略，空/未知结果返回 `[]`），用 `searchMemory(..., { kinds: ['material'] })` 让 FTS 的 200 条候选全部属于素材，避免被 summary/hook/volume 挤掉；
- 查询 `buildQuery({ chapterPlan: planText, openHooks: hooks })`；钩子最多取前 8 条，避免查询过长；
- 没有匹配素材时不 push 该段（不改现有 section 数量/顺序）；有匹配时放在 **wordPolicy 之后**，作为最低优先级；
- section **不写 `source` 键**（undefined），`sourceIds` 直接取 sent 素材的 `material:<id>`；写成空串会被 `sanitizeOutput` 覆盖成 `[]`。`hits` 也带同一组 ID。

### 2. 选择与预算

- `select(candidates, { limit: 3, budget: 1200, perKindLimit: 3 })`；3 条各 ≤400 code point，1200 可容纳；
- 段文本沿用 `select` 的 `〔material:<id>〕` 行；`select.chars` 是候选文本 code point，渲染前缀不计入该数；AC 的 ≤1200 指 `select.chars`；
- 总 `story_brief` 仍 ≤ `BRIEF_BUDGET_BYTES = 8 KB`；裁剪从结尾丢，retrieval 在最后，最先被丢；
- 被预算丢弃时，`dropped` 记录 `retrieval`，段内 `sent` 在 trace 中仍为 true 会误导；因此 trace 的 `hits` 在段被丢时统一改 `sent:false`（与 #16 一致）。

### 3. Trace 与回执

`assembleBrief` 返回增加 `retrieval`，与 standalone retrieval trace 共享 `enabled/query/candidateCount/hits/error`，另加 `chars`（#16 当前没有该字段，B4 扩展）：

```json
{"enabled":true,"query":"...","candidateCount":3,"chars":480,
 "hits":[{"id":"material:mat-...","kind":"material","sourceIds":["material:mat-..."],"score":1.2,"sent":true}]}
```

- `enabled`：已写 ≥3 章且 query 非空（检索已执行）；1–2 章或空查询为 `false`；
- `candidateCount`：只算 material；
- `chars`：`select.chars`；
- 检索失败 fail-open：`enabled:true`、`error`、空 hits，不建段；
- `tools.js` 的 `story_brief` 回执加 `retrieval`；`OUTPUT_PROPERTIES` 增加该字段（含 brief-only `chars`），输出 schema 仍 `additionalProperties:false`；回执以 `budget.used ≤8192` 为准，序列化增量用固定 fixture 对比。

### 4. 衔接

- `story_context` 不变；B2 的 material 检索仍独立；
- 不重复 summary/hook/volume；B4 不做二次检索；
- `README`、`BRIEF_SECTION_ORDER`、`story_brief` 工具描述同步；[A7](../architecture/2026-10-17-storycraft-bible-and-brief.md) 标记部分修订并补全 7 项段序；
- 子代理的 `story_context` 仍会看到素材；brief 只增加写前装配的素材段。

## 备选方案

- **所有 kind 都塞进 brief**：与既有 fixed 段重复，挤占 8KB；否决。
- **只放素材全文**：爆预算；否决。
- **提升 brief 上限到 12KB**：影响所有作品 token 预算；否决。
- **检索失败让 brief 报错**：写前装配应可降级；否决，fail-open。
- **section source 用 materials/ 目录**：`sourceIdsOf` 没有目录分支，会得到空 ID；否决，直接用 hits 的 ID。

## 后果

产品验收在 #29；本 Note 检查技术性质：

1. 只有 ≥3 已写章、query 非空、命中素材且预算允许时才有 `retrieval` 段；无命中不 push，不改变 section 数量。
2. 最多 3 条，`select.chars ≤1200`；正常 brief ≤8KB（仅单段自身超限时保留现有 `overBudget` 例外）；retrieval 在最后，预算丢弃时 `dropped` 记录且 hits 全部 `sent:false`。
3. `hits`/section `sourceIds` 只含 `material:<id>`，无路径；删除素材后消失。
4. 1–2 章或空查询 `enabled:false`；检索失败 fail-open，`enabled:true` + `error`。
5. 工具回执含 `retrieval`，schema 校验通过；`story_context` 不变。
6. `bible.test`/`tools.test` 覆盖命中/无命中/3 条/预算/1–2 章/删除/fail-open、`budget.used ≤8192` 与固定 fixture 的序列化增量；`store-search`/`material.test` 覆盖 `kinds`；`store-perf` 计时完整 `assembleBrief`+素材 ≤400ms。

## 风险

- 1200 code point 的素材段最多 3 条（每条 ≤400）；3 条是上限，不是保证。
- 素材片段可能截断句子；沿用 B2 的省略号行为。
- 查询只用章纲/伏笔，作者额外意图若没写进章纲可能不命中。
- 素材占 8KB 预算时会被先丢；这是“补充段”的优先级取舍。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- `bible.test`：4 条素材只发 3 条、无命中不 push、空 query 关闭、fail-open、删除后消失、预算丢弃 `sent:false`、determinism、序列化增量有界。
- `tools.test`：`story_brief` 回执带 `retrieval`，schema 允许该字段。
- `material.test`：`searchMemory.kinds` 只取 material；空/未知 kind 返回空。
- `store-perf.test`：200 章 + 512KB 素材，完整 `assembleBrief` <400ms。
- 真实 `雪线邮路` 第 4 章：素材段 198 字、`budget.used 8150`、`sourceIds:['material:…']`、无路径；删除后段消失；副本已清理。

- 交付证据：4e5396b；29 单测 + 13 E2E；真实雪线邮路第 4 章 brief 素材段 198 字/预算 8150，删除后消失
