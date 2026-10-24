---
title: 故事工坊：L-R10a S1a-demo 合同补丁
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10a S1a-demo 合同补丁

## 问题

S1a-demo 的三条链路卡在既有接口上：

1. `story_next` 用 `missing` 同时表达“缺输入”和“等作者批准”，且 schema 没有独立的阻断字段；调用方无法区分“可以继续”和“必须等作者”。
2. 章节删除/移动会重编号所有幸存章；只在被编辑章上检查 memo 会留下失配的 `plan:<n>`。
3. 批准闸门分散在 `writeChapter` 的可选 `requirePlanApproval`、`reviseChapter` 的缺省路径与 delegate/context 的各自检查里，入口不唯一。

本 Note 只定这三个合同补丁，不实现 S1a-demo，不迁移 memo。

## 与既有记录

- S1a-demo 的范围与验收见 [`2026-10-24-storycraft-memo-migration.md`](2026-10-24-storycraft-memo-migration.md)；本 Note 是它的前置合同。
- 作者闸门归 #45；memo 字段归 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md)。
- 章节编辑重映射归 S0；本 Note 只定义“有 memo 时阻断”的合同，不实现重映射。

## 提案

### 1. `story_next.blocked`

- `NEXT_OUTPUT.schema` 增加可选 `blocked` 数组，元素枚举 `plan-approval`。
- `missing` 保持现有语义：缺 body/review/revision 等输入；`blocked` 表示必须等宿主/作者动作。
- required 且未批准时：
  - `action` 仍是批准后的下一步（无正文 `story_write`、有正文待审 `story_review`、有审稿待改 `story_revise`）；
  - `blocked: ['plan-approval']`；`delegate` 不出现；
  - 模型不得在 `blocked` 非空时执行 `action`，应请作者在面板确认章纲。
- **`blocked` 是增量字段**：`missing` 保留现有语义与 `plan-approval` 项（`delegateOf` 已按它抑制 delegate）；不把 `missing` 改成全局阻断。`blocked` 只用于“必须等作者动作”。
- `missing` 可以同时存在（如 `body`、open review ids），`blocked` 优先表示不可执行。
- `nextStep` 在 pre-body 与 has-body（review/revise/rewrite）状态都返回 blocked；追加 `plan-approval` 到 `missing` 时不得丢掉已有 body/review/revision 项。
- `story_next` 的 render 只显示 blocked 原因，不改变其他动作的 `missing` 语义。

### 2. 章节编辑阻断

- `deleteChapter`/`moveChapter` 在确认参数（confirm、chapter 存在）后、进入 mapping/backup/写事务前计算完整 `chapterRemap`（含所有幸存章与身份项）。
- 若 mapping 中任一章（被删/被移/`old !== new`）存在 `plan:<n>` artifact，抛 `chapter-edit-blocked`，消息指向 S0 重映射。
- `deleteChapter` 的 `backupWork` 之前检查；`moveChapter` 没有 backup，检查放在 mapping 写事务之前。
- 不允许只检查被编辑章；否则删一个无 memo 的章会让后续有 memo 的章失配。最后章删除也按同一规则：被删章有 memo 即阻断。
- `chapter-edit-blocked` 是临时限制，S0 完成后移除。

### 3. 统一批准入口

- 在 `store-db.js` 增加 `assertPlanApproved(db, number)`：复用现有 `planGateSatisfied` 语义。读 `meta.plan_approval`；`off` 直接通过；`required` 时：
  - 有 `plan:<n>`：要求 `plan_approved_at` 非空且 `plan_revision` 等于最新 revision；
  - 无 memo（旧作品）：保持现有 legacy 回退（`plan_approved_at` 非空即通过），避免 A0 前的作品全部被阻断。
- **正文写入不再消费批准**：移除 `writeChapter` 在 `revision===1` 时清空 `plan_approved_at`/`plan_revision` 的逻辑；批准只随 memo 改写/章节重编号失效。否则“任何写正文都检查批准”会让首次落盘后所有 rewrite/revise 失败。
- `writeChapter`：先做参数/body 校验与章节存在检查，再调用 `assertPlanApproved`，最后做字数/版本校验；移除“只在 `current_revision===0` 检查”和调用方可选 `requirePlanApproval` 的绕过路径。
- `reviseChapter`：先做 body/mode/problemIds 参数校验与章节/正文存在检查，再调用 `assertPlanApproved`，最后做 review 覆盖/prob 校验；`plan-not-approved` 在 review 检查之前，但不掩盖参数错误。
- `delegate.js` 的 writer/reviser preflight、`context.js` 的 writer 分支、`nextStep` 的 blocked 判断共用同一 helper 或同一读取结果，不各自复制审批规则；delegate 的既有 chapter-settled/chapter-exists 顺序保持在审批之前。
- `planApproval: off` 时 helper 不产生任何错误，所有路径保持现有行为。

### 4. 边界与 owner

- 本 Note 只定三个合同；memo 生产/消费、`readWork` 的 `planApproved`、面板提示与技能文档更新归 #53 实现。
- `story_next` 的工具描述与 orchestration 技能必须同步说明“`blocked` 非空时不得执行 action”；这属于 #53 的实现验收，不在本 Note 直接改技能。
- `requirePlanApproval` 的旧调用方/测试在 #53 中移除或更新；本 Note 只规定 store 内统一判定。

## 备选方案

- **继续用 `missing` 表达审批阻断**：现有 `missing` 表示普通缺输入，混用会让调用方误判；否决。
- **只在 `writeChapter` 加检查**：`reviseChapter`/delegate 仍可绕过；否决。
- **章节编辑只检查被编辑章**：幸存章会失配；否决。
- **在 S1a-demo 内做完整 memo 重映射**：把 S0 的 FK/批准/revision 问题带进来；本 Note 只阻断，不重映射。

## 验收条件

1. `NEXT_OUTPUT.schema` 声明 `blocked`；`story_next` 在 required 未批准时返回 `blocked:['plan-approval']`、`delegate` 缺失；`off` 时不返回 blocked。
2. `deleteChapter`/`moveChapter` 在 mapping 内任一 memo 存在时于 backup 前返回 `chapter-edit-blocked`；无 memo 时行为不变。
3. `writeChapter`/`reviseChapter` 在 required 未批准时返回 `plan-not-approved`，且该错误优先于 body/review 校验；`off` 时放行。
4. delegate writer/reviser preflight 与 `nextStep` 使用同一 helper；未批准时不启动子代理。
5. 测试覆盖 blocked schema/off、章节编辑阻断（含删无 memo 章/最后章）、write/revise 闸门与优先级、delegate/nextStep、`context.js` writer；更新既有 `missing`/`requirePlanApproval` 断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
6. 不改变 `missing` 的既有语义；不实现 memo 迁移/章节重映射/observation。
7. #53 的验收必须包含：`story_next` 描述/orchestration 技能说明 blocked、面板 `chapter-edit-blocked` 提示、`readWork.planApproved` 回退删除。

## 风险

- `blocked` 是新输出字段，旧会话/旧客户端可能忽略；缺失时按现有 `missing` 行为处理。
- 章节编辑阻断会让有 memo 的作品暂时不能删/移章；面板必须提示“等 S0 重映射”，否则作者会认为是 bug。
- store 级 helper 改变错误顺序，可能影响既有测试断言；需逐项更新。
