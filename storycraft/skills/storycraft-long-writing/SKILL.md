---
name: storycraft-long-writing
description: 长篇共享方法索引：基础设计、读者承诺与推进、场景/对话/篇幅预算、状态投影四份判断依据；按当前任务读对应文件，不产出提交内容。只出方法与提交内容，不直接改文件。 触发：写全书计划、章纲、长篇章正文或审长篇，需要判断卷末变化、开篇承诺、推进节奏、场景预算与伏笔账本时。
---
# 长篇共享方法

这份技能只提供判断依据。它不产出 JSON、不调用动作、不改阶段，也不替代规划、写作、审稿、修订技能里的输出契约。

## 四份参考

| 文件 | 回答什么 | 什么时候读 |
| --- | --- | --- |
| `references/foundation-design.md` | 叙事引擎、世界硬规则、卷末不可逆变化、人物弧代价、初始伏笔 | 出全书计划、划卷、种初始伏笔时 |
| `references/chapter-plan.md` | 单章章纲七字段与规则；示例见 `references/chapter-plan-examples.md` | 写章纲、判断一章是否成立时 |
| `references/reader-contract-and-progression.md` | 开篇承诺、多轴推进、余波、章纲自检、因果归属、线占比 | 写章纲、写长篇章、审长篇时 |
| `references/scene-dialogue-and-length-budget.md` | 场景预算、对话压力、字数分配、跑偏了怎么修 | 目标字数紧、写完偏长偏短、场景或对话失衡时 |
| `references/state-projection.md` | 事实投影、伏笔生命周期、投影边界、数值与在场 | 审事实与伏笔账本、定稿写状态时 |

## 怎么用

- 先读完当前角色技能，再按上表读**一份**最相关的参考；不要一次读完四份。
- 参考给的是判断标准，不是模板：具体措辞、章纲五项、审稿条目仍按角色技能与动作契约写。
- 与本实现冲突时以代码契约为准；伏笔与事实的边界见 `references/state-projection.md`。
- 短篇、剧本各读自己的共享方法，不读这份技能。

## 不要做

- 不要在这里补动作、字段或状态；本实现没有的字段不要编。
- 不要把参考实现的对象或字段当成真值或状态动作的字段。

## 按节点加载

| 节点 | 只读这一份 |
| --- | --- |
| 基础设定、全书计划、划卷、初始伏笔 | `references/foundation-design.md` |
| 章纲 | `references/chapter-plan.md` |
| 正文 | `references/reader-contract-and-progression.md` + `references/scene-dialogue-and-length-budget.md` |
| 审稿、修订 | `references/reader-contract-and-progression.md` |
| 结算 | `references/state-projection.md` |
