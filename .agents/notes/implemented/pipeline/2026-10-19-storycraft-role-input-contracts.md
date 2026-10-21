---
title: 故事工坊：角色输入契约（单一模式版）
status: implemented
created: 2026-10-19
updated: 2026-10-21
verification: 实跑 story_context 四角色与第 7 章 story_write(rewrite)；14 套断言与 5 条页面 spec 全过；2026-10-20 未登记人名/地名/尺寸 warning 测试通过；2026-10-21 摘要角色 section 集合断言通过
---

# Agent Note：故事工坊：角色输入契约（单一模式版）

## 问题

单一预设之后，角色不再是预设，而是**任务提示里的分工**：主编用官方 `subagent` 派发，子代理继承同一套工具，靠运行时守卫禁止落盘。

于是「角色拿到什么」失去了承载点：私有派发动作被删除后，`context.js` 与 `consistency.js` 成了无人引用的模块；主编只能手拼 prompt，校验也没有落点。

## 决定

2026-10-21 交付：摘要角色不经过 `story_context`，由 `story_delegate` 内部装配 `authority`/`task`/`body`/`state`；不读章纲、人物卡、`recent` 与 `constraints`。其余四角色契约不变。

### 输入由只读动作交付

`story_context(work, chapter?, role, instruction?, mode?)`，只读，返回：

| 字段 | 内容 |
| --- | --- |
| `sections` | 每段 `{name, title, content, protection, source}` |
| `trace` | `budget`、`trimmed`、`dropped`、`missing`、每段字符数；审稿/修订再记 `review {round, revision}` |
| `whitelist` | `counts` 与 `sample`（各取前若干），不外发完整清单 |

角色与段：

| 角色 | 段 |
| --- | --- |
| 写手 | 权威顺序、本章任务（章纲 + 作者要求）、硬约束、人物与状态、最近脉络、文风 |
| 规划（章级） | 权威顺序、任务、硬约束、人物与状态、最近脉络、文风；任务由动作生成 |
| 规划（作品级） | 同上，另加全书计划与卷图、人物卡；不含单章字数 |
| 审稿 | 权威顺序、任务（未处理条目或「审正文」）、硬约束、本章章纲、正文、人物与状态、最近脉络、审稿标准 |
| 修订 | 权威顺序、任务（条目与模式）、硬约束、本章章纲、正文、人物与状态、最近脉络、修订标准 |

保护级别：权威顺序、任务、硬约束、章纲、正文、全书计划、标准为 `protected`；人物与状态、最近脉络、文风、人物卡为 `compressible`。预算默认 8000 字符，先压缩（头尾保留 + 标记）再整段裁掉，顺序 `recent → state → characters → style`。

### 校验在落盘处

子代理不能写，写发生在主编或宿主动作：`story_delegate` 是例外，由宿主侧动作落盘，主编辑只收紧凑回执；手动路径仍按本节。

- `story_write`：落盘前比对白名单。未知说话人 → `warnings`，仍落盘；地名、尺寸/数量也进 `warnings`；名字检查不阻断正文；
- `story_revise`：对新版本正文做同样检查；
- 白名单由 `facts.js` 只从**已落盘资料**派生：人物卡、意图、计划、卷图、章纲，以及既往章节正文与摘要里的说话人；本章正文与作者指令不参与；
- 误报防线：说话人需跟说话标点，剔除明显代词/虚词窗口；未登记人名只进 `warnings`，不阻断正文。角色词/对白片段由作者和审稿判断，不再用全局词表硬过滤；地名、尺寸仍按「数字 + 单位」归一后比对。

### 入口校验的属主

前置校验只在 `story_context`：缺章 → `chapter-not-found`，缺章纲 → `plan-not-found`，缺人物卡 → `bible-missing`，审稿/修订无正文 → `chapter-not-written`，非规划角色缺章号 → `chapter-required`，修订无条目 → `review-required`。`story_write`/`story_revise` 不重复前置校验。`story_delegate` 是例外：输入与预检都在宿主侧完成，仍复用同一组阶段错误码；手动派发仍沿用 `story_context` 契约。部分替代见 `proposed/pipeline/2026-10-20-storycraft-host-delegation.md`。

### 派发模板

编排技能为四个角色各写一段模板：调 `story_context` → 按段序拼 prompt → 派 `subagent` → 收回文本 → 校验 → 主编落盘；失败重派一次，再失败报告 blocker，不自动代写。

## 备选方案

- **恢复私有派发动作**：绕开官方工具面与深度策略；否决。
- **让主编自己拼上下文**：无轨迹、无保护级别、口径漂移；否决。
- **把校验放进子代理**：子代理不能写，校验没有意义；否决。
- **把白名单完整发给主编**：会被当成允许名单照抄；只给摘要。
- **逐段 `reason`**：角色段由契约固定，理由会是常量复制；改为 `source` + 保护级别 + 轨迹。

## 后果

- 主编每次派发多一次只读调用；换来可追溯与统一口径；
- 地名 `warnings` 仍有零星误报，不阻断落盘；
- `story_brief` 保留给主编自己预览，派发一律走 `story_context`；两套逻辑并存，合并留待后续工作项。

## 验证

- 实跑：`story_context` 对 writer（6 段）/ reviewer（7 段）/ reviser（7 段）/ planner（含计划与人物卡）各返回契约内的段，带 `trace.sections` 与白名单 `counts`；
- 入口：实跑 `chapter-not-found`；动作测试覆盖 `plan-not-found`、`bible-missing`、`chapter-not-written`、`chapter-required`、`review-required`；
- 落盘：第 7 章 `story_write(rewrite)` 实跑通过；离线覆盖未登记人名 warning、地名/尺寸告警、修订稿 warning；
- 回归：14 套断言与 5 条页面 spec 全过；2026-10-20 未登记人名/地名/尺寸 warning 测试通过。
