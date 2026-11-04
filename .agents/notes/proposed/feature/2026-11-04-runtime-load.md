# Agent Note: 故事工坊：runtime.load 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.load`（[账本行](../../../../capabilities.yaml)）。账本行只承载能力映射与状态，本 Note 承载本次范围、验收、证据与评审。

## Problem

`runtime.load` 仍是 `missing`：现有 `storycraft` 插件虽已安装，但没有一份当前基线的真实加载证据。没有这条证据，后续 `foundation.architect`、`cast.single-authority` 等能力无法证明自己运行在已加载的插件上。

本项要回答的是“DSH 能否真实加载本插件并暴露 `story_*` 工具与客户端入口”，不是重写插件，也不是补基础设定功能。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/runtime.ts` | 运行时负责注册工具、技能与角色入口，不要求调用方手写加载器 | 采纳“加载由运行时负责”；我们由 DSH bundle/preset 加载 `storycraft`，插件只导出入口与工具注册 |
| `inkos-master/packages/core/src/agents/base.ts:113-180` | 角色能力在运行时装配，不靠独立进程 | 等价适配：角色仍由 DSH `subagents` 承载，本项只验证插件加载层 |
| 本项目 `docs/dsh-mapping.md` 的“Provider／Agent 循环／工具／面板”行 | 机制映射已有裁决 | 本项不新增偏差；只验证既有映射可加载 |

## Proposal

### 范围

复用现有 `storycraft` 插件（入口 `storycraft/src/index.ts`），不新建 bundle、不改存储、不动 foundation。

验证四件事：

1. 干净 `DSH_HOME` 下安装 tarball 后能冷启动，无插件加载错误；
2. `story_next` 已注册，能返回合法回执；
3. 客户端页面/路由可打开；
4. 现有消费者测试 `storycraft/tests/tools.test.mjs` 通过。

### 非目标

- 不实现 foundation、角色权威或章节链；
- 不修改 `runtime.load` 的实现，除非加载本身失败；
- 不引入新的 Provider、Agent 循环、CLI、存储或调度；
- 不以 `--smoke` 单独代替真实会话证据。

### 真实证据

写 `artifacts/real-runs/runtime.load.json`：

```json
{
  "date": "YYYY-MM-DD",
  "sessionId": "session-...",
  "tests": { "passed": true },
  "receipts": [
    { "kind": "smoke", "install": "ok", "coldStart": "ok", "route": "ok" },
    { "kind": "tool-call", "tool": "story_next", "ok": true }
  ]
}
```

- `sessionId` 必须是真实 DSH 会话；`--smoke` 不打印会话 id 时，从 DSH session 状态读取，不伪造；
- 任一证据缺失，保持 `missing`，不运行 `check-capabilities --write` 强行置 `verified`。

### 验证命令

```text
node storycraft/scripts/ci.mjs --smoke
node storycraft/tests/tools.test.mjs
npm run check-capabilities -- --write
npm run verify
```

## Alternatives considered

**新建一个最小 bundle 再验证。** 最强理由是能证明“新基线”而不依赖旧插件；但当前决策是复用旧 `storycraft` 基线，新建 bundle 会把 P0 变成重建，超出本项，故不采用。

**只跑 `--smoke`，不取真实会话。** 最强理由是 smoke 已覆盖安装、冷启动与路由；但它不证明模型侧能调用 `story_next`，也无法提供 `sessionId`，不足以支撑 `verified`，故不采用。

**先跳过 `runtime.load`，直接做 foundation。** 最强理由是 foundation 已有实现与测试；但没有已加载插件的证据，后续能力的真实回执缺少根，故不采用。

## Acceptance criteria

1. 干净 `DSH_HOME` 安装 tarball 后冷启动成功，无插件加载错误；
2. `story_next` 在真实会话中返回非错误回执，并记录 session id；
3. 客户端页面/路由可打开（smoke 的路由检查通过）；
4. `storycraft/tests/tools.test.mjs` 通过；
5. `artifacts/real-runs/runtime.load.json` 满足证据格式，`npm run check-capabilities -- --write` 后 `runtime.load` 为 `verified`，`npm run verify` 通过。

## Plan Review

- Standards：账本承载能力与状态，本 Note 承载工作项范围与验收；不新建第二套状态表。
- Spec：范围、非目标、失败行为与证据判定明确；`sessionId` 缺失时不伪造。
- Architecture：复用现有插件入口，不改机制映射，不新增运行时组件。
- 结论：通过，进入实施需 implement 授权。

## Risks

- smoke 不输出 session id：从 DSH session 状态读取；读不到就保持 `missing`；
- 当前 profile 已安装旧插件，可能与 tarball 版本不一致：用临时 `DSH_HOME` 安装后再取证据；
- 客户端路由检查依赖现有页面，若页面本身未加载，本项失败而不是降级为“工具可用”；
- 真实会话证据只锁定加载与工具回执，不验证 foundation 产物。
