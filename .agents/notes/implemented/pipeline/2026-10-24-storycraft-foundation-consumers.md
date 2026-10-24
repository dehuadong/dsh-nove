---
title: 故事工坊：L-R10a S4b foundation 消费
status: implemented
created: 2026-10-24
updated: 2026-10-24
verification: foundation 消费已接入 brief/context/检索/导出，CI 通过；证据见 #60。
---

# Agent Note：故事工坊：L-R10a S4b foundation 消费

## 问题

A0 已登记 foundation artifact：`bible:story_frame`、`bible:volume_map`、`bible:book_rules`、`roles:index`、`role:<slug>`，并有写入/读取 API（`writeFoundationDocument`/`writeRoleCard`）。R10b（#44）会由 architect 生产它们。

但**没有任何消费者**：brief 只有 intent/plan/characters/hooks/volumeSummary/recent/previous/style/wordPolicy/retrieval；context 的硬约束只有字数/人称/意图；检索不索引 foundation；导出不写 foundation；审稿与结算的约束段也看不到 story_frame/book_rules。产物写了没人用。

S4b 只接消费（brief/context/检索/审稿/结算/导出），不生产。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect-tool.ts`：storyFrame/volumeMap/bookRules/角色索引与卡由 architect 产出；`FoundationOutlineToolSchema` 是可读 Markdown。
- `inkos-master/packages/core/src/pipeline/runner.ts`：foundation 落 `story/outline/story_frame.md`、`story/outline/volume_map.md`，`story/style_guide.md`、`story/author_intent.md`；导出/备份按文件树复制。
- `inkos-master/packages/core/src/agents/settler-tool.ts` 与 `harness/builtin-profiles.ts`：结算与写作都以 foundation/state 为约束上下文（artifactKind 含 `foundation`）。
- 我们的裁决：**采纳**“foundation 是写作/审稿/结算的约束输入，且导出与备份可读”；**等价适配**为 brief/context 的结构化段与 `foundation/` 导出树；**不采纳**把 foundation 全文无条件塞进每次上下文——按保护级别与预算裁剪，避免 8 KB 静默溢出。

## 与既有记录

- 切片排序与 owner 由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 承接 S4b。
- foundation 字段与 ID 由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) §3 拥有；本 Note 只定消费位置、顺序与失败行为。
- 生产与 `current_focus` 归 #44（R10b）；本项只消费，不写 foundation 内容（索引除外）。
- 角色卡与 `characters` 六字段的关系：R10a 保留 `bible.characters` 只读；S4b 在 roles index 存在时优先用角色卡，缺失时回退六字段（不删旧路径）。
- 审稿/结算的既有约束归 `context.js`/`role-input.js` 与审稿技能；本 Note 只增加 foundation 段，不改审稿标准。

## 决定

### 1. brief（写前上下文）

- 新增四段：`storyFrame`（protected）、`bookRules`（protected）、`currentFocus`（compressible）、`volumeMap`（compressible）；`characters` 段在 roles index 有非空 `roles` 时改用索引的六字段（与 `bible.characters` 同形），否则回退 `bible.characters`；角色卡 `role:<slug>` 只在需要时按 slug 读取，不把卡全文塞进 brief。
- 新顺序：`intent, storyFrame, bookRules, plan, currentFocus, characters, hooks, volumeMap, volumeSummary, recentSummaries, previous, style, wordPolicy, retrieval`；段数从 9 变 13，测试与技能说明同步。
- 预算：trim 从尾部开始；`storyFrame`/`bookRules` 标记 protected，裁剪循环遇到 protected 段停止并如实报 `overBudget`，不静默删掉硬约束；其余新段按 compressible 参与裁剪。
- 缺席：artifact 不存在时该段 `absent: true`，不编内容；R10b 之前 brief 仍可用（fail-open）。

### 2. context（角色上下文）

| 角色 | 新增 |
| --- | --- |
| planner | `story_frame` 与 `current_focus` 进 `plan` 段（protected）；`volume_map` 独立为 `volumeMap` 段（compressible） |
| writer | `story_frame`/`book_rules` 进硬约束（protected，各截 1200 字上限）；`roles` 索引替代 characters 节选 |
| reviewer/reviser | `story_frame`/`book_rules` 进硬约束（protected，同上），用于对账设定与规则 |
| summarizer | 不变（只读本章与 state） |

- 段名与保护级别沿用 context 既有 `section` 机制；缺失时不报错、不阻断派发。
- context 的 1200 字上限是有意边界（单次派发的上下文预算）；brief 的 protected 段保留全文。

### 3. 检索

- `MEMORY_KINDS` 增加 `story_frame`/`volume_map`/`book_rules`/`role_index`/`role_card`/`current_focus`；`writeFoundationDocument`/`writeRoleCard` 写入时同步 FTS 文档（doc id 用 artifactId）。
- 候选 `text` 用内容原文（Markdown 或角色卡渲染）；per-kind 上限沿用现有规则，避免挤掉摘要/钩子。

### 4. 导出

- 新增 `foundation/story_frame.md`、`foundation/volume_map.md`、`foundation/book_rules.md`、`foundation/roles/index.json`、`foundation/roles/<slug>.md`、`foundation/current_focus.md`；缺失的 artifact 不生成文件。
- 现有 `bible/`、`outline/` 文件集合不变；导出顺序与字节稳定性沿用现有实现。

### 5. 边界

- 不生产 foundation/current_focus；不改变 #44 的生成流程与确认闸门。`current_focus` 的 kind/检索已接入，但它的写入与索引同步随 R10b 的生产者落地。
- 不改 `bible.characters` 的六字段合同；roles 缺失时回退。
- 不做旧作品迁移；面板展示 foundation 归 R10b/后续（本项只做导出与上下文消费）。
- 不改审稿标准与结算语义，只增加约束输入。

## 备选方案

- **foundation 全文无条件进 brief**：8 KB 预算会溢出，且生成质量未必受益；否决，按保护级别裁剪。
- **只导出、不进上下文**：等于“写了没人用”，与 #51 矩阵冲突；否决。
- **用 `bible:` 旧表承载**：A0 已登记 typed artifact，退回旧表会失去 revision；否决。
- **S4b 同时实现 R10b 生产**：#44 已有 owner 与确认闸门，合并会越界；否决。
- **roles 覆盖 characters 并删除旧路径**：R10b 未交付前会产生空人物段；否决，先并存回退。

## 后果

foundation 产物进入 brief/context/检索/审稿/导出消费路径。

## 验证

实际验证：foundation 消费者测试与 `ci --no-e2e` 通过；证据见 #60。

1. brief 输出 13 段且顺序如上；缺失 foundation 时对应段 `absent:true`，brief 仍成功。
2. `storyFrame`/`bookRules` 为 protected；预算不足时裁剪在 protected 段前停止并报 `overBudget`，不被静默删除。
3. context：planner 有 story_frame/volume_map，writer/reviewer/reviser 硬约束含 story_frame/book_rules；roles 存在时 characters 用角色卡，缺失回退六字段。
4. 检索：六类 foundation kind 可命中，doc id 为 artifactId；缺失时不报错。
5. 导出：`foundation/` 文件集合按内容生成，缺失不产生文件；现有导出文件集合与字节稳定性不回归。
6. 评测输入为真实写入的 foundation artifact（`writeFoundationDocument`/`writeRoleCard`），不是“只测 absent”。
7. `foundation-consumers.test.mjs` 覆盖四段、保护裁剪、roles 回退、检索、导出、缺失 fail-open；更新 `bible`/`context`/`retrieval`/`export-*`/`tools` 受影响断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
8. 不写 foundation 内容（索引除外）；不改 #44；不改 characters 合同；不迁移旧作品；不改审稿标准。

## 风险

- brief 从 9 段变 13 段，token 预算与测试断言都要改；旧会话若依赖段数会困惑，需要技能说明同步。
- protected 段让 overBudget 更常见；必须如实报告，不能悄悄截断硬约束。
- roles index 与 characters 双源并存期可能展示不一致；回退规则要写清（roles 存在即优先）。
- foundation 检索可能挤占摘要/钩子候选；靠 per-kind 上限与类目优先级兜底。
