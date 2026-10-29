# Agent Note: 故事工坊：全书计划确认改为宿主闸门

Status: implemented

## 问题

「作者确认」目前有两种实现：全书计划由模型调 `story_outline(approve: true)` 记录；单章章纲由面板按钮走宿主路由。前者可被模型代签，后者不能。

## 决定

### 确认只在宿主

- 新 `approveOutline(root, {work})`：要求 `manifest.outline.writtenAt` 存在（`story_init` 预置的占位 `plan.md` 不算），写 `manifest.outline.approvedAt`；`writeOutline` 仍负责写内容并清空确认；
- 宿主路由 `POST /outline/approve`：入参 `{root, sessionId, workId}`，校验 `getCurrent(sessionId) === workId`，否则 `work-mismatch`；
- `story_outline` 保留 `approve` 参数但在动作层拒绝：`approve: true` 返回 `approval-moved`（`StoryError`），消息指向面板按钮，不静默忽略。

### 面板

- `readWork` 的 `manifest` 增加 `outline: {writtenAt?, approvedAt?}`；
- 工作详情页在「计划已写、未确认」时显示「确认全书计划」按钮，确认后显示「计划已确认」并隐藏按钮；
- 确认成功直接 `face.send`「全书计划已确认，按 story_next 给出的下一步继续」——不写死「第 1 章」，因为改计划可能发生在写过多章之后。

### 闸门不变

`story_plan` 继续要求 `outline.approvedAt`（`outline-required`）；写新计划清空确认（`writeOutline` 现有行为）。

## 备选方案

- **保留模型侧 `approve`**：两条确认机制继续并存；否决。
- **静默忽略 `approve`**：旧会话会以为已确认；否决，改为显式 `approval-moved`。
- **合并 `/outline/approve` 与 `/chapter/approve`**：参数与语义不同；否决，只共用会话校验。

## 验证

产品行为与验收由 #15 拥有；本节只说明这份设计怎样被证明：

1. `story_outline(approve: true)` 返回 `approval-moved`（tools 测试）；
2. 未确认时任何章的 `story_plan` 与 `story_next` 都指向 `story_outline`（tools 测试覆盖「后续章」与「定稿后下一章」）；
3. 面板确认后 `approvedAt` 有值（storage 测试）；按钮状态与直接发送可用（页面 spec）；
4. 再次写计划清空确认（storage 测试）；
5. `npm run verify-notes` 通过；13 套断言与 7 条页面 spec 全绿。

- 交付证据：13 套断言与 7 条页面 spec 全过；approve 动作被拒、任何章章纲闸门、面板确认与 story_next 一致

## 与既有记录的关系

与 `implemented/feature/2026-10-18-storycraft-outline-stage.md` 是**部分替代**：那份的提纲阶段、`outline-required` 时机与计划文件结构继续有效；本记录只取代「确认由模型动作完成」这一部分。两份记录互相链接。

本记录已随 #15 交付迁入 implemented。

## 后果

- 旧会话依赖 `approve: true` 会收到错误，需要作者点面板；
- 未进入作品时按钮不可用；
- 多一次点击，只发生在立项后一次。
