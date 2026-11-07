# Agent Note: implement-gate：docs 授权轨道

Status: implemented

工作项：为文档/仓库治理增加独立授权轨道，不调用 planning 或 implement 技能，但仍受 Gate 约束。

## Problem

原 Gate 在 `discuss` 默认允许文档写入，没有授权；文档治理完全绕开 workflow，也没有状态与回执。同时 `proposed` 被当成特殊路径，notes 被卷入工作流。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `AGENTS.md#工程工作流` | 文档和仓库治理可以绕过 planning/implement，但仍需授权 | 新增 docs 轨道：独立 phase + 命令，不加载 planning/implement |
| `docs/agents/GATES.md` | 阶段授权由用户命令触发，文档不能替代授权 | docs 只接受 owner 用户的 `批准，执行文档治理 {范围}` |
| `tools/implement-gate/classify.js` | code / docs / protected 分类 | docs 作为独立可写类别；proposed 不再特殊拦截 |

## Decision

- 新增 `phase=docs`，与 planning/implement 平级；
- 授权命令：`批准，执行文档治理 {范围}`；
- `docs` 允许文档/notes，拒绝代码；`discuss` 与 `complete` 文档也拒绝；
- `implement_gate({action:'end-docs'})`：docs → discuss；
- `complete` 在 docs phase 返回 `end-docs-required`；
- `proposed` 配置继续被接受但不再影响分类，notes 按文档处理；
- `codePaths` 默认空，需要执行入口的项目自行声明；
- `codeExtensions`、`protected` 保持不变。

## Alternatives considered

- **沿用“文档随时可写”。** 最强理由是简单；用户要求文档治理也有授权，故不采用。
- **docs 走 planning。** 最强理由是统一状态机；文档治理不需要提案技能，故用平级 phase。
- **docs 走 implement。** 最强理由是复用现有门；会误用代码技能与 proposed 检查，故分开。

## Consequences

- 文档治理需要显式命令，但不再调用 planning/implement；
- `discuss` 不再允许文档写入，错误提示指向 docs 命令；
- `notes` 在 planning/docs/implement 可写，不再有 proposed 特判；
- 代码仍只在 implement 可写；docs 结束改代码需新的 implement 授权；
- `codePaths` 默认空后，`package.json` 等入口不再默认拦截。

## Verification

```text
node tools/implement-gate/test.mjs   # ALL CHECKS PASSED
npm run verify                       # 19 verified / 21 missing
```

测试覆盖：docs 命令进入 docs、docs 允许文档拒绝代码、`end-docs` 回 discuss、discuss/complete 拒绝文档、`end-docs` 非 docs 返回 `not-docs`、init 默认拒绝文档。
