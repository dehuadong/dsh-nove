# Agent Note: 故事工坊：runtime.load 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.load`（[账本行](../../../../capabilities.yaml)）。账本行只承载能力映射与状态，本 Note 记录本次决定、证据与后果。

## Problem

`runtime.load` 曾长期为 `missing`：现有 `storycraft` 插件虽已安装，但没有一份当前基线的真实加载证据。没有这条证据，后续 `foundation.architect`、`cast.single-authority` 等能力无法证明自己运行在已加载的插件上。

本项回答“DSH 能否真实加载本插件并暴露 `story_*` 工具与客户端入口”，不重写插件，也不补基础设定功能。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/runtime.ts` | 运行时负责注册工具、技能与角色入口，不要求调用方手写加载器 | 采纳“加载由运行时负责”；我们由 DSH bundle/preset 加载 `storycraft`，插件只导出入口与工具注册 |
| `inkos-master/packages/core/src/agents/base.ts:113-180` | 角色能力在运行时装配，不靠独立进程 | 等价适配：角色仍由 DSH `subagents` 承载，本项只验证插件加载层 |
| 本项目 `docs/dsh-mapping.md` 的“Provider／Agent 循环／工具／面板”行 | 机制映射已有裁决 | 本项不新增偏差；只验证既有映射可加载 |

## Decision

复用现有 `storycraft` 插件，不新建 bundle、不改存储、不动 foundation。能力行的落点：

- implementation：`storycraft/src/index.ts`；
- consumer：`storycraft/tests/tools.test.mjs`；
- realRun：`artifacts/real-runs/runtime.load.json`。

证据由两部分组成：

- **真实会话** `session-4604579f-a577-4ea1-88a1-51d867f3d7b6`（2026-11-03）：`story_current`、`story_init`、`story_next`、`story_delegate(architect, foundation)` 均返回成功回执，证明工具已注册且可调用；
- **安装形态** `session-30cf3a2d-9912-4655-ab8c-29a09331a390`（2026-11-04，`.tmp-smoke` 临时 DSH_HOME）：`node storycraft/scripts/ci.mjs --smoke` 完成 tarball 安装、冷启动、页面与作品路由检查；该 session 无模型调用，只作为加载与路由证据。

`npm run check-capabilities -- --write` 依据上述回执把 `runtime.load` 置为 `verified`；`npm run verify` 通过。

## Alternatives considered

- **新建一个最小 bundle 再验证。** 最强理由是能证明新基线而不依赖旧插件；但当前决策是复用旧 `storycraft` 基线，新建 bundle 会把 P0 变成重建，超出本项。
- **只跑 `--smoke`，不取真实会话。** 最强理由是 smoke 已覆盖安装、冷启动与路由；但它不证明模型侧能调用 `story_next`，也无法提供真实工具回执，不足以支撑 `verified`。
- **先跳过 `runtime.load`，直接做 foundation。** 最强理由是 foundation 已有实现与测试；但没有已加载插件的证据，后续能力的真实回执缺少根。

## Consequences

- **收益**：插件加载、工具注册与客户端路由有了一条可追溯的真实证据；后续能力的真实回执有了已加载基线。
- **代价与已知上限**：真实工具调用来自 2026-11-03 的会话，安装/路由来自 2026-11-04 的 smoke；两者不是同一次运行。插件加载层不因近期 hooks/telemetry 修改而改变，但若 bundle/preset 或入口变化，必须重跑并更新回执。
- **触发重访**：`storycraft/package.json` 入口、bundle/preset 组成、工具注册表变化时，重跑 smoke 与真实会话。

## Verification

```text
node storycraft/tests/tools.test.mjs        # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --smoke      # tarball 安装、挂载、页面与路由均通过
npm run check-capabilities -- --write       # runtime.load: missing -> verified
npm run verify                              # notes + capabilities 通过
```
