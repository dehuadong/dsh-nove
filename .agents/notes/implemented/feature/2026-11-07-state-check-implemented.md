# Agent Note: 故事工坊：state.check 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `state.check`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计确认 reference 已改为语义校验器，但回执缺源结果的两个布尔；结构化 runtime schema 校验仍未覆盖。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/state-validator.ts:1-120` | 比较 old/new state+hooks；未变化短路；返回 observations/consistent/reconciliationRequired | 复刻回执补两布尔；未变化/空 findings 在 clean 回执体现 |
| `agents/state-validation-tool.ts:1-30` | reconciliation 必须给报告理由 | 复刻 findings 的 problem 即理由；空理由被 schema 拒绝 |
| `pipeline/chapter-truth-validation.ts:40-100` | consistent 或 reconciliation 任一为真进入 recovery | 复刻回执供动作层判断，不自动改稿 |

## Decision

- validator 提交 schema 接受可选 `reconciliationRequired: boolean`；
- `state-check` 回执：
  - `consistent = !reconciliationRequired`；
  - `reconciliationRequired` 显式值优先，缺省时有 findings 为 true；
- prompt/skill 说明该字段；
- consumer 保持 `state-check.test.mjs`；
- `docs/dsh-mapping.md` 登记“状态对账时机”机制等价；
- 结构化 `state/state-validator.ts` 仍为债。

## Alternatives considered

- **只由 findings 推布尔。** 最强理由是零 schema 改动；无法表达 review-only，故加可选字段。
- **直接实现结构化 validator。** 最强理由是源有该文件；它是另一层，混入会扩大范围，故登记债。
- **不补布尔。** 最强理由是现有动作只用 findings；源结果合同缺字段，故补。

## Consequences

- **收益**：回执可区分 clean、review-only、需要重算三类；真实三组回执齐全。
- **代价**：预结算与源后结算顺序不同，dsh-mapping 已登记机制等价。
- **边界**：结构化 schema 校验未实现；不自动改稿。

## Verification

```text
node storycraft/tests/state-check.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e      # PASS: 105 unit files
npm run verify                               # 25 verified / 15 missing
```

真实 fixture `对账回执`：

- 默认 finding：consistent false / reconciliation true；
- 显式 review-only：consistent true / reconciliation false；
- clean：consistent true / reconciliation false。

回执：`artifacts/real-runs/state.check.json`。
