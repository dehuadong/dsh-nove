# Agent Note: 故事工坊：state.check 输出契约修复

Status: proposed

工作项：`capabilities.yaml` 的 `state.check` 修复。`state.check` 已在复审中冻结为 `missing`；本 Note 只处理输出契约和动作层消费，不重做整个语义对账。

## Problem

复审发现 `state.check` 的真实工具调用会失败：

- `src/tools/runtime.ts` 的 `STATE_CHECK_OUTPUT` 是 `additionalProperties: false`，但没有声明 `consistent` / `reconciliationRequired`；
- `state-check` 回执已返回这两个字段，DSH 校验成功输出时会报 `INVALID_TOOL_OUTPUT`；
- `validator/tool-schema.ts` 允许 `{items:[], reconciliationRequired:true}`，与源“reconciliation 必须给理由”冲突；
- `state-settle.ts` 仍只按 `items[].severity` 决定阻断，回执两个布尔没有动作层消费者。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/state-validator.ts:78-92` | `reconciliationRequired` 为真时必须给报告理由；返回 consistent/reconciliationRequired | 复刻 schema 增加理由校验；输出契约暴露两个布尔 |
| `agents/state-validation-tool.ts:1-10` | 提交字段是 `reconciliationRequired` + `reportMarkdown` | 复刻以 `items[]` 承载报告；空 items + true 视为无理由 |
| `pipeline/chapter-truth-validation.ts:80-100` | `!consistent \|\| reconciliationRequired` 进入 recovery | 复刻动作层用 `reconciliationRequired` 判定是否阻断，`consistent` 只作回执 |

## Proposal

### 范围

1. `STATE_CHECK_OUTPUT`：
   - 增加 `consistent: boolean`、`reconciliationRequired: boolean`；
   - 两者加入 `required`；
   - 保持 `additionalProperties:false`。
2. validator 提交 schema：
   - `reconciliationRequired === true` 且 `items.length === 0` 时拒绝，错误信息明确要求至少一条 finding 说明理由。
3. `state-settle`：
   - 以 `check.reconciliationRequired` 决定是否阻断/重算，而不是只看 `items[].severity`；
   - 显式 `reconciliationRequired:false` 的 review-only finding 不再阻断落盘，但仍进入 warnings/items。
4. 测试：
   - 新增 output schema 契约测试（字段存在、required、布尔类型）；
   - 新增空 items + true 拒绝测试；
   - 新增 state-settle 对 `reconciliationRequired:false` + major finding 落盘、`true` 阻断的测试；
   - 原有 state-check 测试保留。
5. 回执：
   - 在当前 HEAD 重新生成 `state.check` 真实回执后才允许置 `verified`；
   - 旧回执已归档到 `artifacts/real-runs/stale-2026-11-07/`，不再使用。

### 非目标

- 不重做 source `state/state-validator.ts` 的结构化 schema 校验；仍为后续债。
- 不改 `state-check` 的语义判断、证据核验或 validator prompt 主体。
- 不恢复 `capabilities.yaml` 的 old verified 状态；修复通过后单独重验。

### 失败行为

- 空 items + reconciliationRequired=true → schema 拒绝，子代理重提；
- `reconciliationRequired=true` → 结算进入 unresolved/reconcile 路径；
- `reconciliationRequired=false` → 不因 major finding 进入重算，但保留 warning；
- 回执缺字段 → DSH 输出校验拒绝，这是修复目标。

## Alternatives considered

**只补 output schema。** 最强理由是修掉 `INVALID_TOOL_OUTPUT`；不解决空理由和动作层消费，复审会再次判 `needs_changes`，故一并修。
**让 state-settle 继续只看 severity。** 最强理由是改动小；两个布尔会成为装饰字段，源语义没有落地，故改为用布尔判定阻断。
**重做结构化 validator。** 最强理由是源有该文件；它是另一层能力，混入会扩大本工作项，故保留为债。

## Acceptance criteria

1. `STATE_CHECK_OUTPUT` 声明并 required `consistent`/`reconciliationRequired`；
2. 空 items + true 被 validator schema 拒绝；
3. `state-settle` 在 `reconciliationRequired:true` 时阻断，在显式 false 的 review-only 结果下落盘；
4. output schema 契约测试与 state-settle 行为测试通过；
5. 当前 HEAD 的真实回执可复现，旧回执不再引用；
6. `capabilities.yaml` 仍为 `missing`，验收通过后再由 `check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：修真实 bug，不把旧回执当证据；schema 与行为都有 consumer。
- Spec：输出字段、空理由拒绝、动作层布尔消费都可观察。
- Architecture：`STATE_CHECK_OUTPUT` 是工具契约；`state-settle` 是消费者；结构化 validator 不混入。
- 结论：通过，进入实施需 implement 授权。

## Risks

- `reconciliationRequired:false` + major finding 落盘会改变现有阻断行为，需确认 warnings 仍展示；
- 空 items + true 可能误伤只给报告不给 finding 的子代理；当前协议没有 report 字段，先按无理由拒绝；
- 真实回执必须来自修复后的 commit，不能用旧 session。
