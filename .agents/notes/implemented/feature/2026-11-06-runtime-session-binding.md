# Agent Note: 故事工坊：runtime.session-binding 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.session-binding`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与后果。

## Problem

旧实现允许 `session_current` 在同一会话内改指另一部作品；面板点击作品 B 会把 A 会话的后续动作切到 B，而对话历史、章纲与审阅记录仍属于 A，造成串作品。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话由 `sessionKind`/`bookId` 绑定 profile 与 workId | 等价适配：DSH 会话没有 sessionKind 枚举；复刻按 sessionId 绑定一部 workId，预设决定 form |
| `inkos-master/packages/core/src/harness/session-binding.ts:3-15` | profile 由会话类型决定 | 机制偏差已登记在 `docs/dsh-mapping.md`：复刻由 preset 决定 profile |

## Decision

- `current.ts` 的 `setCurrent` 变成一次性绑定：已有不同 workId 时抛 `work-binding-mismatch`；
- `storage/repositories/works.ts` 的 `setSessionCurrent` 只允许首次插入；已有不同 work 时同样拒绝；
- 显式 `work` 仍可覆盖当前作品用于读取，但不改绑定；省略 `work` 时使用绑定；
- 删除作品清 `session_current`；重启后首次读取从 `session_current` hydrate；
- 面板点击另一作品时打开/新建目标会话的行为归 `panel.workbench`（会话顶部面板），不在本能力里改绑。

## Alternatives considered

- **保留可改绑，切换时清空上下文。** 最强理由是同一会话能换书；但历史、章纲与审阅无法按作品切分，清空也破坏连续性，故不采用。
- **只改内存绑定，不持久化。** 最强理由是简单；但重启后丢失绑定，动作会要求重新选择，故不采用。
- **把绑定放到作品数据库。** 最强理由是随作品走；但“会话看哪部作品”是跨作品的 catalog 状态，故不采用。

## Consequences

- **收益**：一个会话只服务一部作品；A 会话不会被 B 的工具回执污染；跨会话隔离；重启可恢复。
- **代价与已知上限**：面板点击 B 的“打开/新建目标会话”尚未实现，归 `panel.workbench`；当前面板只会得到 `work-binding-mismatch`，不会静默改绑。
- **触发重访**：面板实现后，点击另一作品必须走打开/新建会话，不能绕过 `setSessionCurrent` 的拒绝。

## Verification

```text
node storycraft/tests/current.test.mjs                 # ALL CHECKS PASSED
node storycraft/tests/delete-current-binding.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e                # PASS: 99 unit files
npm run verify                                         # 39 capabilities: 5 verified, 34 missing
```

真实会话 `session-460...` 重启后 `story_current` 返回绑定作品，`story_next` 省略 `work` 仍落到同一作品；回执在 `artifacts/real-runs/runtime.session-binding.json`。
