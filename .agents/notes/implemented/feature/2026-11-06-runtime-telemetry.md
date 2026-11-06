# Agent Note: 故事工坊：runtime.telemetry 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.telemetry`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录证据与边界。

## Problem

每次委派需要留下 usage、耗时与失败回执，供预算、排障与面板日志使用；没有这些行，无法判断一次失败是模型、提交还是超时。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/execution-evidence.ts:4-15` | 执行期通过 sink 记录执行证据 | 等价适配：复刻把每次 dispatch 写成 `model_calls` 行 |
| `inkos-master/packages/core/src/harness/execution-evidence.ts:17-23` | 证据绑定当前 profile/work/author request | 复刻按 work 数据库记录，不写正文 |

## Decision

- `call-evidence.ts` 从 child session 的 `assistant/message` 与 `tool/call` 读取 usage、输出字符与模型身份；
- `telemetry.ts` 的 `recordCall`/`finishCall` 写 `model_calls`：角色、作用域、尝试、触发、起止、耗时、结果、错误码、usage、stop reason；
- usage 三态：`session`（完整）、`partial`（部分消息缺 usage）、`unavailable`（无 session/无 usage）；三种都在行里可见；
- 失败先写一行再结束，不产生“开始了但没有回执”的委派；
- `callSummary` 汇总次数、耗时、按角色、usage 完整性。

## Alternatives considered

- **只在 session log 里留证据。** 最强理由是不重复存储；但按作品/章/角色查询与预算需要结构化行，故不采用。
- **缺 usage 时写 0。** 最强理由是汇总简单；但会把“未知”伪装成“零消耗”，故保留 `null` + `usageSource`。
- **失败只记日志不写行。** 最强理由是不污染统计；但失败次数与耗时也是证据，故保留失败行。

## Consequences

- **收益**：委派可追溯；usage 缺失仍可见；失败有行；面板日志与预算可读同一张表。
- **已知上限**：真实 architect 行的 usage 是 `unavailable`（旧 dispatch 未拿到 usage），不是零；这属于 provider/session 证据缺失，不伪造。
- **触发重访**：新增 provider/agent 形态时，`callEvidence` 的 usage 提取要跟着更新。

## Verification

```text
node storycraft/tests/model-calls.test.mjs   # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e      # PASS: 99 unit files
npm run verify                               # 39 capabilities: 7 verified, 32 missing
```

真实行：`session-460...` 的 `architect` dispatch，`duration_ms=247867`、`outcome=accepted`、`stop_reason=completed`、`usage_source=unavailable`；回执在 `artifacts/real-runs/runtime.telemetry.json`。
