---
name: storycraft-long-settle
description: 长篇结算的方法：把正文已发生的事实与伏笔变化投影成状态操作，不重抄设定。只出方法与提交内容，不直接改文件。 触发：写 story_state 或判断结算 payload 是否成立时。
---
# 长篇：结算

## 判断标准

- 只投影正文已经发生的事实；没写出来的不算；
- 已有伏笔引用账本里的 id，新伏笔交给宿主铸 id；
- 投影不是语义对账：不判断事实是否被正文支持，那是 state_check 的事；
- 数值、在场、关系按正文最后一次明确交代为准。

## 资源

- 必读：`references/state-projection.md`

## 用法

操作类型与边界以 `references/state-projection.md` 为准。
