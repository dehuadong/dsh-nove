---
title: 故事工坊：L-R10a 章节身份与批准合同
status: implemented
created: 2026-10-24
updated: 2026-10-24
verification: 章节身份与作者批准合同已落地，批准 API/面板与测试通过；证据见 #55。
---

# Agent Note：故事工坊：L-R10a 章节身份与批准合同

## 问题

S1a/S1a-demo/合同补丁反复卡在同一组基础合同：章号既是章节身份又是 artifact ID 的一部分；批准绑定 memo revision 但首次正文写入会清空；`story_next.missing` 同时表达缺输入与等作者；旧作品没有 memo 的回退没有退出时点。

本 Note 只定章节身份、批准、`missing/blocked` 与旧回退四个基础合同；memo/summary/state 的迁移与切片排序由其他记录拥有。

## 与既有记录

- 产物字段由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 拥有；本 Note 只定章节身份、批准、`missing/blocked` 与旧回退。
- 切片排序由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有。
- 作者闸门归 #45；本 Note 不改变“模型不能代签”。
- 重映射算法、顺序与失败行为由 [`2026-10-24-storycraft-chapter-artifact-remap.md`](2026-10-24-storycraft-chapter-artifact-remap.md) 承接；本 Note 只定 owner 与批准失效规则。
- 本 Note **部分替代**以下记录的冲突条款，冲突以本 Note 为准：
  - [`2026-10-24-storycraft-memo-contract-patch.md`](../../rejected/pipeline/2026-10-24-storycraft-memo-contract-patch.md)（#54，已 rejected）的 `missing`/`blocked`、章节编辑阻断与批准入口条款；
  - [`2026-10-24-storycraft-memo-migration.md`](2026-10-24-storycraft-memo-migration.md) 的 `missing:['plan-approval']`、`planApproved` 回退与章节编辑条款；
  - 合同 v2 §2 的“memo 例外由 S1 实现”、consumer-migration S0 的“S0 负责 memo/review”。

## 对拍参考

上一版只用“超出 L-R10a”否决 chapter UUID，这是范围/成本理由，不是对拍证据，不能作为技术裁决。补查参考实现后，事实是：

- `inkos-master/packages/core/src/models/chapter.ts` 的 `ChapterMetaSchema` 只用 `number` 标识章节，没有 chapter UUID。
- `inkos-master/packages/core/src/state/chapter-workspace.ts` 的 `ChapterVersion.id` 是 `${timestamp}_${source}_${randomUUID()}`；UUID 在这里标识**正文版本文件**，章节仍用 `chapterNumber`。
- `inkos-master/packages/core/src/harness/source-sync.ts` 的 artifact revision 是 `rev-<sha256 前 16 位>`；artifactId 是“可读名 + 路径哈希”，也不是 UUID。

因此本 Note 的裁决是：

- **章节身份保持 number**，与参考实现的 `ChapterMeta.number` 一致；不引入 chapter UUID。
- 参考实现的 UUID 出现在 **chapter version**，不是 chapter identity。我们当前 `chapter_versions` 用整数 revision，这是另一个对拍差异，单独立项，不混入本章节身份合同。
- 如果目标要求的是“正文版本 UUID”，应新增 S1c 处理 `chapter_versions` 的身份与迁移；本章节合同不覆盖。

## 决定

### 1. 章节身份与重映射 owner

- **章节号就是作品内身份**；不引入 chapter UUID。`chapters.number`、`plan:<n>`、`summary:<n>`、`review:<n>:r<bodyRev>:<round>` 都以章号作为 identity 的一部分。
- 移动/删除/重排是 **identity 变更**：旧章号下的 artifact 历史不保留；只保留每章最新 revision；旧 ID 不可复用给另一章内容，但编号可被新章使用（必须新内容/新 revision）。
- **S1b 拥有按章 artifact 的重映射**：`plan`/`summary`/`review` 的 artifactId 章号段、`scope_chapter` 与 `content.chapter`，以及 review 内 `target.artifactId`/`revisionId` 与 `sourceRefs` 的章号引用。`state` 是作品级（无 `scope_chapter`、revision 为事件序号），不参与。
- **R12 拥有 context/trace 的 ID 方案**：这两类 artifact 目前没有生产者，其 artifactId 不按章号编码。删除/移动只把已有行的 `scope_chapter` 跟到新章号，不改 ID；R12 引入生产者时必须同时落 ID 方案与同样的 identity-change 重映射规则，否则旧 ID 会与新章号失配。
- 删除/移动在 backup 与写事务前拒绝含已定稿章的编辑；重映射本身在事务内完成，临时 ID 只在事务内使用并重算 content-hash revision，不允许悬空 revision。
- **批准清空不依赖 artifact**：删除/移动对 `deleted ∪ {old !== new}` 中每章无条件清空 `plan_revision`/`plan_approved_at`；即使该章没有 artifact 也执行。重映射时同样清空，保持幂等。
- `chapter-remap-conflict` 是**数据损坏的防御断言**：mapping 是现存章节的置换，受影响行的旧 ID 在任何插入前已删除，正常数据不触发；保留断言，不作为验收路径。
- `chapter_plans` 是退役空表：不再写入、不再读取；其表定义与章节改名循环里的残留引用随下一次作品 schema 版本清理，不影响 identity 变更语义。

### 2. 批准

- 批准对象是 **memo 当前 revision**，不是正文 revision。
- `planApproval` 是作品级持久设置：`required`（默认）或 `off`。
- **非抛出读取**：`planApprovalState(db, number)` 返回 `{ required, approved, blocked, hasMemo }`；`blocked` 是 boolean，`story_next` 再映射为数组。无 memo 时 `hasMemo:false`，由调用方返回 `story_plan`/`plan-not-found`，不当作 blocked；无 memo 不提供批准状态，也不返回附加原因字段，错误码由写入路径给出。
- **抛出写入闸门**：`assertPlanApproved(db, number)` 供 `writeChapter`/`reviseChapter` 使用；无 memo 抛 `plan-not-found`，未批准抛 `plan-not-approved`。delegate 与 context 的派发前检查读 `readManifest` 投影的 `planApproved`，它与 `assertPlanApproved` 用同一 memo revision 绑定，不重复实现判定。
- `required` 时：
  - 批准绑定 `plan:<n>` 最新 revision；memo 改写、章节重编号、章节删除使批准失效；
  - **正文首版/重写/修订不清空批准**；批准跨正文版本保留，直到 memo 或章节身份变化；
  - 有 memo：`plan_approved_at` 非空且 `plan_revision` 等于最新 revision。
- `off` 时 `planApprovalState` 返回 approved，`assertPlanApproved` 直接通过，不产生 `plan-not-approved`。
- 无 memo 不提供过渡回退：任何“无 memo 即已批准”的路径都移除，写正文与修订以 `plan-not-found` 拒绝。
- `readManifest`/`readWork` 的 `planApproved` 必须按 memo revision 匹配计算；`status` 不暴露 `planApproved`。
- 错误顺序：
  | 路径 | 顺序 |
  | --- | --- |
  | `story_next` | 只读，返回 `blocked`，不抛错 |
  | `writeChapter` | 参数（含 empty-body）→ 章节与 memo 存在（`plan-not-found`）→ 批准 → settled/chapter-exists → 字数 |
  | `reviseChapter` | 参数（body/mode/problemIds）→ 章节与正文存在（`body-not-found`）→ settled → 批准 → review 覆盖 → 未处理条目 |
  | delegate writer | 章节与 memo 存在 → settled → 批准 → chapter-exists |
  | delegate reviewer | 章节与正文存在 → settled |
  | delegate reviser | 章节与正文存在 → settled → 批准 → review 覆盖 → 未处理条目 |
  | `context.js` writer/reviser | 章节存在 → 章纲存在 → 批准 → 人物卡/正文等其余输入 |

### 3. `missing` 与 `blocked`

- `missing` 只表示调用方/宿主可补的输入：`body`、`review`、`revision`、`summary`、`volume-summary`、open review ids、**outline（尚未写全书计划）**。
- `blocked` 表示必须等作者/宿主动作：`outline-approval`、`plan-approval`。
- `story_next` 增加可选 `blocked` 数组；`action` 是阻断解除后的下一步；`blocked` 非空时模型不得执行 action，delegate 不出现。
- `outline` 的两种状态：
  - 未写 outline：`action:'story_outline'`、`missing:['outline']`，不带 `blocked`；
  - outline 已写未批准：`action:'story_plan'`、`blocked:['outline-approval']`。
- plan 未批准：只有 `story_write`/`story_revise` 带 `blocked:['plan-approval']`；`story_review`/`story_summarize`/`story_settle` 不受 plan 批准阻断（审稿/摘要/定稿不写正文）。
- `missing` 不再含 `plan-approval`/`outline-approval`；`delegateOf` 同时按 `missing` 与 `blocked` 抑制。
- `story_next` 的工具描述与 orchestration 技能必须说明 blocked 语义；旧会话忽略 blocked 时按现有 missing 行为降级。

### 4. 过渡与交付边界

- 无 memo 的 `plan_approved_at` 回退不进入现行合同：无 memo 一律 `plan-not-found`，不保留“无 memo 即已批准”的双源。
- 不建立独立 S1a 工作项；`chapter-edit-blocked` 不属于现行合同——删除/移动直接走 S1b 重映射，没有阻断态。
- #54 合同补丁已 rejected，不拥有任何现行条款；`blocked` 语义与批准入口由本 Note 唯一拥有。
- `writePlan` 的 store 入口允许省略 `body`（测试 fixture 的既有调用面），`story_plan` 工具边界用 `requireBody` 强制；产品契约以工具边界为准。

## 备选方案

- **引入稳定 chapter UUID**：更彻底但改 chapters/artifacts/消费者/UI，超出 L-R10a；否决。
- **S0 负责 memo 重映射**：与 #51/consumer-migration 的“memo/artifact 归 S1b”冲突；否决，统一归 S1b。
- **批准绑定正文 revision**：memo 改写后正文批准仍有效，闸门失真；否决。
- **继续用 `missing` 表达审批**：无法区分可补输入与必须等作者；否决。
- **永久保留无 memo 回退**：S1a-demo 后双源；否决。
- **阻断所有章节编辑直到 S1b**：只阻断 mapping/deleted 中存在 artifact 的编辑，范围更窄。
- **由 S1b 同时改写 context/trace 的 ID**：当前没有生产者，改号规则无从验证，且与 R12 的 ID 方案可能冲突；改为 R12 落地时接同一 identity 规则。

## 后果

章节身份与批准合同固定，面板/API 对同一章使用同一身份与批准时间。

## 验证

实际验证：批准 API/面板测试与 `ci --no-e2e` 通过；证据见 #55。

1. 章节号身份、identity-change 例外、S1b 为 `plan`/`summary`/`review` 重映射唯一 owner、`state` 不参与、`context`/`trace` ID 归 R12，在合同 v2、consumer-migration、S1b Note 与 #51 中表述一致。
2. 删除/移动后，`plan`/`summary`/`review` 的 artifactId 章号段、`scope_chapter`、`content.chapter` 与新章号一致；旧 ID 不可读；identity 章不变；未受影响章不变；`context`/`trace` 只随 `scope_chapter`。
3. `deleted ∪ {old !== new}` 中每章的批准无条件清空（无 artifact 也清）；未受影响章保留；delete/move 都在事务前 backup，backup 是旧状态。
4. 批准绑定最新 memo revision；正文首版/重写/修订不清空；`off` 放行；无 memo 为 `plan-not-found`。
5. `planApprovalState`/`assertPlanApproved` 的返回值与错误码按 §2；`readManifest`/`readWork` 的 `planApproved` 按 revision 匹配；`status` 不暴露 `planApproved`。
6. `story_next` 三种形状（absent outline、unapproved outline、unapproved plan）按 §3；`NEXT_OUTPUT` schema 显式声明 `action`/`chapter`/`missing`/`blocked`；只有 write/revise 带 plan-approval；delegate 同时按 `missing`/`blocked` 抑制；技能与工具描述同步。
7. 错误顺序按 §2 表，逐路径有测试。
8. `chapter-remap-conflict` 作为防御断言保留，不作为验收路径。
9. 测试覆盖 identity/批准/blocked/错误顺序/最后章/无 artifact/identity 章，更新 `memo-consumers`、`artifact-remap`、`chapter-edit`、`store-chapter`、`storage`、`tools`、`delegate`、`context`、`foundation-chapter-artifacts`、`state-check`/`settle`、`bible`、`export` 中受影响的断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
10. 不实现 summary/state/foundation 迁移、observation 生命周期；context/trace 的 ID 方案在 R12 落地。

## 风险

- 章节号身份意味着重编号丢旧 artifact 历史；作者需要知道移动/删除会要求重新确认章纲。
- `blocked` 是新输出字段，旧会话可能忽略；靠工具描述与技能兜底。
- context/trace 在 R12 前没有 ID 方案；若在此之前新增生产者，会出现旧 ID 与新章号失配，必须先落 ID 合同。
- 删除/移动会让面板暂时要求重新确认章纲；面板必须显示原因，不静默清批准。
