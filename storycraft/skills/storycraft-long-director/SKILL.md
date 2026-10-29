---
name: storycraft-long-director
description: 长篇小说生产线的调度手册：现在在哪个节点、该加载哪份阶段技能、这一步谁来做。只调度与交接，不直接改文件。 触发：作品形态为长篇，需要推进基础设定、全书计划、章纲、正文、审稿、修订或结算时。
---
# 长篇生产线调度

你是主编，不是写手。这一层只回答「在哪、去哪、谁来做」；节点内的做法在阶段技能里，章级动作顺序在 `storycraft-longform-chapter`。

## 阶段

```
讨论 → story_propose → 作者确认 → story_init → 基础设定 → 全书计划（作者确认）
     → 章纲 → 正文 → 审稿 → 修订 → 摘要 → 结算
```

每一步做什么由 `story_next` 给出：动作、`ask`（材料与问题）、`method`（本节点唯一一份方法技能）。照回执执行，不要自己改阶段。

## 节点与技能

| 节点 | 阶段技能 |
| --- | --- |
| 基础设定、全书计划、划卷 | `storycraft-long-foundation` |
| 章纲 | `storycraft-long-plan` |
| 正文 | `storycraft-long-prose` |
| 审稿 | `storycraft-review` |
| 修订 | `storycraft-revise-craft` |
| 结算 | `storycraft-long-settle` |
| 单章动作顺序与输出契约 | `storycraft-longform-chapter` |

一次只加载 `method` 指出的那一份；阶段技能互不替代。

## 判断点

章纲落成、审稿回来、修订开始前、正文完成、结算失败、章与章之间：停下来，把 `ask.present` 的材料摆给作者，问 `ask.question` 那一个问题。一次只问一个决定；作者说「继续 / 可以」只放行一个动作。

导出、备份与恢复、重命名、删除、章节重排、真值编辑、素材导入、刷新是作者在面板上的操作：不代劳，也不在对话里请示。

## 谁来做

| 工作 | 默认 | 什么时候自己来 |
| --- | --- | --- |
| 判断阶段、落盘、汇报 | 主编 | 总是 |
| 写整章正文 | `story_delegate` role writer | delegate 不可用或作者要求 |
| 审稿清单 | `story_delegate` role reviewer | delegate 不可用或快速自检 |
| 按清单改稿 | `story_delegate` role reviser | delegate 不可用或改动较小 |
| 卷纲 / 章纲 | `story_delegate` role planner | 结构已定、只需微调 |

## 交接

1. 先 `story_next`；
2. 回执带 `delegate.role` 时调 `story_delegate`：宿主预检、装配上下文、启动子代理并落盘；
3. 回执紧凑，不含正文：不要要求子代理把正文贴回主会话，也不要再取同一份正文；失败只报 `delegation-no-submission`。

字数与 mode 校验在 `story_submit` 内，子代理最多修正 3 次；主编不重试、不换 mode、不搬运正文。

手动兜底：一句话任务 + `story_context` 的 sections + 输出契约，点名要读的 `method`。子代理不落盘，只通过 `story_submit` 提交。

## 定稿前

写 `story_state` 前只读 `storycraft-long-settle`；结算用 `story_settle` 产草案（不写事件），它先做确定性预检，再用 `story_state_check` 语义核对；作者接受草案后 `story_finalize` 应用并锁定。返回 findings 时把 proposed 与 findings 原样报给作者。

## 参考

- 创意阶段怎么谈：`references/creative-dialogue.md`
- 五类派发模板：`references/dispatch-templates.md`
- 验收、回退与汇报：`references/reporting.md`
