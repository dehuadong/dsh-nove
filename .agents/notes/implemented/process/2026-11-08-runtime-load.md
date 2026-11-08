# Agent Note: 故事工坊：runtime.load 证据重验

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.load`。复审曾把它冻结为 `missing`；本记录只修复源证据、consumer 与真实回执，不改加载行为。

## Problem

复审确认旧的 `verified` 不成立：

- 源证据指向 `harness/runtime.ts`，它只定义 episode 生命周期，不是工具/技能注册；
- consumer 是 `tests/tools.test.mjs`，mock `ctx.tools`，没有启动插件或客户端；
- 真实回执来自旧 profile/旧会话，smoke 的临时 home 已删除，sessionId 无法复核；
- `cordis.patch.yml`、`tools/registry.ts`、`client.ts` 后来多次变更，回执没有重跑；
- 审计 row 的 `docs/dsh-mapping.md 运行时` 指向不存在条目。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/production-capabilities.ts:170-230`、`:464` | 工具/技能/角色能力在 production capabilities 注册 | 复刻注册在 `storycraft/src/tools/registry.ts`，bundle 由 `cordis.patch.yml` 挂载 |
| `inkos-master/packages/core/src/harness/runtime.ts:43-234` | episode 的 start/execute/finish 生命周期 | 只作生命周期参考，不当作注册证据 |
| `inkos-master/packages/core/src/harness/builtin-profiles.ts` | profile 决定能力集合 | 复刻由 preset/bundle 决定挂载 |
| `inkos-master/packages/studio/src/api/server.ts` 的路由注册 | 宿主把能力暴露为可调用路由 | 复刻由 `src/index.ts` 暴露 web 路由 |

## Decision

- reference 指向 `production-capabilities.ts`；
- implementation 指向 `storycraft/cordis.patch.yml`（bundle 挂载），注册落点是 `src/tools/registry.ts`；
- consumer 是 `storycraft/e2e/load.spec.cjs`，覆盖：
  - 页面加载无未捕获错误；
  - 长篇面板与故事工坊标题可见；
  - `/works` 返回作品；
  - `/next` 返回合法 `action`；
  - 打包后的 `lib/tools.js` 注册 `story_next`。
- 证据是 packed tarball smoke 与临时 `DSH_HOME` 的真实浏览器会话 `session-a390231f…`，session log 保留；
- 回执记录 `testedCommit=032356b`、consumer、commands；
- `docs/dsh-mapping.md` 有“运行时”条目；
- 旧回执保留在 `artifacts/real-runs/stale-2026-11-07/`，不参与当前证据。

## Alternatives considered

- **只重跑旧 smoke。** 最强理由是快；旧 smoke 删除临时 home 且没有 session 证据，无法复核，故不可用。
- **保留 `tools.test` 作为 consumer。** 最强理由是覆盖动作 schema；它没有启动插件，无法证明 load，故换成 e2e。
- **标为源不可观测。** 最强理由是 DSH 没有 InkOS 的 profile 枚举；注册点可观测，故不采用。

## Consequences

- **收益**：源证据、consumer、真实回执对齐；加载失败会在 e2e 暴露；smoke 证明 tarball 安装形态。
- **代价**：加载验证需要起浏览器实例和 tarball smoke，比单测慢；真实会话依赖临时 home，需要保留证据。
- **边界**：不改加载行为；`runtime.load` 的 bundle 挂载替代 runtime 注册器是机制等价，加载后的可观察行为等价。

## Testing

```text
node storycraft/e2e/run.mjs --grep "加载契约"  # 2 passed
node storycraft/scripts/ci.mjs --smoke         # PASS: 106 unit files + tarball smoke
npm run verify                                 # 2 verified / 38 missing
```

真实回执：`artifacts/real-runs/runtime.load.json`，testedCommit `032356b`，session `session-a390231f-bb63-4d69-867d-e9b8f9d5589a`。

[历史快照：故事工坊：runtime.load 工作项](../../archived/feature/2026-11-04-runtime-load.md)
