# Agent Note: 故事工坊：runtime.commands 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.commands`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

需要一条不经过模型的入口，把当前工作区初始化为长篇项目。`story_init` 是模型动作，不能替代 CLI/命令入口。当前已有实现尝试过三种挂载方式，均未在真实会话生效：

- bundle 根注册；
- preset tools 作用域注册；
- 独立 `see-storycraft/commands` preset 插件注册。

真实证据：

- `/compact` 在同一 e2e 实例产生 `command/run` / `command/done`，命令 UI 正常；
- `/story-init` 不产生 `command/run`，被当普通消息发给模型；
- 面板按钮调用 `session.command('/story-init')` 返回 `undefined`；
- 独立命令插件 `apply` 日志已出现，注册调用未抛错。

因此问题不在命令 UI，也不在 handler；命令没有进入该 agent 的有效命令视图。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/cli/src/commands/init.ts:1-45` | `inkos init [name]` 初始化项目目录，缺省用当前目录，可选语言 | 复刻 `/story-init [name]`：初始化当前工作区或命名子目录，固定 `longform`，不经过模型 |
| `inkos-master/packages/cli/src/commands/export.ts` | `export` 是另一条 CLI 入口 | 本项只做 `init` 一条；`export` 留给 `export.work` 能力 |
| `see-dsh-novel` 的 `client/index.ts:69-73` | 面板通过 `ctx.sessions.binding(sessionId).session.command(line)` 执行确认命令 | 复刻采用同一路径：面板按钮调用 `session.command('/story-init')`，不依赖 composer 的斜杠命令发现 |
| DSH `docs/subsystems/commands.zh.md:131-195` | 命令注册表按 agent 解析；plain context 全局，command-injected child 作用域内 shadow；`execute` 未解析时返回 `undefined` | 复刻必须确认 `story-init` 在该 agent 的 `commands.list` 视图中；否则 `session.command` 必然返回 `undefined` |

## Proposal

### 第一步：临时命令视图探针

在 `storycraft/src/index.ts` 增加一个仅开发期使用的 host 路由（不进入发布包）：

```text
GET /api/see-storycraft/__command-probe?sessionId=...
→ { agents: [...], commands: [...] }
```

它调用 `ctx.commands.list(agent)`，返回当前 agent 的有效命令名。用途：

- 确认 `story-init` 是否在列表；
- 若在列表但 `session.command` 仍 `undefined`，问题在 client `SessionReference.command` 或 agent 身份；
- 若不在列表，问题在注册层/agent scope。

探针在验收后删除，不写进 `files`，不保留在最终代码。

### 第二步：按探针结果修正

- **不在列表**：把命令注册切到与 `command-compact` 相同的 base 层（plain global），并在 preset 中不重复注册；用 `commands.execute(agent, line)` 验证。
- **在列表但 `session.command` 返回 undefined**：检查 client 注入的 `sessions` 是否为同一 Host 实例；必要时改为面板直接调用 host 路由，由路由执行 `ctx.commands.execute(agent,line)`。
- **两者都失败**：本能力按“DSH 命令视图不可用”登记为阻塞偏差，不伪造 CLI；`runtime.commands` 保持 `missing`，转 `artifact.identity`。

### 第三步：保留的入口

- 面板按钮「初始化工作区」调用命令；
- `/story-init [name]` 不发送模型消息；
- 命令 handler 复用 `initializeWorkspace`：
  - 当前目录或命名子目录；
  - `ensureWorkspaceForm(root, 'longform', 'storycraft')`；
  - 返回 `已初始化长篇工作区：<path>`。

### 非目标

- 不实现 `export` 命令；
- 不实现短篇/剧本命令；
- 不把命令注册到 composer 的自动补全作为验收条件。

## Alternatives considered

**继续只改注册位置。** 最强理由是可能一次就中；但已试过 bundle 根、preset tools、独立 preset 插件三种位置，真实调用仍 `undefined`，继续试错没有新证据，故不采用。

**放弃命令，只用 `story_init` 工具。** 最强理由是工具已经可用；但源工程有 CLI init，工具不是 CLI/命令入口，能力语义不成立，故不采用。

**把命令做成 client 本地命令。** 最强理由是绕过 Host 命令注册表；但源工程命令要写会话日志与工作区，client 本地命令不能替代，故不采用。

## Acceptance criteria

1. 在真实 storycraft 会话里执行 `/story-init`，会话日志出现 `command/run` 与 `command/done`，且没有模型消息；
2. 当前工作区 `catalog.db` 的 `workspace.form = longform`；
3. 带 `name` 参数时初始化子目录，不带时初始化当前工作区；
4. 面板「初始化工作区」按钮得到同一结果；
5. 探针确认该 agent 的有效命令列表包含 `story-init`；
6. 消费者测试、100+ 单元文件、Playwright 回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先诊断后改，不再试注册位置；探针不进入发布包。
- Spec：命令生命周期、无模型消息、workspace form 与面板入口都可观察。
- Architecture：优先复用 DSH 命令注册表；失败时登记阻塞，不伪造 CLI。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 探针需要 host 路由能拿到准确 agent；拿不到时结论只能是“不可观测”；
- `ctx.commands.list` 与 `session.command` 可能使用不同的 agent 身份；
- 若最终判定阻塞，`runtime.commands` 将保持 `missing`，不能算完成。
