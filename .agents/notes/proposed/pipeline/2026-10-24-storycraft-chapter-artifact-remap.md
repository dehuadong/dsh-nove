---
title: 故事工坊：L-R10a S1b 章节 artifact 重映射
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a S1b 章节 artifact 重映射

## 问题

章节删除/移动会重编号幸存章，但 v6 `artifacts` 表没有外键，`applyChapterMapping` 只更新 chapters/versions/plans/summaries/reviews/events/search_docs，不更新 `artifacts.artifact_id`/`scope_chapter`/`content.chapter`，也不清批准。结果是 `plan:<n>`/`summary:<n>`/`review:<n>:...` 仍指向旧章或另一章内容；`chapters.plan_revision` 悬空。

S1a-demo 只能临时阻断有 memo 的删/移。本 Note 规划 S1b：把章节号重映射扩展到 plan/summary/review，并让删/移直接可用。

## 对拍参考

- `inkos-master/packages/core/src/models/chapter.ts`：`ChapterMetaSchema` 用 `number` 标识章节；`chapter-persistence.ts` 也按 `chapterNumber` 更新索引。
- `inkos-master/packages/core/src/state/chapter-workspace.ts`：`ChapterVersion.id` 用 `${timestamp}_${source}_${randomUUID()}`；UUID 属于正文版本文件，不属于章节身份。
- `inkos-master/packages/core/src/harness/source-sync.ts`：artifact revision 为 `rev-<sha256 前 16 位>`，artifactId 为“可读名 + 路径哈希”；不是 chapter UUID。
- 我们的实现：保留 chapter number 身份；S1b 重映射 chapter-scoped artifact，revision 用 content hash；不引入 chapter UUID。正文版本 UUID 是另一个对拍差异（S1c），不在本切片。
- 裁决：采纳参考的“章节按 number、版本单独持 ID”的结构；不把 UUID 提升为章节身份。

## 与既有记录

- 章节身份与批准由 [`2026-10-24-storycraft-chapter-identity-approval.md`](2026-10-24-storycraft-chapter-identity-approval.md) 拥有；本 Note 承接它的 identity-change 例外与批准失效规则。
- 切片排序由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 是 S1b，取代其中“S0 负责 memo/review”的冲突表述。
- 字段合同由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 拥有；本 Note 只定重映射算法、顺序与失败行为。
- observation 语义仍归 #52；S1b 只处理已有 review artifact 的 target 引用，不定义新的 observation 生命周期。

## 提案

### 1. 重映射对象

- 按章 artifact：`plan:<n>`、`summary:<n>`、`review:<n>:r<rev>:<round>`；state 是作品级（无 scope_chapter、rev 为事件序号），不参与。
- 其它 `scope_chapter` 非空的 artifact（context/trace）：当前没有生产者，其 artifactId 不按章号编码，ID 方案归 R12；重映射只把这些行的 `scope_chapter` 跟到新章号，不改 artifactId 与内容。R12 引入生产者时须同时定义 ID 方案与同样的 identity-change 重映射。
- **只保留最新 revision**：章节重编号是 identity-change，旧 revision 删除，不搬到新 ID；编号可被新章重用，但必须新内容/新 revision。
- artifactId 的章号段、`scope_chapter`、`content.chapter`（plan/summary 有）一起更新；review 的 bodyRev/round 不变，只改章号段。
- **approval**：所有 `old !== new` 或被删章的 `chapters.plan_approved_at`/`plan_revision` 清空；作者需要重新确认。
- **review target**：review artifact 内容里的 `target.artifactId`/`revisionId` 若指向被移动的 `plan:<old>`，改写为新 `plan:<new>` revision；指向被删章或无法解析的 target 清空。改写后 content 哈希变化，写新 revision。

### 2. 算法

1. 计算 `mapping`（旧→新）与 `deleted`（被删章号）；`affected = deleted ∪ {old !== new}`，identity 项（old===new）不参与。
2. 开事务；按 `affected` 把最新 artifact 读到临时结构。
3. 删除 `affected` 章在旧 ID 下的全部 artifact revision 与检索文档；identity 项不动。
4. 对每个 `old !== new` 的幸存章最新 artifact：
   - 生成新 artifactId；
   - 更新 `content.chapter`/`scope_chapter`/review target；
   - 重算 content-hash revision；
   - 若目标 `(artifactId, revisionId)` 已存在且内容不同 → `chapter-remap-conflict`，回滚；
   - 插入新 revision，更新检索文档。
5. 更新 chapters 的 mapping 与 `plan_revision`/`plan_approved_at`（清空受影响章）。
6. 提交；任一步失败回滚，章节与 artifact 保持原状。

- 临时 ID 只在事务内使用，避免 `plan:4→plan:5` 主键冲突；不把临时 ID 暴露给模型。
- 删除/移动都在事务前 `backupWork`（当前 move 无 backup，S1b 一并补上）；backup 是旧状态，恢复时按旧状态回滚。
- `search_docs` 若存在 artifact 文档，同步删除/重建；当前未索引的 artifact 不新增索引（S0.5 再统一）。

### 3. 与章节编辑阻断

- `chapter-edit-blocked` 不属于交付：删除/移动直接走重映射，没有阻断态。
- 删除/移动只经本 Note 的重映射；失败只保留 `chapter-remap-conflict`、`chapter-settled`、`chapter-edit-target-invalid` 与事务失败。
- 面板不需要新增动作；删/移按钮保持可用，受影响章的章纲确认显示为待重新确认。

### 4. 失败与边界

- `chapter-remap-conflict` 是数据损坏的防御断言：mapping 是现存章节的置换，受影响行的旧 ID 在任何插入前已删除，正常数据不触发；保留断言，不作为验收路径。
- 被删章/移动章含 settled 章节时，仍按现有 stage 规则处理（settled 守卫属于章节编辑，不属于 S1b）；S1b 不改变 stage 闸门。
- 不迁移旧作品；不引入 chapter UUID。
- review target 无法解析时清空，不阻断重映射；observation 语义仍归 #52。
- `chapter_plans` 保持空表；重映射不改它；表定义与 `applyChapterMapping` 里的残留引用随下一次作品 schema 版本清理。

## 备选方案

- **移动所有历史 revision**：content.chapter 变则每个 revision 哈希都变，且历史版本会与新章号交叉；否决。
- **保留旧 ID 并双读**：旧 ID 会指向另一章，无法区分；否决。
- **只在删除时清理、不处理移动**：移动同样会失配；否决。
- **引入稳定 chapter UUID**：更彻底但超出 S1b；保持章号身份。
- **S1b 不处理 review target**：会留下悬空引用；本切片只做清理/重绑，不定义 observation 生命周期。

## 验收条件

1. 删除/移动后，`plan`/`summary`/`review` 的 artifactId 章号段、`scope_chapter`、`content.chapter` 与新章号一致；旧 ID 不可读；`context`/`trace` 只同步 `scope_chapter`。
2. 只保留每章最新 revision；旧 revision 删除；不得把旧 revision 搬到新 ID。
3. 受影响章的 `plan_approved_at`/`plan_revision` 清空；未受影响章不变。
4. review target 指向被移动 memo 时重绑到新 revision；无法解析时清空；不定义新 observation 语义。
5. `chapter-edit-blocked` 不进入交付：删/移直接走重映射；delete/move 都在事务前 backup，backup 是旧状态；settled 章拒绝编辑。
6. 测试覆盖 plan/summary/review 的移动与删除、identity 项、审批清空、无 artifact、move/delete 都有 backup；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
7. `chapter-remap-conflict` 作为防御断言保留，不由正常数据触发，不作为验收路径。
8. 不引入 chapter UUID；不迁移旧作品；不改 stage 闸门；不改 context/trace 的 ID。

## 风险

- 重编号丢旧 artifact 历史，作者可能期望保留；需要在面板/文档明确“移动/删除会丢旧 revision 并要求重确认章纲”。
- 只保留最新 revision 会让审稿旧轮次不可读；S1b 的验收必须明确。
- review target 重绑会改变 review content hash；旧 review ID 不可读，UI 需要接受。
- 临时 ID/重算 revision 在事务内完成，失败必须整体回滚；实现要避免先删后插导致不可恢复。
- context/trace 没有生产者与 ID 方案；R12 之前若出现写入，重映射只迁 scope，旧 ID 会落在旧章号上。
