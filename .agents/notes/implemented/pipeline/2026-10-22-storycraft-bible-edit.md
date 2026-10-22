---
title: 故事工坊：真值编辑入口
status: implemented
created: 2026-10-22
updated: 2026-10-22
verification: 32 单测 + 17 E2E；临时克隆雪线邮路编辑 world、plan 拒绝；作者库未动
---

# Agent Note：故事工坊：真值编辑入口

## 问题

真值面板只读；作者想直接改世界、人物、文风、意图，只能让模型调 `story_bible_write`，或手工改库。五件真值已有 `writeBible` 校验、内容版本与写前装配，缺作者入口。

`plan` 是全书计划，走 `story_outline` + 作者确认；不能借真值编辑器绕过闸门。

## 决定

### 1. 可编辑范围

| 文件 | 可编辑 | 校验 |
| --- | --- | --- |
| world | 是 | 非空 Markdown，拒绝 TODO/待定 |
| characters | 是 | 六字段 JSON 数组 |
| style | 是 | 非空 Markdown |
| intent | 是 | 允许空（沿用现状） |
| plan | 否 | 全书计划确认流程 |

- 缺失的可编辑真值可「新建」；
- 缺失 plan 只显示「用全书计划创建」；
- 编辑内容由服务端 `writeBible` 校验，客户端不做唯一真相；
- `EDITABLE_BIBLE_FILES = Object.keys(BIBLE_FILES).filter(name => name !== 'plan')`、`assertEditableBible` 放在 `bible.js`，路由/工具共用；`writeBible` 对 `plan` 默认拒绝，不提供 `allowPlan`；测试 fixture 的 plan 改用 `writeOutline`，且要求 `content` 是 string。

### 2. 路由

`POST /api/dsh-storycraft/bible/write`

```json
{"root":"...","sessionId":"...","workId":"...","file":"world","content":"...","expectedVersion":"..."}
```

- `writeWorkTarget(body)` 校验 session 当前作品；
- JSON、64KB raw body；超限 `body-too-large`；
- `file` 只允许四件可编辑；`plan` → `approval-moved`；未知 file → `bible-invalid`；
- `expectedVersion` 可选：在 `writeBibleRow` 的写事务里比对当前版本，不一致 → `bible-conflict`，不写；
- 调 `writeBible(root, workId, file, content, { expectedVersion })`，返回 `{name, path, version}`；
- `GET /bible` 返回顶层 `editable` 列表，面板据此渲染；
- 不注册 `story_*` 动作。

### 3. 面板

- 每份 truth item 增加「编辑」；点击把 `<pre>` 换成 `<textarea>`，保存/取消；
- 同一时间只开一个编辑器；有未保存内容时禁止切换/关闭，不提供丢弃草稿；保存/取消只作用于当前编辑器；
- 保存中禁用按钮；`sessionId` 缺失禁用保存；
- 缺失 characters 新建预填 `[]`；world 预填 `# 世界观`、style 预填 `# 文风基准`、intent 预填 `# 作者意图`（标题占位即可保存，作者再补正文）；
- 保存调用 face.writeBible，成功后 `loadBible()`，提示「已保存 v…」；
- 取消恢复原文；保存失败保留 textarea 内容和错误提示；
- `plan` 显示「全书计划走确认流程」，无编辑按钮；
- 缺失项显示「新建」（可编辑四件）或 plan 提示；
- 不产生 composer 消息；不触发 load() 全量刷新。

### 4. 并发/失败

- 单写者模型；`expectedVersion` 在写事务内比对，防陈旧覆盖；不做自动合并；style 抽取也写 style，可能覆盖未提交编辑，文档说明；
- `writeBible` 失败（统一 `bible-invalid`，含 characters/空 world/style/非 string content）不写库，原版本不变；world 的 TODO/待定也拒绝；intent 允许空。
- 64KB raw body 上限由路由拒绝 `body-too-large`；
- 返回沿用 `writeBible` 的 `{name, path, version}`，不改成 `file`。
- 内容版本是哈希，内容不变版本不变。

### 5. 边界

- 不做富文本预览、diff、撤销；
- 不直接改 `plan`；
- 不改 schema/导出；
- 模型仍可用 `story_bible_write`，但 plan 同样被拒。

## 与既有记录

- **补充 E3** #4：只读面板已交付，本项补编辑入口。
- **补充 A7** [bible-and-brief](../../implemented/pipeline/2026-10-17-storycraft-bible-and-brief.md)：写入沿用 `writeBible`。
- **呈现被 [面板重设计](../../proposed/pipeline/2026-10-22-storycraft-panel-redesign.md) 部分替代**：API/行为不变，就地编辑改为卡片+抽屉；未保存禁止切换仍保留。
- 更新 README/API/#4 E3。

## 备选方案

- **允许编辑 plan**：绕过作者确认闸门；否决。
- **弹窗编辑器/富文本**：范围过大；否决，先就地 textarea。
- **客户端只校验 JSON**：服务端才是唯一真相；否决。
- **自动合并冲突**：单写者，无必要；最后写入者胜。

## 后果

1. 编辑四件保存后内容/版本更新；plan 无入口；路由拒绝 plan。
2. characters 非法 JSON/缺字段返回 `bible-invalid` 且不写；world/style 空内容拒绝，world 拒绝 TODO/待定；intent 允许空；非 string content 拒绝。
3. 缺失可编辑项可新建；缺失 plan 只提示。
4. 取消不写；失败保留输入；无 composer 消息。
5. 路由当前作品校验、64KB；返回版本。
6. `bible-edit.test.mjs` 覆盖 guard/校验/版本冲突；64KB/当前作品由 E2E 覆盖。
7. E2E 覆盖保存/取消/失败/plan/缺失创建/无 composer；真实路由在临时 DSH 工作区注册后验证。
8. README §工作台/§接口 与 #4 E3 同步。

## 风险

- 覆盖式保存会丢未保存的他人编辑；单写者面板，文档说明最后写入者胜。
- 64KB 对超大人物档案可能不够；先按现有面板规模，超限有明确错误。
- 作者手改真值可能让旧摘要/上下文口径变化；这是作者意图，brief 下次装配生效。

## 验证

- `node storycraft/scripts/ci.mjs`：32 个单测文件 + 17 条 E2E 全过。
- `bible-edit.test`：四件可编辑、plan/未知拒绝、content 类型、六字段 characters、空 world/style、intent 空、版本冲突。
- E2E：保存 world 后重开可见；坏 characters 报错且输入保留；style 缺失新建；plan 缺失无新建；取消不写；64KB、`work-mismatch`、无 composer。
- 真实：临时克隆 `.storycraft` 后编辑 `雪线邮路` world、版本变化；plan 拒绝；作者库未动。
