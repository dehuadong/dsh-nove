# Agent Note: 故事工坊：plan.outline 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `plan.outline`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

全书计划决定主线、卷划分与结局方向；未确认前不能写章纲，重写后旧确认必须失效。当前能力行 reference 指向章纲缓存，consumer 只测卷图，未覆盖 outline 确认链。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/architect-tool.ts:1-5` | architect 产出 story frame / volume map 等基础设定 | 复刻全书计划属于 foundation 后的 plan 阶段，卷图是投影 |
| `inkos-master/packages/core/src/pipeline/runner.ts:478-505` | 基础设定写入后初始化控制文档与章节索引 | 复刻 `writeOutline` 写 outline 工件并置 `outline_written_at` |
| `inkos-master/packages/core/src/agents/architect.ts` 的 outline 生成 | 主线、卷划分、结局方向由 architect 产出 | 复刻 outline 文本结构：主线 / 卷划分 / 结局方向 |

## Decision

- 修正能力行：
  - reference 从章纲缓存 `pipeline/persisted-governed-plan.ts` 改为 architect 证据；
  - implementation 改为 `storage/repositories/catalog.ts`；
  - consumer 改为 `tests/outline.test.mjs`。
- `writeOutline`：
  - 主线必填，空主线 `outline-invalid`；
  - 写 outline 工件与 `outline_written_at`；
  - 新 revision 使旧确认按指纹失效。
- `approveOutline`：
  - 未写 outline 时 `outline-required`；
  - 记录 source/reason/revision。
- `nextStep`：未确认返回 `outline-approval` 阻塞。

## Alternatives considered

- **沿用章纲缓存作为源证据。** 最强理由是账本已这么写；它不是全书计划，故修正。
- **outline 当普通文本，不绑定 revision。** 最强理由是简单；改稿后旧确认仍有效，故不采用。
- **volumes 独立于 outline。** 最强理由是卷图可单独编辑；两处会漂移，故以 outline 文本为准。

## Consequences

- **收益**：全书计划有写入/确认/失效闭环；`nextStep` 闸门可观察；能力行 metadata 与真实实现一致。
- **代价**：无 schema 变化；旧作品无需迁移。
- **边界**：不做章纲，不做卷图 UI；章纲是 `plan.chapter`。

## Verification

```text
node storycraft/tests/outline.test.mjs      # ALL CHECKS PASSED
node storycraft/tests/volumes.test.mjs      # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e     # PASS: 102 unit files
npm run verify                              # 12 verified / 27 missing
```

真实 fixture `示例短篇`：`outline_approved_revision=6662284075da`，当前 revision `edfe468c232f`，旧确认已失效。

回执：`artifacts/real-runs/plan.outline.json`。
