# Agent Note: 故事工坊：foundation.approval 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `foundation.approval`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

基础设定需要作者确认闸门，确认必须绑定当前基础设定指纹，改稿后失效；面板和会话两条入口不能各写一套状态。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/interaction/session.ts:9-10` | TUI 确认持久化已校验 action envelope，确认时按当前 schema 重新校验 | 复刻 `approveFoundation` 先要求 foundation 完整，再写 source/reason |
| `interaction/session.ts` 的 `PendingProposedActionSchema` | 待确认动作是 pending，不自动批准 | 复刻只由面板按钮或会话动作确认，模型不能代签 |
| `inkos-master/packages/core/src/agents/settler-tool.ts:51` | supersede 只用于当前作者确认的基础设定变化 | 复刻确认绑定 `foundationRevisionOf(db)`，改稿后 `foundationApprovedAt` 失效 |

## Decision

- `approveFoundation`：
  - `foundation.complete === true` 才允许，否则 `foundation-incomplete`；
  - 写 `foundation_approved_at`、`foundation_approved_revision`、`source`、`reason`；
- `approvalSourceOf`：只接受 `panel` / `conversation`，默认 `panel`；
- `approvalReasonOf`：空理由存 null，不编造；
- 面板 `approveFoundationFromPanel`：只允许 session 当前作品，来源 `panel`；
- 会话 `story_approve(kind='foundation')`：来源 `conversation`，可带 author reason；
- `foundationApprovedAt` 按当前指纹校验，改稿即失效。

## Alternatives considered

- **只记 approvedAt。** 最强理由是简单；但改写后旧确认仍生效，故不采用。
- **允许模型代签。** 最强理由是流程快；确认是作者闸门，模型代签会伪造回执，故不采用。
- **面板/会话两套状态。** 最强理由是路径清晰；两套会漂移，故复用同一 meta 字段。

## Consequences

- **收益**：确认绑定 revision；source/reason 可追溯；改稿自动失效；跨作品面板确认被拒。
- **代价**：旧库字段已在 schema 中，测试作品重建；不做迁移。
- **边界**：本项只做 foundation；outline/plan 的 approval 是既有路径。

## Verification

```text
node storycraft/tests/panel-approval.test.mjs    # ALL CHECKS PASSED
node storycraft/tests/foundation-gate.test.mjs   # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e          # PASS: 101 unit files
npm run verify                                   # 11 verified / 28 missing
```

真实 fixture `伏笔回执`：

- `source=conversation`，`reason=回执确认`；
- `foundation_approved_revision=7686ff9d…`。

回执：`artifacts/real-runs/foundation.approval.json`。
