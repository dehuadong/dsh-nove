# @dsh-nove/gate

`implement-gate` 的独立替代插件：阶段状态、写权限门禁、`/gate-*` 命令与插件专项技能。

## 命令

- `/gate-plan <工作项>`：进入 planning；主代理派 planning 与 plan review；
- `/gate-implement <工作项>`：进入 implement；非 mechanical 工作必须已有干净的 plan review；主代理派 implement、两轴 review、verify；
- `/gate-code-review <范围>`：单独只读审查已有改动；不进入 implement/verify，只输出 findings；
- `/gate-docs <范围>`：文档治理；
- `/gate-block <原因>` / `/gate-resume`：暂停或恢复当前 Gate；
- `/gate-return-discuss`：用户手动回到 discuss；Agent 用 `gate_record`；
- `/gate-status`：显示事实状态，包括 plan 就绪与 review 轮次。

## Marker

新项目使用 `.agents/gate.json`；状态存放在 `.agents/state/gate/`。

旧 `implement-gate` 保持冻结，直到新插件通过临时环境测试。切换时创建 `.agents/gate.json`，启用新插件、停用旧插件，然后删除旧 marker/state。

## 技能

`skills/` 是插件专项技能：

```text
gate-planning
gate-plan-review
gate-implement
gate-code-review-standards
gate-code-review-spec
gate-verify
```

worker 的 prompt 携带对应技能正文，不依赖 `.agents/skills` 中的同名技能。planning 额外从全局 skill 注入 `write-agent-notes`。

## 主代理派发

主代理派发每个 worker，并记录结果：

```text
gate_record({
  node,
  findings,
  requiresDiscussion,
  discussionReason,
  verification
})
```

Gate 不派 worker；它负责 phase、写权限、编排协议、review 轮次、plan 就绪、verify 证据与 blocked/complete。

`requiresDiscussion=true` 或 user-owned finding 时，主代理对当前节点调用：

```text
gate_record({ ..., requiresDiscussion: true })
```

Gate 设 `discuss` 与 `blockReason=needs-user-decision`。如果工具不可用或失败，主代理提示用户执行 `/gate-return-discuss`。`discuss` 下不允许任何 worker。

## Verify 证据

`gate_record({node:'verify'})` 必须带：

```json
{
  "verification": {
    "commands": ["命令"],
    "evidence": ["证据路径"],
    "passed": true
  }
}
```

- commands、evidence 均不能为空；
- evidence 路径必须存在；
- PASS 才 complete；
- 缺失返回 `verification-required`。

## 轮次

Plan Review 与 Implementation Review 各自最多 5 轮；达到上限仍有 findings 时进入 blocked，不视为通过。
