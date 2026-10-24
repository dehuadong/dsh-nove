---
title: 故事工坊：L-R10a S1 ChapterMemo 迁移
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a S1 ChapterMemo 迁移

## 问题

A0 已把 ChapterMemo 合同、`plan:<n>` 身份和 `writeChapterMemo` 写入 registry，但生产动作仍写 `chapter_plans.text`：`story_plan`/`writePlan` 写旧表，`readPlan`、brief、context、`story_read`、`readChapter(view:'plan')`、export、`fact` 白名单与 observation 引文校验都从旧表取文本。memo 不是生产权威，作者确认绑定的是旧表行或不完整的 revision（旧生产路径常为 null），不是当前 memo 内容。

本 Note 只规划 L-R10a 的第一个切片 S1：把 ChapterMemo 的生产与消费一次切换，不涉及 summary/state/foundation/observation。

## 与既有记录

- 字段合同由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) §4 拥有；本 Note 只拥有 memo 的迁移、渲染与生命周期。
- 总体切片排序由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 是其中 S1。
- 作者闸门与 `planApproved` 语义已在 #46 实现；本 Note 把批准从旧 `chapter_plans.text` 哈希切到 memo revision。
- 章节编辑/重排的既有实现是 `applyChapterMapping`、`deleteChapter`、`moveChapter`；本 Note 只处理 memo artifact，不处理 events/summary。

## 提案

### 1. 生产

- `story_plan` 增加：`body`（必填，非空）、`threadRefs`（数组，可为空）；原五项 `perspective/goal/obstacle/cost/turn` 继续必填。
- `writePlan` 构造 ChapterMemo：
  `{ chapter, goal, body, threadRefs, perspective, obstacle, cost, turn }`
  写 `plan:<n>`；不再写 `chapter_plans`。
- **同一事务**：在 `artifact-store.js` 导出 `putArtifactOnDb(db, envelope)` / `writeChapterMemoOnDb(db, input)` 供 `store-db.js` 使用；`writePlan` 在现有事务里先 `ensureChapter`、查 settled、再写 memo。公开的 `putArtifact`/`writeChapterMemo` 只是“打开连接 + 调 OnDb”的包装。禁止在已打开事务里再调公开 writer（会自锁）。
- 相同内容重复 `story_plan` 是幂等 no-op：最新 revision 与内容哈希相同则返回现有 artifact，不新增 revision、不清批准、不 touchMeta；不同内容才写新 revision 并使旧批准失效。`writeChapterMemoOnDb` 必须先查最新 revision，不能直接调用会抛 `artifact-revision-exists` 的通用 writer。
- **A→B→A 回退**：旧 revision A 仍存在但最新是 B，不能插入同哈希 A 的新 revision；`story_plan` **拒绝**并返回 `artifact-revision-exists`（提示“该内容已存在于旧 revision，改回旧稿需换一份内容或新建作品”），不重用旧行、不改 latest、不删除历史。测试必须覆盖该拒绝与 latest 仍为 B。
- **顺序**：先查章节存在且非 settled；settled 直接 `chapter-settled`，即使内容相同也不进入幂等 no-op。幂等 no-op 只对非 settled 章节生效。memo 写入使旧 `plan_approved_at`/`plan_revision` 失效。
- `writePlan` 返回 `{ artifact: { artifactId: 'plan:<n>', revisionId, kind: 'plan' } }`；`story_plan` 原样返回该 artifact。
- **批准跨正文版本保留**：`writeChapter` 首次正文落盘时不再清空 `plan_approved_at`/`plan_revision`；批准只随 memo 改写或章节重编号失效。`story_revise`/delegate reviser 的写正文路径也必须检查同一个批准闸门。
- **策略开关**：闸门只在 `planApprovalPolicy === 'required'` 时生效；`planApproval: 'off'` 时 `writeChapter`/`reviseChapter`/delegate/context/nextStep 全部放行，不产生 `plan-not-approved`。
- 旧 `chapter_plans` 不再写；迁移后不再读。

### 2. 渲染器

- 单一渲染器 `renderChapterMemo(memo)` 放在 `artifact-store.js`：输出
  `# 第 N 章 章纲`、`- 视角：`、`- 目标：`、`- 阻力：`、`- 代价：`、`- 结尾变化：`、`- 伏笔：`（threadRefs，空则省略）、`## 章纲正文` + body。
- 渲染器只用于读者/旧消费者需要的文本视图；memo JSON 是权威。`threadRefs` 在 `story_read(plan:n)` 返回的 memo JSON 中可见，渲染文本也输出 `- 伏笔：` 行；S3 再接 hook 消费。
- 缺 memo 时 `story_read(plan:n)` 返回 `plan-not-found`，不能返回 `"undefined"`。
- `story_read(plan:n)` 返回 **多行 pretty JSON**，保留按行分页；显式 `revisionId` 时读取该 memo 旧 revision（不可变），不强制最新。
- `verifyObservationSources` 的 `plan:<n>` 引文也用渲染器，不再读 `chapter_plans`。

### 3. 消费者切换

| 消费者 | 切换 |
| --- | --- |
| `readPlan` | 读最新 `plan:<n>`，用 `renderChapterMemo` 返回文本；缺 memo 返回 undefined |
| `approveChapterPlan` | 要求最新 memo 存在，绑定其 revision；无 memo 抛 `plan-not-found` |
| `writeChapter` / `nextStep` / `readWork` 的章纲存在性 | 查 `artifacts` 的 `plan:<n>`，不再查 `chapter_plans`；`planGateSatisfied` 删除“无 memo 即视为已批准”的回退 |
| `readManifest` / `readWork` / `status` / panel 的 `planApproved` | 删除“无 memo 即已批准”的内联回退；必须要求 memo revision 匹配 |
| `nextStep` 的步骤与 `delegateOf` | required 且未批准时返回 `story_plan`/`missing:['plan-approval']`，不得先广告 `story_revise`/rewrite/delegate 再在写入时失败 |
| `writeChapter` / `reviseChapter` / delegate reviser 的批准闸门 | 对所有写入/重写/修订检查当前 memo 批准，不再只在 `current_revision === 0` 检查；`context.js`/`delegate.js` 的 reviser preflight 与 `nextStep.delegateOf` 也要在派发前检查，不能先生成子代理再拒绝 |
| `delegate.js` 的 plan preflight | 用 `readPlan`，不再读 `chapter_plans` |
| `readChapter(view:'plan')` | 用 `readPlan` 渲染文本；`revision` 保持章节视图语义 |
| `story_read(plan:n)` | 返回多行 memo JSON 文本（pretty、稳定字段序）；`revisionId` 用 registry 的 memo revision，revision 固定 content；显式 revisionId 可读旧 revision；brief/context 仍用渲染文本 |
| `artifactRef` / tools 的 plan 引用 | 从 memo artifact 取 revisionId |
| `threadRefs` | 渲染器输出 `- 伏笔：` 行，`story_read` JSON 可见；S3 接 hook 消费 |
| `bible.js` brief 章纲段 | 用 `readPlan` 渲染文本 |
| `context.js` 章纲段/视角解析 | 用渲染文本（`/- 视角：/` 仍可解析） |
| `facts.js` 白名单 | 用 `readPlan` |
| `state-check` / `state-settle` 的章纲上下文 | 用 `readPlan` |
| export `outline/<stem>.plan.md` | 从 `plan:<n>` artifact 渲染 |
| `verifyObservationSources` 的 `plan:<n>` | 从 memo 渲染 |

### 4. 章节移动/删除

S1 是 #51 的第一切片，**自行拥有 memo 的重映射与导出**；#51 的 S0/S0.5 不再拥有 memo，S0 只覆盖 summary/events，review 归 #52，S0.5 覆盖共享检索/导出基础设施，避免双 owner。

- 新增通用 `remapChapterScopedArtifacts(db, mapping, kind)`：按 `scope_chapter` 找到 artifact，临时 ID 去冲突，更新 `content.chapter`/`scope_chapter`，落到新 ID；S1 只用 `kind='plan'`，S0 后续复用。
- `deleteChapter`：被删章的 memo 删除；删除会重编号所有幸存章，必须用 mapping 重映射**所有幸存章**的 memo，而不只是被删章。
- `moveChapter` / 重排：按 mapping 重映射所有受影响 memo。
- **settled 章节**：S1 拒绝移动/删除 **被删章、移动的源/目标及所有 `old !== new` 的重编号章节**为 settled 的操作（`chapter-settled`）；`chapterRemap` 中 identity 项不算受影响。避免已定稿 memo/批准被破坏；S0 再决定是否支持 reopen 后编辑。
- **只迁移最新 revision**：重编号时只保留每章最新 memo，旧 revision 删除；不把旧 revision 历史搬到新 ID。
- content-hash revision 因 `content.chapter` 改变而变化；同一事务内清空所有被重映射章的 `chapters.plan_revision`/`plan_approved_at`（旧批准失效），不允许悬空 revision。
- 删除/移动后旧 ID 不可读，新 ID 可读；按合同 v2 的 identity-change 例外，旧 chapter ID 下的 memo 历史不保留。编号可被后续新章重新使用，但必须是新内容/新 revision，不得把旧 memo 复制给新章。
- `applyChapterMapping` 移除 `chapter_plans` 表循环；export 不再查询 `chapter_plans`，改从 `plan:<n>` 渲染。
- 不处理 events/summary/observation；这些属于 S0/S2/#52。

### 5. 失败与边界

- 缺 memo：`plan-not-found`；memo 内容形状非法：`artifact-invalid`；章节 settled：`chapter-settled`。
- `story_plan` 参数缺失由工具 schema 拒绝（absent）；`body` 为空/`threadRefs` 非数组等进入 `writePlan` 后返回 `plan-incomplete`。空 `threadRefs` 数组合法。
- 批准时 memo 已被改写：`approveChapterPlan` 只绑最新 revision；旧 revision 不可批准。
- 不做旧表双读；旧 `chapter_plans` 数据在测试作品重建时丢弃。
- 不迁移旧作品。

## 备选方案

- **保留 `chapter_plans` 作为缓存**：双源，memo 改写与批准失效会漂移；否决。
- **memo 内容里再存一份渲染文本**：重复且易漂移；否决，渲染在读取边界做。
- **`story_read` 返回渲染文本**：revision 是 memo JSON 的哈希，渲染文本会随渲染器变化而不固定 content；否决，改为返回 memo JSON，brief/context 另用渲染文本。
- **移动章节时保留旧 revision**：content.chapter 变则 revision 变，保留会产生不可校验的旧 ID；本切片不承诺，后续可另立历史合同。

## 验收条件

1. `story_plan` 只写 `plan:<n>`，`chapter_plans` 不再写；测试断言旧表写入为 0。
2. `readPlan`/brief/context/`readChapter(view:'plan')`/export 从 memo 渲染，输出包含五项、body 与 threadRefs。
3. `approveChapterPlan` 绑定最新 memo revision；`planApproval: required` 时 memo 改写后任何写正文/重写/修订被 `plan-not-approved` 拒绝；`off` 时全部放行；`nextStep`/delegate 不广告会失败的动作。
4. `story_read(plan:n)` 返回 memo JSON，`revisionId` 等于 registry revision 且固定 content；无 memo 返回 `plan-not-found`；`threadRefs` 在 JSON 与渲染文本可见；显式旧 revision 可读。
5. 删除/移动章节后 memo ID、`content.chapter`、批准/revision 一致；旧 ID 不可读；settled 章节（含相同内容重交）拒绝移动/删除/改写。
6. 旧 `chapter_plans` 不再被读：测试删除旧表行后，brief/context/read/export 仍工作；`applyChapterMapping` 与 export 不再引用该表。
7. `memo-consumers.test.mjs` 覆盖正常、缺 memo、无效 memo、批准失效、移动/删除、消费与 revision；A→B→A 被 `artifact-revision-exists` 拒绝且 latest 仍为 B；absent/empty body 的错误码符合 §5；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
8. 不修改 summary/state/foundation/observation；不新增旧格式兼容。

## 风险

- `story_plan` 新增必填 `body` 会改变模型调用契约；需同步工具 schema、README、技能与测试。
- 移动章节清空批准会让作者需要重新确认；这是 content-hash revision 变化的必然代价，必须提示面板。
- memo 渲染文本与旧 `chapter_plans.text` 可能有细微格式差异，导出/测试需以渲染器为准。
- 旧 `chapter_plans` 表仍在 schema 中但不再读写；后续清理不在本切片。
