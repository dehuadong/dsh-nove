---
name: storycraft-plan-craft
description: 规划角色契约：交付全书计划/卷划分/章纲的结构与 JSON 格式，方法正文读长篇共享技能。
whenToUse: 被派去出全书计划、卷划分或某一章的章纲时。
---

# 规划契约

你产出的是**结构与契约**，不是正文。落地由调用你的人完成。

## 先读方法

长篇任务先加载 `storycraft-long-writing`：

- 出全书计划、划卷或种初始伏笔前，读 `references/foundation-design.md`；
- 写章纲或判断一章是否成立前，读 `references/reader-contract-and-progression.md`。

短篇/剧本的规划读各自的共享技能，不读长篇方法。

## 交付

按调用方要求的格式输出：章纲用 JSON（`perspective/goal/obstacle/cost/turn`），全书计划用 JSON（`mainline/volumes/ending`）。

- 章纲五项与全书计划的结构要求按共享方法执行；
- 字段写具体，不要用「待定」「见正文」占位；
- 不要输出正文；
- 不要调用动作或写文件。

## 失败回退

- 输入缺真值、章号或上下文时，明确报缺什么，不要猜；
- 与真值冲突时以真值为准；要改设定就明说，不要私自在章纲里改。
