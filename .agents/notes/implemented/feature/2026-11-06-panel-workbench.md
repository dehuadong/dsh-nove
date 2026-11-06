# Agent Note: 故事工坊：panel.workbench 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `panel.workbench`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定与证据。

## Problem

工作台挂在全局侧边栏，不随会话/预设变化；同一面板还混排长篇、短篇、剧本。会话绑定改为不可改绑后，点击另一部作品没有“打开/新建目标会话”的出口。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/studio/src/pages/` | 作品工作台围绕当前作品展示阶段、章节与确认 | 复用现有工作台内容，但挂到会话级 `[长篇面板]` |
| `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话绑定 profile 与 work | 点击另一作品打开/新建目标会话，不改当前会话绑定 |

## Decision

- 移除侧边栏/右侧 tab 注册；
- 注册 `conversation.view`：id `longform`、label `长篇面板`、order 2；
- 面板内容复用 `StorycraftPage`，只列当前工作区作品；
- 点击当前作品：只选中；
- 未绑定会话：写绑定；
- 已绑定另一作品：`/current/session-for-work` 找已有会话并 `uiWorkspace.openSession`；没有则 `remote.session.create` 新建同预设会话、绑定后打开；
- 新增宿主路由 `/api/see-storycraft/current/session-for-work`。

## Alternatives considered

- **保留侧边栏面板，增加一个会话视图入口。** 最强理由是兼容旧入口；但用户明确要求面板会话级、非全局，双入口会让“当前作品”有两个上下文，故不采用。
- **点击另一作品直接改绑。** 已被 `runtime.session-binding` 拒绝，会串作品。
- **总是新建会话。** 最简单，但同一作品会重复会话；先查已有绑定再新建。

## Consequences

- **收益**：面板与会话/预设/工作区绑定；跨作品不再串上下文；旧侧边栏入口移除。
- **已知上限**：面板内容仍复用现有工作台，未拆成短篇/剧本各自面板；短篇/剧本后续独立预设与视图。
- **触发重访**：短篇/剧本面板接入时，需要独立的 `conversation.view` 与 label，不能复用 `longform` id。

## Verification

```text
node storycraft/e2e/run.mjs --grep "加载契约"   # 1 passed
node storycraft/tests/workbench.test.mjs        # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e         # PASS: 99 unit files
npm run verify                                  # 39 capabilities: 6 verified, 33 missing
```

浏览器回执：`artifacts/real-runs/panel.workbench.json`，会话 `session-99f987a0-f58b-4d1b-aa40-f01387d89ca7` 中 `[长篇面板]` 与会话视图同时可见。
