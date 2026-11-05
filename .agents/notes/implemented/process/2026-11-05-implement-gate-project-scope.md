# Agent Note: implement-gate 的项目作用域与命令初始化

Status: implemented

## Problem

本仓的 Host 插件 `@dsh-nove/implement-gate` 只应在已启用的项目里出现，实际有两个越界面：

1. **工具面全局**。`apply(ctx)` 直接 `ctx.tools.register(...)`，没有传 step-time `when`；Host 插件在根 context 注册即全局注册。证据：2026-11-05 的 `E:\see-dsh-novel\.artifacts\work-empty` 会话（工作区及上级都没有 marker）工具列表 35 个，其中含 `implement_gate`；4 工具的子代理会话也含它；同期只有 `E:\dsh-nove` 的会话出现过 `implement-gate` 拒绝，说明拦截本身是按项目生效的，泄漏的只是工具暴露。
2. **marker 会落进子目录**。策略根取会话工作区根（`sandboxPolicy.resolve({ session }).workspaceRoot`），会话开在 `E:\dsh-nove\storycraft` 这类子目录时，初始化会把 `.agents/implement-gate.json` 建在子目录；`sandboxPolicy` 解析失败时还有 `process.cwd()` 兜底，策略与状态可能落到 Host 进程目录。

两个问题互相锁死：初始化原本只有 `implement_gate({action:'init'})` 一个入口，而该动作只有在工具全局可见时才能调用。

对拍参考：无。工程门禁是本仓自有的工具链，参考工程 `inkos-master` 没有对应机制；检索范围 `tools/`、`docs/`、`.agents/notes/`。

## Decision

**策略与状态跟随 marker。** 从会话工作区向上找最近的 `.agents/implement-gate.json`：`ok` 与 `invalid` 让门禁生效（`invalid` 时除 `implement_gate status` 外的工具调用全部拒绝，fail-closed），`disabled` 让该子树显式关闭，找不到则 pass-through；最近的 marker 优先，所以子目录可以单独关闭。策略与状态都归属 marker 目录：状态写在 `<marker 目录>/.agents/state/implement-gate/<session-hash>.json`，子目录会话不再往子目录写 `.agents`。

**工具可见性跟随策略。** 注册时带 `when`，只有 `ok`/`invalid` 的工作区才把 `implement_gate` 放进该步骤的工具集；拦截仍只由 `tools/pre-execute` 执行，可见性不承担强制。

**初始化是作者命令。** `/implement-gate init` 通过 `ctx.inject(['commands'])` 在命令服务可用后注册，是人类命令，不进入模型工具面、不消耗模型步骤；门禁本身不依赖 `commands`，没有命令服务的 profile 仍然拦截。规则正文在 [插件 README](../../../tools/implement-gate/README.md)。工具上的 `init` 动作与 `codeExtensions`/`codePaths`/`proposed` 参数删除，`writeInit` 只服务命令。

**解析不到工作区就不猜。** `workspaceBoundary` 在 `sandboxPolicy` 缺失或解析失败时返回 `undefined`，门禁 pass-through、工具不可见；不再用 `process.cwd()` 兜底，避免按 Host 进程目录启用别人的门禁。

路径分类边界仍是会话工作区根：`codeExtensions`/`codePaths`/`outside`/`proposed` 都相对工作区判断；marker 在祖先时，写 marker 属于工作区外写入，由拦截拒绝。

## Alternatives considered

**A. 保留工具，只在 owner 消息「初始化 implement-gate」的那一步用 `when` 例外暴露。** 最强理由：不新增命令面，初始化流程与旧文档一致。否决：`when` 要读会话消息来决定激活，规则隐式且难以在工具面上解释；其它步骤仍可能通过 `status` 看到门禁概念，没有真正解决全局暴露。

**B. 工具保持全局，只改描述文案。** 最强理由：零改动、零风险。否决：不解决“没有配置文件的会话也看到 implement_gate”这一事实。

**C. 子目录会话视为独立项目，只认工作区根 marker。** 最强理由：与 DSH 的项目语义一致（每个目录都可能是一个项目）。否决：同一项目不同目录出现两套策略；初始化仍会往子目录写 marker。

**D. `/implement-gate init` 自动把 marker 写到最近的 `.git` 祖先。** 最强理由：子目录会话少一步“回项目根”。否决：插件会写会话沙箱之外的路径；monorepo 里想给子包单独启用门禁时不可行。

**E. 命令带 `codeExtensions`/`codePaths`/`proposed` 参数。** 最强理由：保留旧工具 init 的可选覆盖。否决：命令语法与解析成本换不到当前消费者；默认配置已覆盖常见项目，覆盖项可以直接改 JSON。

## Consequences

- 写作会话、子代理与无关项目的工具面不再出现 `implement_gate`；`E:\dsh-nove` 的会话行为不变。
- 子目录会话继承项目门禁，配置与状态集中在 marker 目录，便于审计。
- 代价：位于仓库子目录的会话不能初始化，必须回项目根；没有仓库锚点的独立目录可以初始化；命令不能带覆盖参数；每次策略解析要向上 stat 到文件系统根（目录数有限）。
- 解析不到工作区时门禁整体 pass-through，而旧实现会按 Host 进程目录启用；这是有意的取舍：宁可不管，也不按错误的根去管。
- 旧的工具 `init` 动作与相关参数消失；归档笔记 [implement-gate 初始化动作](../../archived/process/2026-11-02-implement-gate-init.md) 记录的初始化入口由本篇的命令入口取代。

## Testing

2026-11-05，`node tools/implement-gate/test.mjs` 85 项全部通过，覆盖：无 marker 隐藏工具、`enabled:false` 隐藏、`invalid` 保持可见、最近 `disabled` marker 覆盖祖先、子目录继承祖先策略且状态写在 marker 目录、子目录 init 被拒、祖先 `.git` 的嵌套工作区 init 被拒并给出根路径、项目根 init 成功并让工具出现、命令只接受 `init`、重复 init 被拒、解析不到工作区时工具隐藏且写放行、init 拒绝。

真实会话（Host 于 10:50 重启后，`request/header` 里 `implement_gate` 的描述已是新版本）：

- **命令可用**：10:52:39，`E:\see-dsh-novel` 会话 `session-0e45ead7-6647-4e0a-b42d-3cdd44d2fbdd` 提交 `/implement-gate init`，`command/done` 返回 `success`：「已启用 implement-gate：E:\see-dsh-novel\.agents\implement-gate.json（v2）」。
- **无 marker 不暴露工具**：`E:\novelist\N05` 会话 `session-80da1786-41cc-4cf3-9566-61fcd09a7581` 的 `request/header` 35 个工具，不含 `implement_gate`；同一会话在改动前的记录是 48 个工具且含该工具。
- **子目录继承祖先 marker**：`E:\see-dsh-novel\.artifacts\work-empty` 会话 `session-3ad39e43-534d-4ce9-8d33-0a1da0c7fbb5` 的工具面含 `implement_gate`，`status` 返回 `configPath=E:\see-dsh-novel\.agents\implement-gate.json`、`phase=discuss`；该子目录没有生成 `.agents`。
- **拦截仍在**：11:03:53，同一 gated 仓库里一条含 `git rm --cached .agents/implement-gate.json` 的命令被 protected 规则拒绝。
