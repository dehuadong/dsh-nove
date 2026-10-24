---
title: 故事工坊：L-R10b foundation 生产
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L-R10b foundation 生产

## 问题

A0 定义了 `story_frame`/`volume_map`/`book_rules`/`roles:index`/`role:<slug>`/`current_focus` 的合同与读写 API，S4b 已把消费接到 brief/context/检索/审稿/结算/导出。但**没有生产者**：没有任何动作或委派角色会生成这些 artifact，作者只能手工写；`roles` 索引与角色卡也没有 UI/委派入口。#44 的目标是 architect 生成 foundation，现在需要把它落成可执行、可确认、可重跑的流程。

R10 旧方案（一次生成 world/characters/plan/text-hook）已被对拍审查否决，本 Note 不恢复旧格式。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect-tool.ts`：architect 分阶段产出 storyFrame、volumeMap、bookRules（md/json）、角色索引与角色卡；各产物有独立 schema，写文件后进入后续写作。
- `inkos-master/packages/core/src/pipeline/runner.ts`：foundation 落 `story/outline/story_frame.md`、`story/outline/volume_map.md`、`story/style_guide.md`、`story/author_intent.md` 等；确认/回退由编排层控制。
- `inkos-master/packages/core/src/agents/settler-tool.ts` 与 `harness/builtin-profiles.ts`：writer/reviewer/settler 读取 foundation 作为约束（S4b 已接）。
- 我们的裁决：**采纳** staged architect 与“先确认再写作”；**等价适配**为宿主侧 `story_delegate` 的 `architect` 角色 + 面板确认；**不采纳**旧 text-hook 初始化——初始伏笔归 planner/settler 的 v2 事件（S3）。

## 与既有记录

- 产物合同与 ID 由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) §3 拥有。
- 消费与段序由 [`2026-10-24-storycraft-foundation-consumers.md`](2026-10-24-storycraft-foundation-consumers.md) 拥有（S4b 已完成）。
- 切片排期由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本项是其中 R10b。
- 委派机制、提交协议与重试规则由 [`2026-10-20-storycraft-host-delegation.md`](2026-10-20-storycraft-host-delegation.md) 拥有；本项只增加 architect 角色与 foundation 落地。
- 旧 R10 设计已否决：[`rejected/pipeline/2026-10-23-storycraft-foundation-delegation.md`](../../rejected/pipeline/2026-10-23-storycraft-foundation-delegation.md)；不恢复 world/characters/plan/text-hook 方案。

## 提案

### 1. 生产入口：architect 角色，四个 stage

`story_delegate` 增加 `role: 'architect'` 与 `stage`（`frame|rules|roles|cards`），由宿主启动子代理并在 `story_submit` 校验后落地：

| stage | 产物 | 说明 |
| --- | --- | --- |
| `frame` | `bible:story_frame`、`bible:volume_map`、`bible:current_focus` | 故事前提/冲突/动机/约束/因果解决；卷图四字段；初始焦点 |
| `rules` | `bible:book_rules`（JSON + markdown） | 叙事人称、禁区、主角锁定、类型锁、允许偏差；校验沿用合同 |
| `roles` | `roles:index` | 六字段角色索引，≤20 人 |
| `cards` | `role:<slug>` | major 角色卡，≤12 张；slug 稳定、禁路径分隔符 |

- 每个 stage 独立提交、独立落地、独立可重跑；任一 stage 失败不写其他产物。
- 每个 stage 的 payload 在落地前做**全量预校验**（合同 + 引用/长度上限），失败返回可重试的结构错误；重跑生成新 revision 并清 foundation 确认。
- 四个 stage 全部完成后 `manifest.foundation` 记录 `writtenAt` 与 `stages`；未完成时缺失 stage 可单独补跑。

### 2. 下一步与确认

- `story_next`：无章节、无全书计划且 foundation 未完成时，返回 `action: story_architect`（下一步 stage）、reason 与 `missing:[foundation:<stage>]`；有 delegate 提示 `{role:'architect', stage}`。
- 四阶段完成但未确认：`blocked:['foundation-approval']`，提示作者在面板「基础设定」点确认；确认后 `story_next` 回到 `story_outline`。
- **确认只走面板**（与全书计划一致），不提供模型可调用的 approve 动作；工具传入 approve 返回 `approval-moved`。
- `story_outline` 始终可手动调用：architect 失败或作者想直接写计划时不硬阻断（#44 的“手动回退”）。已写过 outline 的作品不再提示 foundation。
- 任何 stage 重跑都会清 `foundation.approvedAt`；确认后再次生成需重新确认。

### 3. 面板

- 「基础设定」区：四类产物的可读预览、各 stage 状态（未开始/已生成）、「确认基础设定」按钮。
- 确认按钮只写 `foundation.approvedAt`，不触发委派、不自动发消息。
- 预览走只读接口；作者修改走重新生成或后续编辑能力，不在本项新增 foundation 编辑器。

### 4. 角色卡与 characters

- architect 只写 roles index/card；`bible.characters` 不删、不改写（S4a/S4b 的只读回退保留）。
- major 角色卡必须来自 roles index 中的 major 条目；卡数量 ≤ major 条目数。

### 5. 初始伏笔

- 本项**不生成** initial hooks：S3 的 v2 hook/fact 由 settler 与 planner 产生，旧 text-hook 初始化已否决。foundation 只产出计划/规则/角色。

### 6. 边界

- 不迁移旧作品；旧作品没有 foundation 时按“未生成”处理，不阻断 story_outline/写作。
- 不改审稿/结算标准；不新增短篇/剧本 foundation（S/D）。
- 不改 S4b 的消费段序与保护级别；只保证新产物被现有消费读取。
- 生成质量只做结构校验与作者确认，不在本项做模型评测。

## 备选方案

- **一次调用生成全部 foundation**：单次 payload 大、失败整体重来、难定位问题；否决，采用四 stage。
- **单独 `story_architect` 动作**：与 `story_delegate` 的提交/重试/回执机制重复；否决，扩展现有委派。
- **硬性阻断 story_outline 直到 foundation 确认**：architect 不可用或作者想手写计划时会死锁；否决，保留手动回退。
- **由模型自行确认 foundation**：作者闸门失效；否决，确认只在面板。
- **沿用旧 text-hook 初始化**：与 v2 hook/fact 模型冲突；否决。

## 验收条件

1. `story_delegate` 接受 `role:'architect'` + `stage`，四个 stage 分别落地合同产物；非法 payload 整批拒绝且不产生任何 revision。
2. 每个 stage 可独立重跑；重跑生成新 revision、清 `foundation.approvedAt`；旧 revision 可读。
3. `story_next` 依次给出四个 stage，全部完成后 `blocked:['foundation-approval']`，确认后回到 `story_outline`；已写 outline 的作品不再提示 foundation。
4. 确认只由面板触发；工具侧 approve 返回 `approval-moved`；确认不自动发消息。
5. 面板「基础设定」展示四类产物与 stage 状态，确认按钮只写时间戳。
6. 生成的 foundation 被 S4b 消费读到（brief 段、context 约束、检索、导出）；roles 索引与卡的关系符合合同（卡来自 major 条目、slug 稳定）。
7. `bible.characters` 未被删除或改写；无 foundation 的旧作品不阻塞。
8. 不写 hooks/facts、不迁移、不改短篇/剧本、不改审稿/结算标准。
9. 测试：`foundation-production.test.mjs` 覆盖四 stage、非法 payload 原子性、重跑清确认、nextStep 序列、面板确认（E2E 或 API 级）、S4b 消费联动；既有委派/提交/工具/面板测试更新；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
10. 技能：新增 architect 角色技能（薄契约）+ 复用 longform foundation-design 参考；委派提示加载正确技能，不改方法正文。

## 风险

- 落地需要一个 additive schema 变更：v7 给 `meta` 加 `foundation_approved_at`；v6 作品首次打开自动补列（v6→v7），不改其他表。
- 四 stage 增加往返；必须有“已完成 stage 不重复”与断点续跑，否则作者会重复付费。
- 子代理输出长度/质量波动；合同校验会拒绝，但需要错误可读、可重试。
- foundation 确认增加一个作者闸门，面板不明显会卡流程；`story_next` 必须写清 blocked。
- roles 卡与 characters 双源并存期可能不一致；architect 只写新源，旧源不动。
- 面板预览 foundation 需要新的只读接口；不要把大文本灌回主会话。
