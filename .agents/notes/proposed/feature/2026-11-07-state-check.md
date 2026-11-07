# Agent Note: 故事工坊：state.check 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `state.check`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计确认 reference 已改为语义校验器，但当前回执缺源结果的两个布尔：

- 源 `StateValidatorAgent.validate` 返回 `observations/consistent/reconciliationRequired`；
- 未变化 old/new state+hooks 直接短路；
- `reconciliationRequired=true` 时报告必须给理由；
- 当前 `state-check` 返回 findings/counts，没有 consistent/reconciliationRequired。

另：`state/state-validator.ts` 的结构化 runtime schema 校验不是本能力，当前未覆盖。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/state-validator.ts:1-120` | 比较 old/new state+hooks；未变化短路；返回 observations/consistent/reconciliationRequired | 复刻回执补两布尔；短路在确定性阶段 |
| `agents/state-validation-tool.ts:1-30` | reconciliation 必须给 reportMarkdown 理由 | 复刻 findings 的 problem 即理由；空理由拒绝 |
| `pipeline/chapter-truth-validation.ts:40-100` | consistent 或 reconciliation 任一为真进入 recovery | 复刻回执供动作层判断；不自动改稿 |

## Proposal

### 范围

- validator 提交 schema 增加可选 `reconciliationRequired: boolean`；
- `state-check` 回执增加：
  - `consistent`：无 findings 为 true，否则 false；
  - `reconciliationRequired`：子代理显式值；缺省时 findings 非空为 true；
- findings 非空但 reconciliationRequired 未给理由（problem 空）已由 schema 拒绝；
- 测试：无 findings → consistent true/reconciliation false；有 findings → false/true；显式 false 的 review-only 保留；
- consumer 保持 `state-check.test.mjs`；
- 真实回执：真实作品一次有 finding、一次 clean。

### 非目标 / 保真债

- **结构化 `state/state-validator.ts` 未实现**：重复 hook id、summary chapter、current state ahead 检查不在本能力；偿还路径：独立 state.schema-check 能力。审计表登记债。
- 不改变预结算/后结算顺序；源是结算后校验，复刻是草案前校验，属机制差异，登记 dsh-mapping。

### 失败行为

- 子代理失败 → 既有 `state-check-unavailable`/错误回执；
- findings 超限/缺字段 → schema 拒绝；
- reconciliationRequired=true 且 problem 空 → 拒绝。

## Alternatives considered

**只由 findings 推布尔。** 最强理由是零 schema 改动；无法表达 review-only，故加可选字段并保留显式值。
**直接实现结构化 validator。** 最强理由是源有该文件；它是另一能力/另一层，混入会扩大范围，故登记债。
**不补布尔，保持 findings。** 最强理由是现有动作只用 findings；源结果合同缺字段，故补。

## Acceptance criteria

1. 无 findings：consistent true、reconciliationRequired false；
2. 有 findings：consistent false；显式 reconciliationRequired 保留；
3. 未给 reconciliationRequired 时有 findings 默认 true；
4. reconciliationRequired=true 的理由不可为空；
5. 结构化 validator 债有后续归属；
6. consumer 与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：补源结果字段；结构化校验另列债，不混入。
- Spec：布尔、理由、短路、回执都可观察。
- Architecture：state-check 是预结算语义检查；结构化 schema 校验是独立层。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 预结算与源后结算顺序不同，布尔语义只能近似；需 dsh-mapping 说明；
- validator 子代理可能不提交新字段，默认值要稳；
- 真实回执需要能稳定产生 finding 的 fixture。
