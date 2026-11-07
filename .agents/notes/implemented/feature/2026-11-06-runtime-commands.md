# Agent Note: 故事工坊：runtime.commands 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.commands`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

需要一条不经过模型的入口，把当前工作区初始化成长篇项目；`story_init` 是模型动作，不能替代命令入口。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/cli/src/commands/init.ts:1-45` | `inkos init [name]` 初始化项目目录，缺省当前目录 | 复刻 `/story-init [name]`：初始化当前或命名子目录，固定 `longform` |
| `inkos-master/packages/cli/src/commands/export.ts` | `export` 是另一条 CLI 入口 | 本项只做 `init`；`export` 留给 `export.work` |
| `see-dsh-novel` 的 `client/index.ts:62-73` | 面板通过 `session.command` 执行作者命令 | 复刻采用面板入口；命令执行走 host 的 `commands.execute` |

## Decision

- 命令本身注册为 preset 插件 `see-storycraft/commands`，名字 `/story-init`；
- 客户端不依赖 composer 的命令发现；面板「初始化工作区」调用宿主路由：
  ```
  POST /api/see-storycraft/command { sessionId, line }
  ```
- 路由用 `agents.get(sessionId)` 取当前 Agent，再调用 `commands.execute(agent, line, [], signal)`；
- 命令 handler 复用 `initializeWorkspace`：`ensureWorkspaceForm(root, 'longform', 'storycraft')`，返回工作区路径；
- 临时 `__command-probe` 路由只用于确认 `commands.list(agent)`，验收后删除，不进发布包。

## Alternatives considered

- **继续依赖 composer 斜杠命令发现。** 实测 `/compact` 可见、`/story-init` 不可见；命令注册成功但客户端未列出，故不采用。
- **只保留 `story_init` 工具。** 工具是模型动作，不是 CLI/命令入口，能力语义不成立。
- **面板直接调用 `session.command`。** 与 see-dsh-novel 一致，但本实例返回 undefined；改用同一 `commands.execute` 的 host 路由，行为等价且可观测。

## Consequences

- **收益**：`/story-init` 在真实会话执行，不经过模型；工作区形态固定；面板可触发。
- **代价**：命令入口多一条 host 路由；该路由只接受 `sessionId` + 完整 command line，不扩大为通用命令代理。
- **边界**：只做 `init`；`export` 命令未做；短篇/剧本命令未做。

## Verification

```text
node storycraft/e2e/run.mjs --grep "panel story-init"  # 1 passed
node storycraft/tests/commands.test.mjs                # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e                # PASS: 100 unit files
npm run verify                                         # 39 capabilities: 8 verified, 31 missing
```

真实回执：`artifacts/real-runs/runtime.commands.json`。命令视图探针确认 `story-init` 在 `commands.list(agent)` 中。
