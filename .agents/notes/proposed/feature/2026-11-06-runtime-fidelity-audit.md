# Agent Note: 故事工坊：runtime.fidelity-audit 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.fidelity-audit`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载审计治理规则、验收与证据。

## Problem

现有 `verified` 只证明“实现 + 消费者测试 + 真机回执”，没有逐行对照：

- 源工程证据位置；
- 源行为不变量；
- 复刻现状；
- 判定（等价 / 机制等价 / 保真债）；
- 债或偏差的归属。

结果是 `plan.outline` 的 reference 指向章纲缓存、`panel.workbench` 只测正例也能通过。审计必须成为继续实现的前置条件，而不是事后补文档。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `AGENTS.md#保真原则` | 源行为是规格；偏差只能来自 DSH 无法等价或源行为不可观测；缺字段/产物/消费者/校验是保真债 | 审计表每行必须写源证据、不变量、现状、判定与债/偏差 |
| `AGENTS.md#保真工作法` | 提案必须带源工程证据；先提取不变量，再写源证据/落点/偏差/验证 | 审计行采用同一四段结构，但以“不变量”为中心 |
| `docs/dsh-mapping.md` | 偏差按“源工程做法 / 复刻做法 / 原因 / 验证”登记 | 审计判定为偏差的行必须链接该表对应行 |

## Proposal

### 1. 能力行

新增：

```yaml
- id: runtime.fidelity-audit
  title: 全量能力保真审计（源行为不变量 / 债 / 偏差）
  reference: AGENTS.md#保真原则
  dsh: docs + scripts
  implementation: docs/fidelity-audit.md
  consumer: scripts/check-fidelity-audit.mjs
  realRun: artifacts/real-runs/runtime.fidelity-audit.json
  status: missing
```

治理行不写业务代码；但保留 `realRun`，回执记录“审计表 + checker + 本次审计会话”，不特殊放宽 checker 的真实回执规则。

### 2. `docs/fidelity-audit.md`

每个能力一行：

| 能力 | 源证据 | 源行为不变量 | 复刻现状 | 判定 | 债/偏差 |
|---|---|---|---|---|---|
| `runtime.load` | `<源文件:行>` | <可验证不变量> | `<实现/测试>` | 等价 / 机制等价 / 保真债 / 未审 | `当行补齐` / 后续行 / dsh-mapping 行 |

判定枚举：

- `等价`：行为相同；
- `机制等价`：DSH 机制不同，但行为等价且有验证；
- `保真债`：缺字段/产物/消费者/校验，必须写偿还路径；
- `未审`：尚未审计，禁止进入 implement。

### 3. `scripts/check-fidelity-audit.mjs`

校验：

1. `docs/fidelity-audit.md` 覆盖 `capabilities.yaml` 每个 id，且不重复；
2. `verified` 行不得是 `未审`，源证据/不变量/复刻现状/判定/债列非空；
3. 判定 `保真债` 必须有债归属（`docs/scope.md` 的债段或审计行内“后续行”说明）；
4. 判定 `机制等价` 或 `偏差` 必须在 `docs/dsh-mapping.md` 找到对应条目；
5. `missing` 行可以为 `未审`，但审计表必须存在该行。

### 4. 推进规则

- 先审已 `verified` 的 12 行，逐行给出不变量；
- 未审的 `missing` 行不得进入 implement；
- 审计发现债：先写 `docs/scope.md` 债段或审计行归属，再决定当行补齐/后续行；
- 审计发现偏差：先写 `docs/dsh-mapping.md`，再继续。

### 非目标

- 不重写业务实现；
- 不把审计表做成第二套状态表（status 仍只来自 `check-capabilities`）；
- 不为每一行补真实运行；审计证据用现有回执 + 代码/测试。

## Alternatives considered

**只在对话里审计，不落文档。** 最强理由是快；不可复核、不可门禁，故不采用。

**把审计表塞进 `capabilities.yaml`。** 最强理由是单文件；账本字段固定，审计内容会撑爆状态表，故单独文档。

**给治理行免除 realRun。** 最强理由是治理没有业务运行；但会打开“无回执也能 verified”的口子，故保留 realRun，回执记录审计动作。

## Acceptance criteria

1. `runtime.fidelity-audit` 行存在，implementation/consumer/realRun 路径成立；
2. `docs/fidelity-audit.md` 至少覆盖当前 12 个 `verified` 行，并逐行有源证据/不变量/现状/判定；
3. 审计发现的债进入 `docs/scope.md` 或审计行归属；偏差进入 `docs/dsh-mapping.md`；
4. `check-fidelity-audit` 通过，能拒绝缺行、重复行、`verified` 未审、无归属的债；
5. 治理行真实回执写入后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：审计表是证据，不替代 capability status；治理行保留 realRun。
- Spec：覆盖、判定、债/偏差归属、checker 拒绝条件都可观察。
- Architecture：文档 + 脚本，不写业务代码；不新建第二套状态。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 39 行全量审计工作量大，先审 verified 12 行，missing 行可 `未审` 但禁止 implement；
- 源证据行号可能变动，checker 只校验字段不校验源码内容；
- 债归属若只写“后续”而无具体行，checker 应拒绝。
