# Agent Note: 故事工坊：状态与证据的唯一来源

Status: implemented

工作项：当前任务（不新建 GitHub issue）。停止“Note 生命周期 / 手写盘点表 / 代码测试”三套状态互相引用，规定当前状态的唯一证据来源。

## Problem

旧项目同时维护了三套状态：

- Agent Note 的 lifecycle 与 `## Testing`；
- `delivery-status-inventory`、`parity-matrix`、`delivery-status-replan` 里手写的 `revalidate-only`、`rework-required`、“已实现并真实验收”；
- 代码里的测试与 CI。

三者互相引用，但没有一个被规定为权威。典型失真：`parity-matrix` 把角色卡标成“已实现并真实验收”，而 `2026-10-29-storycraft-role-model-parity.md` 自己写明“消费仍读六字段，本次不改”；真实作品里 `roles:index` 有 5 个 minor，但 `facts/context/brief` 仍读 `bible:characters`，minor 从未进入生成上下文。产物写了、卡写了、消费者没迁，矩阵却记成完成。

Note 的 lifecycle 回答的是“这份记录是否落地”，不是“这个能力现在可用”；`## Testing` 回答的是“当时跑过什么”，不是“现在仍然通过”。把手写状态表当作当前事实，必然腐化。

## Decision

### 唯一证据

当前状态的唯一证据是：

1. 当前代码的自动测试与 CI（`node storycraft/scripts/ci.mjs`，以及它包含的单元/E2E/构建/打包检查）；
2. 真实链路会话证据：日期、commit、session id、`story_*` 回执与必要的 trace。

Note、roadmap、面板、任何手写表都不构成当前状态的证据。

### Note 的边界

- lifecycle 只表示记录是否落地；`implemented` 不等于能力当前可用；
- `## Testing` 只记录**当时**执行的命令、日期与结果（附 commit），不得被引用为“现在已完成”；需要当前结论时重新运行命令；
- 正文不写“已实现/已验收/已完成”这类会腐坏的状态句；需要状态时链接测试命令或真实会话证据；
- 单个 Note 可以记录自己范围内的决定与后果，但不能成为跨能力的完成台账。

### 禁止第二套状态表

- 不再新建或维护 `delivery-status-*`、`parity-matrix` 式的“已实现/待重验/已完成”手写状态表；
- 对拍表只保留“参考证据 / 我们的落点 / 偏差与裁决”，不写完成状态；需要展示状态时，由测试或脚本生成；
- 工作项验收必须包含**消费者证据**与**真实链路证据**；只有 Note 落地、文件存在或单测通过不算完成。

### 历史文档

- 旧状态文档（`parity-matrix`、`delivery-status-replan`、`parity-rebaseline`、`delivery-status-inventory`）停止维护，转入 `rejected/` 或 `archived/` 冻结；
- 冻结文档仍可作历史证据引用，但不得作为当前状态依据；当前状态查询只走 CI 与真实会话。

## Alternatives considered

**保留 parity-matrix，只把状态列改准确。** 最强理由是历史连续性、能一眼看到差距；但状态列仍靠人手写，仍会回到“三套状态”的问题，且无法机械校验，故不采用。

**给每篇 Note 加自动状态徽章（CI 生成）。** 最强理由是 Note 内就能看到状态；但会再次把状态写进 Note，造成第二份副本，且历史 Note 无法逐篇绑定当前测试，故不采用。

**只靠 `implemented` 的 `## Testing`。** 最强理由是只保留一套；但 `## Testing` 是时间点证据，不随代码更新，仍会被误读为当前状态，故不采用。

**新建独立能力账本（capability ledger）替代所有表。** 方向正确，但需要单独的生成器与验收合同；本项只规定“状态不属于 Note”，账本本身另立工作项，不在本项偷跑。

## Consequences

- 历史状态文档冻结，当前状态查询多了一步“跑 CI”，但不会再被旧结论误导；
- Note 数量减少，`verify-notes` 不再需要维护手写状态；
- 能力账本尚未建立，短期看“哪里没做”需要读测试与工作项；这是下一工作项的输入，不是本项遗留缺陷。
