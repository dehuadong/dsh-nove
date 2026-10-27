---
title: 故事工坊：闸门、面板与架构师委派的修复提案
status: proposed
created: 2026-10-27
updated: 2026-10-27
---

# Agent Note：故事工坊：闸门、面板与架构师委派的修复提案

本文以两份已接受的提案为基础，记录它们在实现和真实链路里暴露的问题、没有实现的部分、以及**从未提出过的验证**，并给出修改方案。

- 基础一：[2026-10-27-storycraft-action-gates.md](2026-10-27-storycraft-action-gates.md)（动作分类、交互闸门、载体分工）
- 基础二：[2026-10-27-storycraft-byte-binding-and-engines.md](2026-10-27-storycraft-byte-binding-and-engines.md)（字节绑定、确定性引擎、注入精度）

## 问题

1. **架构师首轮产出与提案无关**：作品《回归一章》的提案是“修表匠发现所有钟表慢三分钟”，第一次 `story_delegate(architect)` 落盘的 `bible:story_frame` 却是“结构工程师沈砚 / 陵川 / 化工厂泄漏”，与提案无一处对得上；主模型在读取后才发现，重派 architect 覆盖为“老周 / 修表店”。宿主没有任何拦截。
2. **无法复盘**：`delegateArchitect` 不写 `trace:1:architect`，库里 trace 为空，无法判断子代理当时拿到了什么，只能推测“继承了会话历史”或“自由发挥”。
3. **面板能推进协议步骤**：面板提供「生成基础设定」按钮（`client.ts` 的 `case 'architect'` 发送 `story_architect` 指令），等于给作者开了一条绕过 `story_next` 的旁路；「抽取文风」同属生成动作。
4. **技能改名后引用悬空**：形态级技能拆成阶段技能后，`architect`、`longform-chapter`、`review`、`revise-craft`、`short-story`、`short-drama`、`state-check`、`state-settler`、`dispatch-templates` 共 9 处仍指向已删除的 `storycraft-long-writing` / `short-writing` / `script-writing`。子代理读到不存在的路径，接着被检索守卫拒绝，再尝试 shell——三连报错全部由此产生。
5. **`ask` 缺基础设定确认点**：`askFor` 只覆盖章纲、审稿、修订、正文验收、章间；基础设定确认只能靠模型自由发挥材料。
6. **批准只有面板入口**：基础一写了“面板与会话写同一事件”，实现只开了面板；对拍工程是“作者在对话确认、写入器服务落盘”。

## 对拍参考

参考仓库 `E:\workspace\dsh-webnovel-writer`（不是 `inkos-master`）：

- `packages/bundle/src/persona.ts`：persona 只做身份前缀，重逻辑进技能；
- `packages/bundle/src/worker-policy.ts`：固定执行规约独立注入；
- `packages/bundle/src/approval-snapshot.ts`：批准绑定实际字节；
- `packages/core/src/gate/preExecute.ts`：不可判定即拒绝；
- `skills/novel-director/SKILL.md`：调度只回答“在哪、去哪、谁来做”，确认由对话与写入器服务完成。

## 没有实现（原提案有，代码没有）

| 原提案条款 | 现状 |
| --- | --- |
| 批准双入口（面板 / 会话），记录来源 | 只有面板；来源未记录 |
| `checks.ts` 注册式检查库 | 合并进 `critique.findingsOf`，未回写 Note（属设计变更，需补记） |
| 审稿绑定章纲与事实 | 只绑章纲 revision；事实按章作用域未实现 |
| `next` 覆盖所有失败 | 仅关键拒绝带 `next` |
| 面板操作与判断点分离 | 生成类按钮仍在面板流程条 |
| 技能改名后的引用一致性 | 无校验，直到真实链路报错才暴露 |

## 验证缺口（从未提出过）

1. **没有验证“子代理只依据本任务”**：没有任何用例断言委派子代理拿到的上下文里不含其它会话内容；也没有 trace 证明。
2. **没有验证“基础设定与提案一致”**：写 `bible:story_frame` 前没有与提案关键词比对，测试也没有覆盖“提案是 A、生成是 B”。
3. **没有验证“面板不能推进协议步骤”**：E2E 只测了确认按钮与动作按钮存在，没有断言不存在生成类按钮。
4. **没有验证“技能引用不悬空”**：`validate-skills.mjs` 只查 front matter、参考文件与 catalog，不查正文里提到的技能名是否存在。
5. **真实链路只跑过一遍且无断言**：没有把“一次委派 + 一次面板确认”的轨迹固化成可重放检查。

## 提案

### 1. 面板只保留批准与作者操作

- 删除 `client.ts` 的 `architect` 推进动作与按钮、「抽取文风」流程按钮；
- 面板只显示状态文案（“基础设定已生成，待确认”），不写“第一步做什么”；
- 保留「确认基础设定」，并加 E2E：面板无「生成基础设定」，确认按钮仍可用。

### 2. 架构师可复盘、可拦截

- `delegateArchitect` 写 `trace:1:architect`（与 planner/writer 一致）；
- 落盘 `bible:story_frame` 前做**前提校验**：提案 `premise` 与主要人物名至少命中一处，否则 `foundation-mismatch` + `next`，不落盘；
- architect 提示注入提案原文，并写明“只依据本任务的提案与已确认材料，不得延续其它会话或其它作品的内容”。

### 3. 技能引用成为可校验项

- `validate-skills.mjs` 增加：正文里出现的 `storycraft-*` 名称必须在技能目录中存在，否则失败；
- 以本次修复的 9 处为基线。

### 4. `ask` 覆盖基础设定

- `askFor` 增加 `foundation-approval`：材料为四阶段摘要（frame/rules/roles/cards 各一句），问题“确认基础设定吗？还是要改哪一阶段？”。

### 5. 批准双入口

- 新增主控动作 `story_approve`（`kind: foundation | outline | plan`），仅在作者明确表态后调用；
- 宿主记录 `approvedAt` + `source: conversation | panel` + 内容指纹；面板按钮写同一事件；
- 认可代价：无法从技术上证明作者确实说了，记录作者原话片段留审计。

## 验收条件

- 面板：E2E 断言无生成类按钮；确认按钮仍写入批准事件；
- 架构师：单元断言 trace 存在、前提不符被 `foundation-mismatch` 拒绝、提示含提案原文；
- 技能：`validate-skills` 对悬空技能名失败，当前 18 个技能零命中；
- `ask`：基础设定节点的回执带四阶段摘要与问题；
- 批准：面板与会话两种来源都能让 `story_next` 放行，且改内容后失效；
- 真实链路：一次架构师委派 + 一次面板确认，trace 与前提校验可核。

## 风险

- 前提校验过严会误拒合理改写（允许“人物名命中”之一即通过，并把命中情况写进回执）；
- 双入口批准削弱“防代签”，需要记录来源与原文片段；
- 面板删按钮会影响现有 E2E 选择器，需同步更新 spec。

## 备选方案

- **只做代码校验、不删面板按钮**：改动小，但旁路仍在，作者仍可绕过阶段机。否决。
- **只在技能里补“不要扫目录”的提示**：本次已证伪——模型仍会尝试 glob/grep 与 shell，必须由校验器与守卫兜底。否决。

## 未决

- 前提校验的命中规则（关键词集合、分词方式）需要在实现时用真实提案样本定；
- 是否允许“提案关键词全不命中但作者认可”的例外入口，需要作者裁决。
