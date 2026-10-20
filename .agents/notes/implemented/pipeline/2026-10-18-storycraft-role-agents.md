---
title: 故事工坊：角色分工与交接（单一预设版）
status: implemented
created: 2026-10-18
updated: 2026-10-20
verification: 6bb6a32 单一预设与守卫；#12 角色输入；#14 章纲闸门；presets/tools 断言与 6 条页面 spec 全过
---

# Agent Note：故事工坊：角色分工与交接（单一预设版）

## 问题

角色原本被做成四个 Agent 预设，于是模式选择器里出现五张卡；四个预设是手抄组合，与标准预设漂移，其中四个加载失败。主编还用六个私有委派动作直接调 subagent 服务，绕开官方工具面、深度策略与标准委派记录。

## 决定

### 一个模式，四种任务

故事工坊只声明一个预设 `storycraft`。角色不是模式，而是**派发时写进任务提示的分工**，方法与输出契约留在四份技能里：

| 角色 | 技能 | 输出 |
| --- | --- | --- |
| 写手 | `storycraft-write-craft` | 标题 + 整章正文（首尾标记） |
| 审稿 | `storycraft-review` | 问题清单 JSON |
| 修订 | `storycraft-revise-craft` | 修订后的整章正文 |
| 规划 | `storycraft-plan-craft` | 章纲五项或全书计划三段 |

### 派发与强制

- 主编用官方 `subagent`（spawn，`maxDepth: 1`）派发，子代理继承父方组合，不选 `agentPreset`；
- 子代理**不落盘**由运行时强制：预设作用域 `ctx.tools.guard` 对 `delegationDepth > 0` 拒绝 `write`、`edit`、`pwsh`、`bash`；故事工坊写动作在公共入口断言 `delegationDepth === 0`，返回 `subagent-cannot-land`；
- 子代理的输入由只读动作 `story_context` 交付：分段、保护级别、轨迹与白名单摘要（见 #12 的设计）；
- 收回文本后由主编校验并落盘：写/改动作做一致性检查（未登记人名、地名与尺寸只 warning，不阻断）；
- 派发失败重派一次；再失败报告 blocker，不自动代写整章；只有作者明确要求时才手动完成。
- 2026-10-20 后续：写手/审稿/修订默认改由宿主动作 `story_delegate` 启动官方 `subagents` 子代理，输入由宿主装配、预检也在宿主侧；手动 `subagent` + `story_context` 保留为兜底。部分替代见 `proposed/pipeline/2026-10-20-storycraft-host-delegation.md`。

### 角色不持有动作

私有委派动作与角色预设都已删除；角色只通过任务提示与技能获得方法，工具面与主会话一致，写入口被守卫拒绝。

## 备选方案

- **每角色一个预设**：卡片随角色增长、与标准基线漂移；否决（见被取代的 `2026-10-18-storycraft-role-presets`）。
- **一个只读的子代理预设**：仍需第二个可切换模式；否决。
- **保留私有派发动作**：绕开官方工具面与深度策略；否决。
- **让主编自己拼角色上下文**：无轨迹、无保护级别；否决（改用 `story_context`）。

## 后果

- 子代理的工具目录仍显示写工具，只是执行被拒；可能多一次失败调用；
- 角色不能再作为会话模式切换，只能由主编按任务指定；
- 主会话与子代理共用一段人设，主编身份由技能补足；
- 模型选择保持关闭，子代理沿用父方模型。

## 验证

- 预设名册只有 `storycraft`，四个角色预设已删除（`6bb6a32`）；
- 守卫与动作断言：`tools.test` 以 `delegationDepth: 1` 检查写工具被拒、读动作保留、`story_write` 返回 `subagent-cannot-land`；
- 角色输入：`story_context` 四角色实跑各返回契约内的段（#12）；
- 章纲闸门：未确认时写手上下文与落盘都被拒（#14）；
- 页面 spec 覆盖名册、读数与章纲确认。
