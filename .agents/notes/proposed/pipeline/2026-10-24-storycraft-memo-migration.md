---
title: 故事工坊：L-R10a S1a-demo ChapterMemo 只读消费链
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a S1a-demo ChapterMemo 只读消费链

## 问题

A0 已交付 ChapterMemo 合同、`plan:<n>` 身份与写入 registry 的 API，但生产动作仍写 `chapter_plans.text`：`story_plan`/`writePlan` 写旧表，`readPlan`、brief、context、`story_read`、`readChapter(view:'plan')`、export、`facts` 白名单与 observation 引文校验都从旧表取文本。memo 不是生产权威，作者确认绑定的也不是当前 memo 内容。

本 Note 只规划 **S1a-demo：当前 memo 的生产 + 只读消费链**。章节移动/删除、旧 revision 写入回退、observation target、summary/state/foundation 不在本切片。

## 与既有记录

- 字段合同由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) §4 拥有；本 Note 拥有 memo 的生产、读取、渲染与批准。
- 总体切片排序由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 是 S1a-demo，章节编辑重映射归 S0，observation 归 #52。
- 作者闸门与 `planApproved` 语义已在 #46 实现；本 Note 把它切到 memo revision。
- 章节编辑的既有实现是 `applyChapterMapping`、`deleteChapter`、`moveChapter`；本切片不改它们，只在存在 memo 时阻止编辑。

## 提案

### 1. 生产

- `story_plan` 增加：`body`（必填、非空）、`threadRefs`（数组，可为空）；原五项 `perspective/goal/obstacle/cost/turn` 继续必填。
- `writePlan` 构造 ChapterMemo：
  `{ chapter, goal, body, threadRefs, perspective, obstacle, cost, turn }`
  写 `plan:<n>`；不再写 `chapter_plans`。
- **同一事务**：在 `artifact-store.js` 导出 `putArtifactOnDb(db, envelope)` / `writeChapterMemoOnDb(db, input)` 供 `store-db.js` 使用；`writePlan` 在现有事务里先 `ensureChapter`、查 settled、再写 memo。公开 writer 只做“打开连接 + 调 OnDb”的包装，禁止事务内再调公开 writer。
- **顺序**：先查章节存在且非 settled；settled 直接 `chapter-settled`，即使内容相同也不进入幂等 no-op。
- 相同内容重复 `story_plan` 是幂等 no-op：先查最新 revision，命中即返回，不新增、不清批准、不 touchMeta。
- **A→B→A**：旧 revision A 已存在但最新是 B 时，`story_plan` 拒绝并返回 `artifact-revision-exists`；不重用旧行、不改 latest、不删除历史。
- `writePlan` 返回 `{ artifact: { artifactId: 'plan:<n>', revisionId, kind: 'plan' } }`；`story_plan` 返回 `{ ok, workId, artifact }`。
- 批准跨正文版本保留：`writeChapter` 首次正文落盘不再清空 `plan_approved_at`/`plan_revision`；批准只随 memo 改写或章节重编号失效。
- **策略开关**：闸门只在作品持久设置 `manifest.planApproval === 'required'` 时生效；`off` 时 `writeChapter`/`reviseChapter`/delegate/context/nextStep 全部放行。
- 旧 `chapter_plans` 不再写、不再读。

### 2. 渲染与读取

- 单一渲染器 `renderChapterMemo(memo)` 放在 `artifact-store.js`：输出
  `# 第 N 章 章纲`、`- 视角：`、`- 目标：`、`- 阻力：`、`- 代价：`、`- 结尾变化：`、`- 伏笔：`（threadRefs，空则省略）、`## 章纲正文` + body。
- 可选字段缺失时省略对应行；`goal`/`body` 必填。
- 渲染器只用于读者/旧消费者需要的文本视图；memo JSON 是权威。`threadRefs` 在渲染文本与 `story_read` JSON 中可见。
- `story_read(plan:n)` 默认返回当前 revision 的多行 pretty memo JSON；显式 `revisionId` 时返回该 revision（存在即读，不存在 `revision-not-found`）。缺 memo 返回 `plan-not-found`，不能返回 `"undefined"`。
- `readPlan` 内部缺 memo 返回 `undefined`；`story_read`/`writeChapter`/delegate 等边界把 undefined 映射为 `plan-not-found`。
- `readChapterMemo` 的 `artifact-not-found` 在 plan 边界统一映射为 `plan-not-found`。

### 3. 消费者切换

| 消费者 | 切换 |
| --- | --- |
| `readPlan` | 读最新 `plan:<n>`，用 `renderChapterMemo` 返回文本；缺 memo 返回 undefined |
| `approveChapterPlan` | 要求最新 memo 存在，绑定其 revision；无 memo 抛 `plan-not-found` |
| `writeChapter` / `nextStep` / `readWork` 的章纲存在性 | 查 `artifacts` 的 `plan:<n>`，不再查 `chapter_plans`；`planGateSatisfied` 删除“无 memo 即视为已批准”的回退 |
| `writeChapter` / `reviseChapter` / delegate reviser 的批准闸门 | 所有写入/重写/修订检查当前 memo 批准；`reviseChapter` 在 store 内读 `meta.plan_approval` 与最新 memo，先于 body/review 检查返回 `plan-not-approved`；`context.js`/`delegate.js` reviser preflight 与 `nextStep.delegateOf` 也检查 |
| `nextStep` 的步骤 | required 且未批准时返回当前阶段动作（无正文 `story_write`、有正文待审 `story_review`、有审稿待改 `story_revise`）并带 `missing:['plan-approval']`；`missing` 非空即阻断，模型不得执行该 action，delegate 抑制；不返回 `story_plan`（会重写 memo） |
| `readManifest` / `readWork` / panel 的 `planApproved` | 删除“无 memo 即已批准”的内联回退；必须要求 memo revision 匹配（`status` 不暴露 planApproved） |
| `readChapter(view:'plan')` | 用 `readPlan` 渲染文本 |
| `story_read(plan:n)` | 返回当前/显式旧 revision 的 memo JSON；revisionId 用 registry revision |
| `artifactRef` / tools 的 plan 引用 | 从 memo artifact 取 revisionId |
| `threadRefs` | 渲染器输出 `- 伏笔：`，`story_read` JSON 可见；S3 接 hook 消费 |
| `bible.js` brief 章纲段 | 用 `readPlan` 渲染文本 |
| `context.js` 章纲段/视角解析 | 用渲染文本（`/- 视角：/` 仍可解析） |
| `facts.js` 白名单 | 用 `readPlan` |
| `state-check` / `state-settle` 的章纲上下文 | 用 `readPlan` |
| `delegate.js` plan preflight | 用 `readPlan`，不再读 `chapter_plans` |
| export `outline/<stem>.plan.md` | 从 `plan:<n>` artifact 渲染 |
| `verifyObservationSources` 的 `plan:<n>` | 从 memo 渲染 |

### 4. 章节编辑

- S1a-demo **不改** `applyChapterMapping`/`deleteChapter`/`moveChapter` 的章节号映射；为避免 memo 与章节号失配，存在 `plan:<n>` 时拒绝删除/移动该章：`chapter-edit-blocked`（提示由 S0 接管重映射）。
- `chapter_plans` 表保留在 schema 中但不再写读；`applyChapterMapping` 对空表的循环无害，S0 再清理。
- 不接 observation target；观测链归 #52。

### 5. 失败与边界

- 缺 memo：`plan-not-found`；`body` 为空/`threadRefs` 非数组：`plan-incomplete`；memo 合同形状非法（如缺少 goal）：`artifact-invalid`；章节 settled：`chapter-settled`；有 memo 时删/移章：`chapter-edit-blocked`。
- `story_plan` 参数缺失由工具 schema 拒绝（absent）；空 `body`、非数组 `threadRefs` 进入 `writePlan` 后返回 `plan-incomplete`；空 `threadRefs` 数组合法。
- 批准时 memo 已被改写：`approveChapterPlan` 只绑最新 revision；旧 revision 不可批准。
- 不做旧表双读；旧 `chapter_plans` 数据在测试作品重建时丢弃。
- 不迁移旧作品。

## 备选方案

- **保留 `chapter_plans` 作为缓存**：双源，memo 改写与批准失效会漂移；否决。
- **memo 内容里再存一份渲染文本**：重复且易漂移；否决，渲染在读取边界做。
- **`story_read` 返回渲染文本**：revision 是 memo JSON 的哈希，渲染文本会随渲染器变化而不固定 content；否决，改返回 memo JSON。
- **S1a-demo 同时支持章节编辑重映射**：FK/批准/revision 一致性问题会带入本切片；拆到 S0。
- **S1a-demo 不阻止章节编辑**：memo 会与章节号失配；否决，先阻止。

## 验收条件

1. `story_plan` 只写 `plan:<n>`，`chapter_plans` 不再写；测试断言旧表写入为 0。
2. `readPlan`/brief/context/`readChapter(view:'plan')`/export 从 memo 渲染，包含五项、body、threadRefs；可选字段缺失时省略行。
3. `approveChapterPlan` 绑定最新 memo revision；`planApproval: required` 时 memo 改写后任何写正文/重写/修订被 `plan-not-approved` 拒绝；`off` 时放行；`nextStep`/delegate 在未批准时带 `missing:['plan-approval']` 且不派发。
4. `story_read(plan:n)` 返回 memo JSON，`revisionId` 等于 registry revision；显式旧 revision 可读；无 memo 返回 `plan-not-found`；`threadRefs` 可见。
5. 有 memo 时删除/移动章节返回 `chapter-edit-blocked`；无 memo 的章节编辑保持原行为。
6. 旧 `chapter_plans` 不再被读：测试删除旧表行后，brief/context/read/export 仍工作；export 不再引用该表。
7. `memo-consumers.test.mjs` 覆盖正常、缺 memo、坏 memo、批准失效、`off`、章节编辑阻断、消费者、当前/旧 revision、A→B→A 拒绝、absent/empty body 错误码；并更新约 30 个调用 `writePlan` 的 fixture 与 `foundation-chapter-artifacts`/`tools.test` 的旧断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
8. 不修改 summary/state/foundation/observation；不新增旧格式兼容。

## 风险

- `story_plan` 新增必填 `body` 会改变模型调用契约；需同步工具 schema、技能、README 与测试。
- 阻止有 memo 的章节删除/移动会让面板暂时失去该编辑能力；这是 S0 接管前的明确限制，需要面板提示。
- memo 渲染文本与旧 `chapter_plans.text` 可能有细微格式差异，导出/测试需以渲染器为准。
- 旧 `chapter_plans` 表仍在 schema 中但不再读写；后续清理不在本切片。
