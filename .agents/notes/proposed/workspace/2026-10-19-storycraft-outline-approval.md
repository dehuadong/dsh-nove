---
title: 故事工坊：全书计划确认改为宿主闸门
status: proposed
created: 2026-10-19
updated: 2026-10-19
---

# Agent Note：故事工坊：全书计划确认改为宿主闸门

## 问题

「作者确认」目前有两种实现：全书计划由模型调 `story_outline(approve: true)` 记录；单章章纲由面板按钮走宿主路由。前者可被模型代签，后者不能。

## 提案

### 确认只在宿主

- 新 `approveOutline(root, {work})`：要求 `manifest.outline.writtenAt` 存在（`story_init` 预置的占位 `plan.md` 不算），写 `manifest.outline.approvedAt`；`writeOutline` 仍负责写内容并清空确认；
- 宿主路由 `POST /outline/approve`：入参 `{root, sessionId, workId}`，校验 `getCurrent(sessionId) === workId`，否则 `work-mismatch`；
- `story_outline` 删除 `approve` 参数；传入时返回 `approval-moved`（`StoryError`），消息指向面板按钮，不静默忽略。

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

## 验收条件

1. `story_outline(approve: true)` 返回 `approval-moved`，不写确认；
2. 未确认时 `story_plan` 仍 `outline-required`；
3. 面板确认后 `approvedAt` 有值，`story_plan` 可用（任何章，不只是第 1 章）；
4. 再次写计划清空确认；此后任何 `story_plan` 都被 `outline-required` 拒绝；
5. 面板按钮状态与直接发送行为可用；
6. 13 套断言与 6 条页面 spec 不回归。

## 风险

- 旧会话依赖 `approve: true` 会收到错误，需要作者点面板；
- 未进入作品时按钮不可用；
- 多一次点击，只发生在立项后一次。
