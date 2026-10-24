---
title: 故事工坊：L-R10a 章节身份与批准合同
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a 章节身份与批准合同

## 问题

S1a/S1a-demo/合同补丁反复卡在同一组基础合同：

- 章节用号码做身份，移动/删除会重编号；memo/summary/review 的 artifact ID 也嵌章号，重编号后 revision 与批准会失配。
- 作者批准当前绑在 `chapters.plan_approved_at`/`plan_revision`；首次正文落盘会清空批准，导致“批准是否跨正文版本保留”没有定论。
- `story_next.missing` 同时承载“缺输入”和“等作者批准”，delegate 也按 `missing` 抑制，无法区分可执行与阻断。
- 旧作品没有 `plan:<n>`，`planGateSatisfied` 保留“无 memo 即已批准”的回退；S1a 要删它但没有过渡合同。

本 Note 只定这四个基础合同，不实现 memo/summary/state 迁移。

## 与既有记录

- 产物字段由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 拥有；本 Note 只定章节身份、批准、`missing/blocked` 与旧回退。
- 切片排序由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；S1a-demo 与合同补丁依赖本 Note。
- 作者闸门归 #45；本 Note 不改变“模型不能代签”。
- 本 Note **部分替代**以下记录的冲突条款，三者以本 Note 为准，实施时同步删改：
  - [`2026-10-24-storycraft-memo-contract-patch.md`](2026-10-24-storycraft-memo-contract-patch.md) 的 `missing`/`blocked`、章节编辑阻断与批准入口条款；
  - [`2026-10-24-storycraft-memo-migration.md`](2026-10-24-storycraft-memo-migration.md) 的 `missing:['plan-approval']`、`planApproved` 回退与章节编辑条款；
  - #53/#54 中与上述冲突的验收项。

## 提案

### 1. 章节身份

- **章节号就是作品内身份**；不引入第二套 chapter UUID。`chapters.number`、`plan:<n>`、`summary:<n>`、`review:<n>:...` 都以章号为 identity 的一部分。
- 移动/删除/重排是 **identity 变更**：旧章号下的 artifact 历史不保留；只保留最新 memo 并迁到新章号；旧 ID 不可复用给另一章内容，但编号可被新章使用（必须新内容/新 revision）。
- 在 S0 提供通用 artifact 重映射之前，删除/移动 **mapping 中任一章节（含被删章、旧!=新的幸存章）存在 `plan:<n>`** 时返回 `chapter-edit-blocked`；检查在 backup/写事务之前。
- 重映射实现时：临时 ID 去主键冲突、重算 content-hash revision、清空受影响章的 `plan_revision`/`plan_approved_at`；不允许悬空 revision。

### 2. 批准

- 批准对象是 **memo 当前 revision**，不是正文 revision。
- `planApproval` 是作品级持久设置：`required`（默认）或 `off`。
- `required` 时：
  - 批准绑定 `plan:<n>` 最新 revision；memo 改写、章节重编号、章节删除使批准失效；
  - **正文首版/重写/修订不清空批准**；批准跨正文版本保留，直到 memo 或章节身份变化；
  - `writeChapter`/`reviseChapter` 在参数/章节/正文存在性校验后、review/字数/状态检查前检查批准；
  - delegate writer/reviser preflight、`context.js` writer 分支、`story_next` 使用同一判定。
- `off` 时所有写正文路径放行，不产生 `plan-not-approved`。
- **过渡**：S1a 生产 memo 之前，没有 `plan:<n>` 的作品继续按 `plan_approved_at` 非空视为已批准；S1a 在同一交付中切换为“必须有 memo revision 匹配”，不留永久 legacy 回退。新作品从 S1a 起写 memo。

### 3. `missing` 与 `blocked`

- `missing` 只表示调用方/宿主可补的输入：`body`、`review`、`revision`、`summary`、`volume-summary`、open review ids 等。
- `blocked` 表示必须等作者/宿主动作：`outline-approval`、`plan-approval`。
- `story_next` 增加可选 `blocked` 数组；`action` 仍是阻断解除后的下一步；`blocked` 非空时模型不得执行 action，delegate 不出现。
- `missing` 不再新增 `plan-approval`/`outline` 作为阻断项；`delegateOf` 同时按 `missing` 与 `blocked` 抑制。
- `story_next` 的工具描述与 orchestration 技能必须说明 blocked 语义；旧会话忽略 blocked 时按现有 missing 行为降级。

### 4. 章节编辑阻断的 owner

- 合同补丁/ S1a-demo 只实现“有 memo 时阻断”，不实现重映射。
- S0 接管通用 artifact 生命周期与重映射后，移除阻断；S0 的范围必须显式包含 memo，不再写“memo 归 S1”。
- 阻断期间面板必须提示“等 S0 重映射”，不能只返回错误码。

## 备选方案

- **引入稳定 chapter UUID**：能避免重编号失配，但要改 chapters/artifacts/所有消费者与 UI，超出 L-R10a；否决。
- **批准绑定正文 revision**：memo 改写后正文批准仍有效，闸门会失真；否决。
- **继续用 `missing` 表达审批**：无法区分“可补输入”和“必须等作者”；否决。
- **永久保留无 memo 回退**：S1a 后新旧双源；否决，只在 S1a 交付前过渡。
- **阻断所有章节编辑直到 S0**：范围过大；只阻断 mapping 内有 memo 的编辑。

## 验收条件

1. 章节号身份、identity-change 例外、旧 ID 不可复用规则写入合同；移动/删除在 mapping 内有 memo 时于 backup 前 `chapter-edit-blocked`。
2. `required` 下批准绑定 memo revision、跨正文版本保留；memo 改写/重编号/删除使批准失效；`off` 放行。
3. `writeChapter`/`reviseChapter`/delegate/context/nextStep 统一调用 `assertPlanApproved`；错误顺序为参数/存在性 → 批准 → review/字数/状态；`off` 在 helper 内直接放行。
4. `story_next` schema 声明 `blocked`；`missing` 不再含 `plan-approval`/`outline`；delegate 同时按两者抑制；技能/工具描述同步。
5. 无 memo 的过渡回退只在 S1a 交付前存在，S1a 同一交付移除并测试。
6. 测试覆盖 identity/批准/blocked/过渡/错误顺序；`chapter-edit`、`store-chapter`、`storage`、`tools` 等既有断言同步更新；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
7. 不实现 memo/summary/state 迁移、章节重映射、observation；这些由 S1a/S0/#52 承接。

## 风险

- 章节号身份意味着重编号必然丢旧 artifact 历史；作者需要知道“移动/删除会要求重新确认章纲”。
- `blocked` 是新输出字段，旧会话可能忽略；必须靠工具描述与技能兜底。
- 过渡回退如果与 S1a 不在同一交付移除，会重新变成双源。
- 阻断章节编辑会让面板暂时失去删/移能力；S0 前必须显示原因。
