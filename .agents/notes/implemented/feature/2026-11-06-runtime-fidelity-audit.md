# Agent Note: 故事工坊：runtime.fidelity-audit 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.fidelity-audit`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录审计治理的决定与证据。

## Problem

此前 `verified` 只覆盖“实现 + 消费者测试 + 真机回执”，没有逐行对照源工程不变量；`plan.outline` reference 指向章纲缓存、`panel.workbench` 只测正例也能通过。需要把源证据/不变量/现状/判定/债变成可校验的治理表。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `AGENTS.md#保真原则` | 源行为是规格；偏差只有 DSH 无法等价或源行为不可观测；缺字段/产物/消费者/校验是保真债 | 审计表逐行写源证据、不变量、现状、判定、债/偏差 |
| `AGENTS.md#保真工作法` | 先提取可验证不变量，再写源证据/落点/偏差/验证 | 审计行以不变量为中心；verified 行不得未审 |
| `docs/dsh-mapping.md` | 偏差按源工程做法/复刻做法/原因/验证登记 | 机制等价/偏差行必须在债/偏差列指向该表 |

## Decision

- 新增治理能力 `runtime.fidelity-audit`：
  - implementation：`docs/fidelity-audit.md`
  - consumer：`scripts/check-fidelity-audit.mjs`
  - realRun：`artifacts/real-runs/runtime.fidelity-audit.json`
- `docs/fidelity-audit.md` 每行一能力，判定 `等价/机制等价/保真债/未审`；
- `check-fidelity-audit` 校验：
  - 40 行一一对应，无缺失/重复/未知；
  - `verified` 不得 `未审`，源证据/不变量/现状非空；
  - `保真债` 必须有当行/后续/scope/dsh-mapping 归属；
  - `机制等价` 必须指向 `docs/dsh-mapping.md`；
- `npm run verify` 加入 `check-fidelity-audit`；
- 未审的 `missing` 行禁止 implement。

## Alternatives considered

- **只在对话审计。** 最强理由是快；不可复核、不可门禁，故不采用。
- **把审计塞进 capabilities.yaml。** 最强理由是单文件；账本字段固定，会变成第二套状态表，故单独文档。
- **治理行免 realRun。** 最强理由是治理没有业务运行；会打开无回执口子，故保留 realRun，回执记录审计动作。

## Consequences

- **收益**：已 verified 的 13 行都有源证据/不变量/判定；未审行明确禁止继续实现；债/偏差有归属。
- **代价**：`missing` 行需逐步补审；审计表需随能力变化维护。
- **边界**：审计表不替代 `capabilities.yaml` 状态；状态仍只由 `check-capabilities --write` 生成。

## Verification

```text
npm run check-fidelity-audit   # ok: 40 capabilities audited, 13 verified
npm run verify                 # notes + capabilities + fidelity audit pass
```

回执：`artifacts/real-runs/runtime.fidelity-audit.json`。
