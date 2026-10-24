---
title: 故事工坊：L-R10a 章节身份与批准合同
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a 章节身份与批准合同

## 问题

S1a/S1a-demo/合同补丁反复卡在同一组基础合同：章号既是章节身份又是 artifact ID 的一部分；批准绑定 memo revision 但首次正文写入会清空；`story_next.missing` 同时表达缺输入与等作者；旧作品没有 memo 的回退没有退出时点。

本 Note 只定四个基础合同，不实现 memo/summary/state 迁移。

## 与既有记录

- 产物字段由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) 拥有；本 Note 只定章节身份、批准、`missing/blocked` 与旧回退。
- 切片排序由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；S1a-demo、合同补丁与 S1b 依赖本 Note。
- 作者闸门归 #45；本 Note 不改变“模型不能代签”。
- 本 Note **部分替代**以下记录，冲突以本 Note 为准，实施时同步删改：
  - [`2026-10-24-storycraft-memo-contract-patch.md`](../../rejected/pipeline/2026-10-24-storycraft-memo-contract-patch.md)（#54，已 rejected）的 `missing`/`blocked`、章节编辑阻断与批准入口条款；
  - [`2026-10-24-storycraft-memo-migration.md`](2026-10-24-storycraft-memo-migration.md) 的 `missing:['plan-approval']`、`planApproved` 回退与章节编辑条款；
  - 合同 v2 §2 的“memo 例外由 S1 实现”、consumer-migration S0 的“S0 负责 memo/review”、#51 的“memo 生命周期归 S1”；
  - #53 中与上述冲突的验收项；#54 已关闭并进入 rejected。

## 提案

### 1. 章节身份与重映射 owner

- **章节号就是作品内身份**；不引入 chapter UUID。`chapters.number`、`plan:<n>`、`summary:<n>`、`review:<n>:...` 都以章号为 identity 的一部分。
- 移动/删除/重排是 **identity 变更**：旧章号下的 artifact 历史不保留；只保留每章最新 revision；旧 ID 不可复用给另一章内容，但编号可被新章使用（必须新内容/新 revision）。
- **S1b 拥有全部 chapter-scoped artifact 的重映射**：`scope_chapter` 非空的 plan/summary/review/context/trace；state 是作品级（无 scope_chapter、rev seq），不参与。S0 只负责 chapters/versions/events/facts 等非 artifact 章节字段，不拥有 memo。[`2026-10-24-storycraft-chapter-artifact-remap.md`](2026-10-24-storycraft-chapter-artifact-remap.md)（#56）是唯一实现 owner。
- S1b 之前，删除/移动时若 **deleted ∪ `{old !== new}` 中任一章存在 `scope_chapter` artifact**，在 backup/写事务前返回 `chapter-edit-blocked`；不是只查 `plan:<n>`，也不把 identity 项算进去。
- S1b 实现与阻断移除同一交付；不允许先解除阻断再补重映射。
- 重映射时临时 ID 只在事务内、重算 content-hash revision；不允许悬空 revision。
- **批准清空不依赖 artifact**：`deleteChapter` 在删行前清空被删章的 `plan_revision`/`plan_approved_at`；`applyChapterMapping` 对每个 `old !== new` 章节清空；即使没有 artifact 也执行。S1b 重映射时同样清空，保持幂等。

### 2. 批准

- 批准对象是 **memo 当前 revision**，不是正文 revision。
- `planApproval` 是作品级持久设置：`required`（默认）或 `off`。
- **非抛出读取**：`planApprovalState(db, number)` 返回 `{ required, approved, blocked, hasMemo }`；`blocked` 是 boolean，`story_next` 再映射为数组。无 memo 时 `hasMemo:false`，由调用方返回 `story_plan`/`plan-not-found`，不当作 blocked。
- **抛出写入闸门**：`assertPlanApproved(db, number)` 供 `writeChapter`/`reviseChapter` 使用；不通过抛 `plan-not-approved`。
- `required` 时：
  - 批准绑定 `plan:<n>` 最新 revision；memo 改写、章节重编号、章节删除使批准失效；
  - **正文首版/重写/修订不清空批准**；批准跨正文版本保留，直到 memo 或章节身份变化；
  - 有 memo：`plan_approved_at` 非空且 `plan_revision` 等于最新 revision；
  - 无 memo（过渡）：`plan_approved_at` 非空即通过；#53 S1a-demo 在同一交付移除该回退，之后无 memo 为 `plan-not-found`。
- `off` 时 `planApprovalState` 返回 approved，`assertPlanApproved` 直接通过，不产生 `plan-not-approved`。
- 无 memo：`planApprovalState` 返回 `{ hasMemo:false, approved:false, blocked:false, reason:'plan-missing' }`；`assertPlanApproved` 抛 `plan-not-found`（#53 移除回退后）。
- 错误顺序：
  | 路径 | 顺序 |
  | --- | --- |
  | `story_next` | 只读，返回 `blocked`，不抛错 |
  | `writeChapter` | 参数（含 empty-body）/章节存在 → 批准 → 字数/版本/状态 |
  | `reviseChapter` | 参数 body/mode/problemIds/章节/正文存在 → 批准 → review 覆盖 |
  | delegate writer/reviser | 章节存在/settled → 批准 → 角色预检 |
  | `context.js` writer | 章节/角色 → 批准 |

### 3. `missing` 与 `blocked`

- `missing` 只表示调用方/宿主可补的输入：`body`、`review`、`revision`、`summary`、`volume-summary`、open review ids、**outline（尚未写全书计划）**。
- `blocked` 表示必须等作者/宿主动作：`outline-approval`、`plan-approval`。
- `story_next` 增加可选 `blocked` 数组；`action` 是阻断解除后的下一步；`blocked` 非空时模型不得执行 action，delegate 不出现。
- `outline` 的两种状态：
  - 未写 outline：`action:'story_outline'`、`missing:['outline']`；
  - outline 已写未批准：`action:'story_plan'`、`blocked:['outline-approval']`。
- plan 未批准：只有 `story_write`/`story_revise` 带 `blocked:['plan-approval']`；`story_review`/`story_summarize`/`story_settle` 不受 plan 批准阻断（审稿/摘要/定稿不写正文）。
- `missing` 不再含 `plan-approval`/`outline-approval`；`delegateOf` 同时按 `missing` 与 `blocked` 抑制。
- `story_next` 的工具描述与 orchestration 技能必须说明 blocked 语义；旧会话忽略 blocked 时按现有 missing 行为降级。

### 4. 过渡与交付边界

- 无 memo 的 `plan_approved_at` 回退是 **S1a-demo 之前** 的过渡；#53 S1a-demo 是唯一移除 owner，同一交付更新 `readManifest`/`readWork`/测试。
- 不建立独立 S1a 工作项；#53 就是 S1a-demo。
- #54 合同补丁已 rejected，不拥有任何现行条款；`blocked`/章节编辑阻断/批准入口由本 Note 唯一拥有。

## 备选方案

- **引入稳定 chapter UUID**：更彻底但改 chapters/artifacts/消费者/UI，超出 L-R10a；否决。
- **S0 负责 memo 重映射**：与 #51/consumer-migration 的“memo/artifact 归 S1b”冲突；否决，统一归 S1b。
- **批准绑定正文 revision**：memo 改写后正文批准仍有效，闸门失真；否决。
- **继续用 `missing` 表达审批**：无法区分可补输入与必须等作者；否决。
- **永久保留无 memo 回退**：S1a-demo 后双源；否决。
- **阻断所有章节编辑直到 S1b**：只阻断 mapping/deleted 中存在 artifact 的编辑，范围更窄。

## 验收条件

1. 章节号身份、identity-change 例外、S1b 为唯一重映射 owner 写入合同；S0/consumer-migration/contract v2 的冲突表述同步删除。
2. S1b 前，deleted ∪ `{old !== new}` 中任一 `scope_chapter` artifact 存在时，删/移在 backup/写事务前 `chapter-edit-blocked`；identity 项不算，最后章/被删章覆盖。
3. `planApprovalState`/`assertPlanApproved` 行为、`off` 放行、正文写入不清批准、无 memo 过渡回退与 #53 移除均有测试。
4. 错误顺序按 §2 表；`story_next` 只读不抛。
5. `NEXT_OUTPUT` schema 显式声明 `action`/`chapter`/`missing`/`blocked`；行为覆盖 absent outline、unapproved outline、unapproved plan 三种形状；`planApprovalState.blocked` 是 boolean，`story_next.blocked` 是数组；只有 write/revise 带 plan-approval；`missing` 不再含审批项；delegate 同时按 `missing`/`blocked` 抑制；技能/工具描述同步。
6. 测试覆盖 identity/批准/blocked/过渡/错误顺序/最后章；更新 `chapter-edit`、`store-chapter`、`storage`、`tools`、`delegate`、`context`、`foundation-chapter-artifacts`、`state-check`/`settle`、`bible`、`export` 中受影响的断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
7. 不实现 memo/summary/state 迁移、章节重映射、observation；这些由 #53/#56/#52 承接。

## 风险

- 章节号身份意味着重编号丢旧 artifact 历史；作者需要知道移动/删除会要求重新确认章纲。
- `blocked` 是新输出字段，旧会话可能忽略；靠工具描述与技能兜底。
- 过渡回退若与 #53 不同交付移除，会重新变成双源。
- 阻断章节编辑会让面板暂时失去删/移能力；S1b 前必须显示原因。
