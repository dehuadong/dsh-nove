# Agent Note: 故事工坊：foundation.approval 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `foundation.approval`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

基础设定必须有作者确认闸门：

- 面板确认和会话确认都记录来源与理由；
- 确认绑定当前基础设定指纹，改稿后自动失效；
- 只允许确认当前会话绑定的那部作品；
- 未完成的基础设定不能确认。

当前已有 `approveFoundation`、`approveFoundationFromPanel`、`foundation-gate` 与 `panel-approval` 测试，但能力行仍指向 `approval-binding.test.mjs`（它测的是 outline/plan，不是 foundation），也没有真实回执。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/interaction/session.ts:9-10` | TUI 确认会持久化已校验的 action envelope；确认时按当前 schema 重新校验 | 复刻确认记录 source/reason，并要求 foundation 完整后写入 |
| `inkos-master/packages/core/src/interaction/session.ts` 的 `PendingProposedActionSchema` | 待确认动作是 pending，不是自动批准 | 复刻只由作者按钮/动作确认，模型不能代签 |
| `inkos-master/packages/core/src/agents/settler-tool.ts:51` | supersede 只用于当前作者确认的基础设定发生变化 | 复刻确认绑定 foundation revision；改稿后 `foundationApprovedAt` 失效 |

## Proposal

### 范围

- 审计 `approveFoundation`：
  - `foundation.complete === true` 才允许；
  - 写 `foundation_approved_at`、`foundation_approved_revision`、`source`、`reason`；
- 审计 `foundationApprovedAt`：
  - 记录 revision 与当前 `foundationRevisionOf` 不一致时视为未确认；
- 面板路径 `approveFoundationFromPanel`：
  - 只允许 session 当前作品；
  - 来源记为 `panel`；
- 会话路径 `story_approve`：
  - 来源记为 `conversation`；
  - 不接受模型代签；
- 消费者测试补：
  - 改 foundation 后确认失效；
  - 未完成 foundation 拒绝；
  - 跨作品面板确认 `work-mismatch`；
  - source/reason 写入。

### 非目标

- 不改 outline/plan 的 approval；
- 不做短篇/剧本确认；
- 不做旧作品迁移。

### 失败行为

- foundation 不完整 → `foundation-incomplete`；
- 面板确认别的作品 → `work-mismatch`；
- 确认记录 revision 与当前指纹不一致 → 视为未确认，`nextStep` 重新要求确认。

## Alternatives considered

**只记录 approvedAt，不绑定 revision。** 最强理由是简单；但改稿后旧确认仍然生效，源工程明确要求当前作者确认，故不采用。

**允许模型调用 `story_approve` 代签。** 最强理由是流程快；确认是作者闸门，模型代签会伪造回执，故不采用。

**面板与会话各写一套确认表。** 最强理由是路径清晰；两套状态会漂移，故复用同一 meta 字段。

## Acceptance criteria

1. foundation 完整后才能确认；
2. 面板确认记录 `source=panel`，会话确认记录 `source=conversation`；
3. 确认记录 `reason` 可读，空理由不写假回执；
4. 修改 foundation 任一工件后，`foundationApprovedAt` 失效，`nextStep` 重新要求确认；
5. 面板确认当前会话以外的作品返回 `work-mismatch`；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：确认是作者闸门，不允许模型代签；复用现有 meta，不建第二套状态。
- Spec：完整度、source、reason、revision 失效、跨作品都可观察。
- Architecture：确认属于 foundation 存储；面板/会话是两条入口，不是两套状态。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有 `foundationApprovedAt` 已按 revision 失效，可能只差测试与证据；
- 面板确认测试的 seed 手工插入 artifact，需同步新 schema 字段默认；
- 真实回执需要真实基础设定确认，不能用纯 fixture 代替。
