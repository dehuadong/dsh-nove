# Agent Note: implement-gate：人类可读 status

Status: implemented

工作项：把 `implement_gate({action:'status'})` 的工具输出从 JSON 改成人类可读状态块。

## Problem

`status` 的 render 是原始 JSON，工具卡能看到，但阶段结束后的回复仍要人工拼状态块；字段顺序、空值和下一步提示不统一。GATES 已要求每次阶段转换后输出状态块。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `docs/agents/GATES.md` 状态汇报 | 阶段结束后输出 `状态/工作项/work/blockReason/下一步` | `status` render 直接输出同一块 |
| `tools/implement-gate/index.js` 的 `status` | 返回 `phase/work/task/blockReason/updatedAt/configPath` | 保留字段，仅改 render |
| `AGENTS.md` 汇报约定 | 回复必须带状态块 | 工具输出与回复使用同一格式 |

## Decision

- 新增 `formatStatus(value)`：
  - 正常：`状态/工作项/work/blockReason/下一步`；
  - `work-item-required`：下一步提示提供 proposed Note 或 mechanical；
  - blocked：提示解除 block；
  - misconfigured：原因 + 配置路径；
  - not-enabled：配置路径 + init 提示。
- `implement_gate` 工具 `render` 按 action 分流：
  - `status` 用 `formatStatus`；
  - 其他 action 保持 JSON。
- 导出 `formatStatus` 供测试。

## Alternatives considered

- **所有 action 都人类可读。** 最强理由是统一；complete/authorize 回执含 code/next 等机器字段，JSON 更稳，故只改 status。
- **保持 JSON，让 Agent 手拼状态块。** 最强理由是改动小；容易漏字段/顺序不一致，故不采用。
- **在 pre-step 自动打印状态。** 最强理由是全自动；没有稳定的 agent 可见通知通道，故由 render + 回复规则完成。

## Consequences

- `status` 工具卡可直接读；
- 回复仍必须输出状态块，不能只贴工具卡；
- 其他 action 的 JSON 不变，调用方兼容；
- 状态块与 GATES/AGENTS 的格式一致。

## Verification

```text
node tools/implement-gate/test.mjs   # ALL CHECKS PASSED
npm run verify                       # 通过
```

测试覆盖正常、work-item-required、blocked、misconfigured、not-enabled 五种文本。
