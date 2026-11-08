# Agent Note: 故事工坊：runtime.load 证据重验

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.load` 重验。该能力已被复审冻结为 `missing`；本工作项只修复源证据、consumer 与真实回执，不改加载行为。

## Problem

复审确认 `runtime.load` 的 `verified` 不成立：

- 源证据指向 `harness/runtime.ts`，但该文件只定义 episode 生命周期，不是工具/技能注册；
- 声明 consumer 是 `tests/tools.test.mjs`，它 mock `ctx.tools`，没有启动插件或客户端；
- 真实回执来自旧 profile/旧会话；smoke 的 `.tmp-smoke` 已删除，sessionId 无法复核；
- `cordis.patch.yml`、`tools/registry.ts`、`client.ts` 在其后多次变更，回执没有跟着重跑；
- 审计 row 的 `docs/dsh-mapping.md 运行时` 指向不存在的条目。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/production-capabilities.ts:170-230`、`:464` | 工具/技能/角色能力在 production capabilities 注册 | 复刻注册落点是 `storycraft/src/tools/registry.ts`，不是 `src/index.ts` |
| `inkos-master/packages/core/src/harness/runtime.ts:43-234` | episode 的 start/execute/finish 生命周期 | 只作为运行时生命周期参考，不当作注册证据 |
| `inkos-master/packages/core/src/harness/builtin-profiles.ts` | profile 决定可用的能力集合 | 复刻由 preset/bundle 决定挂载 |
| `inkos-master/packages/studio/src/api/server.ts` 的路由注册 | 宿主把能力暴露为可调用路由 | 复刻由 `src/index.ts` 暴露 web 路由 |

## Proposal

### 范围

1. 能力 reference 改为 `production-capabilities.ts`；
2. implementation 指向 `storycraft/cordis.patch.yml`（bundle 挂载）与 `src/tools/registry.ts`（动作注册）中的实际路径，ledger 只填一个主路径；
3. consumer 改为 `storycraft/e2e/load.spec.cjs`，并补一条 `story_next` 路由断言：
   - 页面加载无未捕获错误；
   - 长篇面板可见；
   - `/api/see-storycraft/next` 对 fixture 返回一个合法 `action`，证明注册与路由都活着。
4. 证据重取：
   - 先跑 packed tarball smoke（`ci.mjs --smoke` 或等价安装路径）；
   - 再用临时 `DSH_HOME` 起真实免费会话，记录 sessionId 与可复核的 session log；
   - 回执写 `testedCommit`、consumer、commands；旧回执归档 `stale-2026-11-07`；
5. 审计 row 改为 `机制等价`，dsh-mapping 的“运行时”条目必须真实存在；否则先补条目再改 verdict。

### 非目标

- 不改插件/客户端加载行为；
- 不恢复旧 `verified`；
- 不把 tools.test 的 mock 当加载证据。

### 失败行为

- 页面未加载/路由 404/next 返回非法 action → 证据失败；
- smoke 未使用 tarball 而用源码链接 → 证据失败；
- 回执 sessionId 无 session log → 证据失败；
- 旧回执不得复用。

## Alternatives considered

**只重跑旧 smoke。** 最强理由是快；旧 smoke 删除临时 home 且没有 session 证据，无法复核，故不可用。
**保留 `tools.test` 作为 consumer。** 最强理由是它覆盖动作 schema；它没有启动插件，无法证明 load，故换成 e2e。
**把 runtime.load 标为源不可观测。** 最强理由是 DSH 没有 InkOS 的 profile 枚举；注册点是可观测的，故不采用。

## Acceptance criteria

1. reference 指向注册文件，不再指向 `runtime.ts`；
2. consumer 是真正启动 bundle 的 e2e，覆盖页面加载与 `story_next` 路由；
3. packed tarball smoke 通过；
4. 真实会话回执含 date/sessionId/testedCommit/非空 receipts，session log 可复核；
5. 旧回执保留为历史，不参与当前证据；
6. `check-capabilities --write` 后才置 `verified`。

## Plan Review

- Standards：源证据与 consumer 归位；不把 mock/旧回执当证据。
- Spec：加载、注册、路由、真实会话四个可观察点。
- Architecture：bundle 挂载 + registry 注册 + web 路由分层；不混入新行为。
- 结论：通过，进入实施需 implement 授权。

## Risks

- e2e `/next` 需要 fixture 有 work，现有 fixture 可提供；
- 真实会话需要临时 DSH_HOME 与模型调用，不能复用旧 session；
- smoke 与真实会话可能耗时，但这是当前证据合同的必要条件。
