---
title: 故事工坊：章节阶段闸门与下一步查询的技术设计
status: proposed
created: 2026-10-17
updated: 2026-10-17
---

# Agent Note：故事工坊：章节阶段闸门与下一步查询的技术设计

## 问题

现在的保证只写在技能里：模型可以写完正文就交差，审稿与结算靠自觉。作品目录里也没有「这一章走到哪一步」的机器可读状态——`manifest.chapters[].status` 只记录写过/审过，不阻止跳级。要的是动作层面的拒绝：没审稿不能结算，没处理完条目不能结算。

产品行为与验收由工作项拥有，不在这里。

## 提案

### 阶段字段

`manifest.chapters[i].stage`，取值 `planned | written | reviewed | revised | settled`，缺省为 `planned`。旧作品加载时按现有 `status` 与产物推断一次并写回：有正文 → `written`，有审稿清单且条目全处理 → `revised`，有结算事件 → `settled`。

阶段的推进只发生在动作内部，且与产物写入同一个锁事务：

| 动作 | 写产物 | 阶段变化 |
| --- | --- | --- |
| `story_plan` | `outline/<章>.plan.md` | → `planned` |
| `story_write` | `chapters/<章>.md` 或新 revision | → `written` |
| `story_review` | `reviews/<章>.r<N>.md` | → `reviewed` |
| `story_revise` | `chapters/<章>.r<N>.md` | → `revised` |
| `story_state` | `state/events.jsonl`、`hooks.md` | → `settled` |

### 闸门

在动作入口检查当前阶段，不满足即抛 `StoryError`：

| 动作 | 允许的阶段 | 失败码 |
| --- | --- | --- |
| `story_plan` | 无章或 `planned`；`settled` 拒绝 | `chapter-settled` |
| `story_write` | `planned`、`written`、`reviewed`、`revised`；`settled` 要求先回退 | `chapter-settled` |
| `story_review` | `written`、`reviewed`、`revised` | `body-required` |
| `story_revise` | `reviewed`、`revised`，且存在未处理条目 | 现有 `review-required` |
| `story_state` | `revised`，且本轮条目全部处理 | `review-required` 或 `missing-problems` |

回退：`settled` 章再写正文，阶段设为 `written`，并在 `state/events.jsonl` 追加一条 `reopen` 事件（只追加，不删历史）。状态折叠时，某章只有最后一次 `settle` 之后的事件计入当前状态。

### `story_next`

只读：读 manifest、章纲、审稿清单、未处理条目，返回

```text
{ workId, chapter, stage, action, reason, missing[] }
```

判定顺序：无章纲 → `story_plan`（缺 outline）；有章纲无正文 → `story_write`；有正文无审稿 → `story_review`；有未处理条目 → `story_revise`（列 id）；条目全处理未结算 → `story_state`；已结算 → 建议下一章 `story_plan`。

### 与技能的关系

技能里的步骤说明保留，但改成「先调 `story_next`，按它说的做」；动作的拒绝原因本身要能指导下一步（错误消息里带动作名）。

## 备选方案

- **只在技能里写更强的话**：零成本，但模型仍可跳步；不解决「保证」，只解决「提示」。放弃。
- **新增一个 `story_settle` 动作代替 `story_state`**：会让状态结算与伏笔结算分叉，且现有调用点要改；不值得。
- **宿主内一次调用产整章（`ctx.llm.stream`）**：DSH 确实暴露了模型调用服务，技术上可行；但长任务超时、成本、中断恢复都要另做，且会让「谁写正文」从会话模型变成插件模型，与现有审批/计量分叉。记为 A1b，等 A1a 稳定后再评估。
- **用文件系统信号（锁文件/标记文件）表示阶段**：多一份要清理的状态；manifest 已有章节条目，放这里最省。放弃。

## 验收条件

- 阶段迁移：五步逐级前进，`story_status` 与工作台显示一致。
- 闸门：跳审稿结算 → `review-required`；条目未处理完结算 → 列出 id；结算后改章纲 → `chapter-settled`。
- 回退：结算后写正文 → 阶段 `written`，`reopen` 事件追加，状态折叠按最后一次 settle 之后的事件计算（未解伏笔数变化可观察）。
- 旧作品推断：没有 `stage` 字段的作品首次读取得到合理阶段，且不丢已有产物。
- `story_next`：五种阶段各返回正确动作与原因，缺章纲时给 `story_plan`。
- 回归：四套断言 + 三条页面 spec。

## 风险

- **旧作品推断错**：推断只用于首次读取，之后以 manifest 为准；推断规则写进测试。
- **回退语义复杂**：只追加事件、不删历史，折叠规则固定为「最后一次 settle 之后」；不引入第三种状态。
- **阶段与产物漂移**（手工改文件）：`story_status` 可以在读时用产物校正阶段，但只在缺失产物时降级，不猜测。
