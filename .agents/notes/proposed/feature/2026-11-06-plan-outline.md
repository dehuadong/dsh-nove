# Agent Note: 故事工坊：plan.outline 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `plan.outline`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

全书计划（主线、卷划分、结局方向）需要：

- 写入 `outline` 工件与 `volumes` 投影；
- 新计划立即撤销旧确认；
- `nextStep` 在未确认前阻止章纲；
- 卷图字段可读、可校验。

当前 `writeOutline`/`approveOutline` 在 `catalog.ts`，卷图在 `volumes.ts`；能力行把 implementation 写成 `volumes.ts`、consumer 写成 `volumes.test.mjs`，没有覆盖 outline 的 revision 失效与 nextStep 闸门。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/architect-tool.ts:1-5` | architect 生成 story frame / volume map 等基础设定 | 复刻全书计划属于 foundation 后的 plan 阶段；卷图是结构化投影 |
| `inkos-master/packages/core/src/pipeline/runner.ts:478-505` | 基础设定写入后初始化控制文档与章节索引 | 复刻 `writeOutline` 写 outline 工件并置 `outline_written_at` |
| `inkos-master/packages/core/src/agents/architect.ts` 的 outline 生成 | 主线、卷划分、结局方向由 architect 产出 | 复刻 `outline` 文本结构：主线 / 卷划分 / 结局方向 |

> 账本当前 reference `pipeline/persisted-governed-plan.ts` 是章纲 JSON 缓存，不是全书计划；实施时改成 architect/runner 证据，属于元数据修正，不是新能力。

## Proposal

### 范围

- 审计 `writeOutline`：
  - 主线必填；
  - 写 `outline` 工件与 `outline_written_at`；
  - 重写产生新 revision，旧确认按指纹失效；
- 审计 `approveOutline`：
  - 未写 outline 时 `outline-required`；
  - 记录 source/reason/revision；
- 审计 `volumes.ts`：
  - 卷图解析/写入与 outline 文本一致；
  - 非法卷字段拒绝；
- 消费者测试覆盖：
  - 未确认 outline 阻止章纲；
  - 确认后 nextStep 进入章纲；
  - 重写 outline 撤销确认；
  - 卷图与 outline 文本一致；
  - 未写 outline 时确认拒绝。

### 非目标

- 不做章纲（`plan.chapter`）；
- 不做卷图 UI 编辑；
- 不迁移旧作品。

### 失败行为

- 主线为空 → `outline-invalid`；
- 未写 outline 就确认 → `outline-required`；
- 重写后未再确认 → `nextStep` 返回 `outline-approval` 阻塞。

## Alternatives considered

**把 outline 当普通文本，不做 revision 失效。** 最强理由是简单；改稿后旧确认仍然有效，故不采用。

**让 volumes 独立于 outline。** 最强理由是卷图可单独编辑；两处会漂移，故以 outline 文本为准，volumes 是投影。

**直接沿用 `persisted-governed-plan.ts` 作为源证据。** 最强理由是账本已这么写；它是章纲缓存，不是全书计划，故实施时修正 reference。

## Acceptance criteria

1. 主线为空拒绝；
2. 写 outline 后未确认，`nextStep` 阻塞在 `outline-approval`；
3. 确认后 `nextStep` 进入章纲；
4. 重写 outline 后确认失效，重新阻塞；
5. 卷图字段与 outline 文本一致；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先审计现有 outline/volumes，不新增章节计划；修正账本 reference/consumer。
- Spec：主线、确认、失效、卷图一致都可观察。
- Architecture：outline 是全书计划工件，volumes 是投影；确认复用 approval meta。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有 `volumes.test` 可能只测卷图，不测 outline 确认链；
- 真实回执需要真实全书计划确认，不能只用 fixture；
- 源工程 outline 的实际文件结构需在实施时再核对，避免把卷图文本当章纲。
