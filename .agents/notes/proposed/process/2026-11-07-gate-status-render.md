# Agent Note: implement-gate：人类可读 status

Status: proposed

工作项：把 `implement_gate({action:'status'})` 的工具输出从 JSON 改成人类可读状态块。

## Problem

`status` 当前 render 是原始 JSON：

```json
{"ok":true,"enabled":true,"phase":"complete","work":"active","task":"..."}
```

工具卡能看到，但阶段结束后的回复仍要人工拼状态块；字段顺序、空值、下一步提示不统一。GATES 已要求每次阶段转换后输出状态块，工具输出应直接支持它。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `docs/agents/GATES.md` 状态汇报 | 阶段结束后输出 `状态/工作项/work/blockReason/下一步` | `status` render 直接输出同一块 |
| `tools/implement-gate/index.js` 的 `status` | 返回 `phase/work/task/blockReason/updatedAt/configPath` | 保留字段，仅改 render |
| `AGENTS.md` 汇报约定 | 回复必须带状态块 | 工具输出与回复使用同一格式，减少手拼 |

## Proposal

### 1. `formatStatus(value)`

状态正常：

```text
状态：complete
工作项：gate-status-render
work：active
blockReason：无
下一步：无；新任务需重新授权
```

异常：

```text
状态：misconfigured
原因：...
配置：...
```

```text
状态：not-enabled
配置：...
下一步：需要时运行 /implement-gate init
```

`blocked` 时 blockReason 显示原因，下一步提示解除 block。

### 2. render 只改 status

`implement_gate` 工具的 `render`：

- `args.action === 'status'` → `formatStatus(value)`；
- 其他 action 保持 JSON（authorize/complete 等回执字段多，JSON 更稳定）。

### 3. 测试

- 导出 `formatStatus`；
- 测试正常、blocked、misconfigured、not-enabled 四种文本；
- 测试包含“状态/工作项/work/blockReason/下一步”。

### 非目标

- 不改 phase 语义；
- 不改其他 action 的 JSON 回执；
- 不把状态块自动写进 assistant 回复（仍由 Agent 负责）。

## Alternatives considered

**所有 action 都人类可读。** 最强理由是统一；complete/authorize 回执含 code/next 等机器字段，JSON 更稳，故只改 status。

**保持 JSON，让 Agent 手拼状态块。** 最强理由是改动小；容易漏字段/顺序不一致，故不采用。

**在 pre-step 自动打印状态。** 最强理由是全自动；DSH 没有稳定的 agent 可见通知通道，故由 render + 回复规则完成。

## Acceptance criteria

1. `status` 工具卡显示人类可读块；
2. 正常、blocked、misconfigured、not-enabled 都有清楚文本；
3. 其他 action 输出不变；
4. 测试覆盖四种状态；
5. GATES/AGENTS 的状态块与工具输出一致。

## Plan Review

- Standards：只改 render，不动状态机；格式与 GATES 对齐。
- Spec：四种状态文本可观察。
- Architecture：格式化函数独立、可测试；tool render 按 action 分流。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 文本包含中文冒号/全角，测试按子串断言；
- 其他 action 仍 JSON，可能造成不一致；README 说明只有 status 人类可读；
- blocked 的 next 需要与 block/return 语义一致。
