# Agent Note: implement-gate：docs 授权轨道

Status: proposed

工作项：为文档/仓库治理增加独立授权轨道，不调用 planning 或 implement 技能，但仍受 Gate 约束。

## Problem

当前 Gate：

- `discuss` 默认允许文档、YAML/JSON 写入，没有授权；
- 文档治理完全绕开 workflow，既没有状态，也没有回执；
- 同时 `proposed` 被当成特殊路径，notes 被卷入工作流。

用户要求：文档治理也需要授权门禁，但不需要 planning 提案或 implement 技能；只有代码才走 planning/implement。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `AGENTS.md#工程工作流` | “文档和仓库治理工作可以绕过该工程工作流；涉及重要合同变化时仍遵守 GATES” | 复刻增加轻量 docs 授权，只约束文档写入，不进入 planning/implement |
| `docs/agents/GATES.md` | 阶段授权由用户命令触发，文档不能替代授权 | docs 也必须有明确用户命令；不能在 discuss 直接写 |
| `tools/implement-gate/classify.js` | code vs docs/proposed/protected 分类 | 保留 code 分类；docs 作为独立可写类别，不再借 proposed 特殊路径 |

## Proposal

### 1. 新 phase `docs`

状态机：

```text
discuss --批准，执行文档治理 {scope}--> docs --end-docs--> discuss
discuss --planning--> planning --end-planning--> discuss
discuss --implement--> implement --complete--> complete
```

`docs` 与 `planning`/`implement` 平级，不是 planning 的前置或后续。

### 2. 授权命令

新增配置命令：

```text
批准，执行文档治理 {scope}
```

- 只接受 owner 用户消息；
- 进入 `phase=docs`，记录 `task=scope`；
- 不加载 planning/implement 技能；
- 不改代码授权。

### 3. 写入矩阵

| phase | docs / YAML / JSON / notes | code |
|---|---|---|
| discuss | 拒绝（需 docs 授权） | 拒绝 |
| planning | 允许（规划产物） | 拒绝 |
| docs | 允许 | 拒绝 |
| implement | 允许 | 允许 |
| complete | 拒绝 | 拒绝 |

- `protected`（marker/state）永远拒绝；
- `proposed` 不再是特殊代码路径；notes 属于 docs；
- `codeExtensions` 识别代码，`codePaths` 默认空。

### 4. `end-docs`

实现 `implement_gate({action:'end-docs'})`：

- 仅 `phase=docs` 可调用；
- `docs → discuss`；
- 清 blockReason；
- 返回 `{ok:true, phase:'discuss'}`；
- 不再返回 `not-supported`。

### 5. 与 implement 的关系

- docs phase 不允许代码；
- docs 结束后改代码仍需 implement 授权；
- implement 的 proposed/mechanical 工作项检查仍归 `implement-gate-work-item-check`，不在本项实现。

### 非目标

- 不实现 implement 的 proposed/mechanical 检查；
- 不实现 return-to-discuss（另一工作项）；
- 不把 docs 授权当作代码授权。

## Alternatives considered

**沿用“文档随时可写”。** 最强理由是简单；用户要求文档治理也有授权，故不采用。

**docs 走 planning。** 最强理由是统一状态机；文档治理不需要提案技能，故新增平级 phase。

**docs 走 implement。** 最强理由是已有 implement 门；会误用代码技能和 proposed 检查，故分开。

## Acceptance criteria

1. `discuss` 写文档被拒绝，提示 docs 授权命令；
2. `批准，执行文档治理 {scope}` 进入 `docs`；
3. `docs` 可写文档/notes，写代码被拒绝；
4. `end-docs` 回到 discuss；
5. `complete` 不再支持从 docs 直接完成，必须 end-docs；
6. 现有 code gate 行为不变，proposed 不再特殊拦截；
7. 测试覆盖进入、拒绝、end-docs 与 phase 矩阵。

## Plan Review

- Standards：docs 授权独立、不调用 planning/implement；code gate 不变。
- Spec：命令、phase、写入矩阵、end-docs 都可观察。
- Architecture：docs 是平级 phase，不是 workflow 的一步。
- 结论：通过，进入实施需 implement 授权。

## Risks

- `discuss` 拒绝文档会改变现有“随时改文档”的习惯，需要清晰错误提示；
- `planning` 仍允许 notes，避免规划被 docs 授权阻断；
- `codePaths` 默认空后，package.json 等执行入口需项目显式声明。
