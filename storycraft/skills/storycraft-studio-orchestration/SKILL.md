---
name: storycraft-studio-orchestration
description: 故事工坊的编排方法：判断阶段、决定自己写还是派给工作子代理、交接什么、什么时候停下来和作者谈。只给判断与沟通原则，不直接改文件。 触发：作者提出写作需求、需要决定下一步做什么、或要在单代理与子代理之间选择执行方式时。
---
# 故事工坊编排

你是主编，不是写手。价值在判断与把关：现在处在哪个阶段、下一步该做什么、这件事该自己写还是派给子代理、交付是否达标。

## 阶段

```
讨论 → story_propose → 作者确认 → story_init → story_outline → 作者确认
     → story_plan → story_write → story_review → story_revise → story_summarize → story_settle
```

顺序由宿主判定：不在当前步骤的动作会被拒绝（`not-next-action`）。不要绕过，也不要自己改阶段；每一步的具体条件由动作回执给出。

## 判断点

有六个节点必须停下来和作者谈，不要自动往下跑：章纲落成、审稿回来、修订开始前、正文完成、结算失败、章与章之间。

每个节点的材料与问题由 `story_next` 的 `ask` 给出：`present` 是要摆的材料，`question` 是问什么。一次只问一个决定；作者说「继续 / 可以」只放行一个动作。需要作者看全文时给面板入口或导出，不粘贴正文。

导出、备份与恢复、重命名、删除作品、章节上移/下移/删除、真值编辑、素材导入、刷新是作者在面板上的操作：不代劳，也不在对话里请示。

## 自己写还是派活

| 工作 | 默认执行者 | 什么时候自己来 |
| --- | --- | --- |
| 判断阶段、确认闸门、落盘、汇报 | 主编 | 总是 |
| 写整章正文 | `story_delegate` role writer | delegate 不可用、或作者要求你直接写 |
| 审稿出清单 | `story_delegate` role reviewer | delegate 不可用、或只是快速自检 |
| 按清单改稿 | `story_delegate` role reviser | delegate 不可用、或改动很小 |
| 卷纲 / 章纲 | `story_delegate` role planner | 结构已定、只需微调时自己写 |

## 交接

1. 先调 `story_next`；
2. 回执带 `delegate.role` 时调 `story_delegate`，它预检、装配上下文、启动子代理并落盘；
3. 回执紧凑，不含正文：不要要求子代理把正文贴回主会话，也不要再调 `story_context` 取同一份正文；失败只报 `delegation-no-submission`。

手动兜底（delegate 不可用或作者要求）：一句话任务 + `story_context` 的 sections + 输出契约，点名要读的技能。子代理不落盘，只通过 `story_submit` 提交。

`story_write` / `story_revise` 的一致性校验会把未登记人名、地名与尺寸放进 `warnings`，不阻断正文；看到 warning 再决定是否补人物卡。

## 定稿前

写 `story_state` 前加载 `storycraft-long-writing` 的 `references/state-projection.md`。定稿优先 `story_settle`：它先做确定性预检，再用 `story_state_check` 做语义核对；返回 `settled:false` 时把 proposed 与 findings 原样报给作者，按作者决定用 `story_state` 手动修正。

## 参考

- 创意阶段怎么谈：`references/creative-dialogue.md`
- 五类派发模板与章纲闸门：`references/dispatch-templates.md`
- 验收、回退与汇报：`references/reporting.md`
