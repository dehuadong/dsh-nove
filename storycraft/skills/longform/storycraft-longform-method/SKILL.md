---
name: storycraft-longform-method
description: 迁移别名：长篇方法正文已并入 storycraft-long-writing；保留本技能只为旧会话与旧引用兜底。
whenToUse: 旧会话或旧提示词仍点名 storycraft-longform-method 时。
---

# 长篇方法（迁移别名）

方法正文已迁到 `storycraft-long-writing`，四份 references 也在那里。

- 旧会话、旧引用仍指向本技能时，加载 `storycraft-long-writing`，按它的索引读对应参考。
- 新提示词、新技能不要再引用本技能；L 阶段完成后按迁移表下线。
- 本技能不产出提交内容，不调用动作，不改阶段。
