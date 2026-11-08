# Agent Note: 故事工坊：state.check 输出契约修复

Status: implemented

工作项：`capabilities.yaml` 的 `state.check`。复审曾把它冻结为 `missing`；本记录是输出契约修复，不重做整个语义对账。

## Problem

复审判定 `state.check` 的验收证据不成立：

- `STATE_CHECK_OUTPUT` 是 `additionalProperties:false`，但没有声明 `consistent` / `reconciliationRequired`；
- `state-check` 返回这两个字段，真实工具调用会 `INVALID_TOOL_OUTPUT`；
- validator schema 接受 `{items:[], reconciliationRequired:true}`，没有理由；
- `state-settle` 只看 `items[].severity`，布尔没有动作层消费者。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/state-validator.ts:78-92` | `reconciliationRequired` 为真时必须给报告理由；返回 consistent/reconciliationRequired | 复刻 schema 增加理由校验；成功回执暴露两个布尔 |
| `agents/state-validation-tool.ts:1-10` | 提交字段是 `reconciliationRequired` + `reportMarkdown` | 复刻以 `items[]` 承载报告；空 items + true 视为无理由 |
| `pipeline/chapter-truth-validation.ts:80-100` | `!consistent \|\| reconciliationRequired` 进入 recovery | 复刻动作层用 `reconciliationRequired` 判定阻断；`consistent` 只作回执 |

## Decision

- `STATE_CHECK_OUTPUT` 声明 `consistent: boolean` 与 `reconciliationRequired: boolean`；`required` 只保留 `ok`，失败 envelope 不被误伤。
- validator schema 拒绝 `reconciliationRequired:true` 且 `items` 为空，错误要求至少一条 finding 说明理由。
- `state-check` 的缺省值取 `items` 中是否存在 `major`；只有 minor 的 review-only 结果不触发重算。
- `state-settle` 用 `check.reconciliationRequired` 决定是否阻断：true 进入 unresolved/reconcile；显式 false 的 major finding 落盘但保留 warning。
- prompt、skill、README 与 `story_settle` 描述同步为布尔语义。
- 当前 HEAD 生成新回执 `artifacts/real-runs/state.check.json`；旧回执保留在 `artifacts/real-runs/stale-2026-11-07/`。

## Alternatives considered

- **只补 output schema。** 最强理由是修掉 `INVALID_TOOL_OUTPUT`；不解决空理由和动作层消费，复审会再次判 `needs_changes`，故一并修。
- **让 state-settle 继续只看 severity。** 最强理由是改动小；两个布尔会成为装饰字段，故改为用布尔判定阻断。
- **重做结构化 validator。** 最强理由是源有该文件；它是另一层能力，混入会扩大本工作项，故保留为独立后续。

## Consequences

- **收益**：成功工具输出通过 schema；空理由被拒绝；review-only 与 reconcile 在结算层可区分；旧回执不再背书新代码。
- **代价**：显式 `reconciliationRequired:false` 的 major finding 不再阻断，必须确认 warnings 仍展示；默认值从“有 finding”改为“有 major”。
- **边界**：结构化 `state/state-validator.ts` 未实现，仍作为独立能力债；预结算/后结算差异已在 `docs/dsh-mapping.md` 登记。

## Testing

```text
node storycraft/tests/state-check-output.test.mjs  # ALL CHECKS PASSED
node storycraft/tests/state-check.test.mjs         # ALL CHECKS PASSED
node storycraft/tests/state-settle.test.mjs        # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e            # PASS: 106 unit files
npm run verify                                     # 1 verified / 39 missing
```

真实回执：`artifacts/real-runs/state.check.json`，testedCommit `8a2adc0`。
