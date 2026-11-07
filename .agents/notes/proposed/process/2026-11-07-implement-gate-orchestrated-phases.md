# Agent Note: gate-plugin-replacement：主代理编排与新 Gate 插件

Status: proposed

工作项：新建完整 Gate 插件，替代 `implement-gate`；主代理派发阶段 worker，Gate 负责阶段协议、写权限、轮次与状态。

## Problem

现有 `implement-gate` 只有写权限，没有阶段 worker 协议。语义口令不能保证模型加载技能，也不能保证 review 与实现分离。

前一轮设计把 Gate 写成 worker 派发者，与“主代理派发子代理”的实际流程冲突；同时 review 发现问题后没有要求先回 discuss，导致状态仍是 implement/orchestrating 时继续对话和改文件。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `.agents/skills/planning/SKILL.md` | 工作项、合同、技术设计、决定、Plan Review | `gate-planning` 保留形成/决定/修正；Plan Review 拆给 review worker |
| `.agents/skills/planning/review.md` | 三轴评审、合同/设计检查、决定与修正、通过条件 | 评审线归 `gate-plan-review`；决定与修正归 planning；通过结论由 gate 记录 |
| `.agents/skills/implement/SKILL.md` | 入口、拆解、执行、Implementation Review、完成交接 | `gate-implement` 保留执行与 findings 修正；review 拆出 |
| `.agents/skills/code-review/SKILL.md` | 两轴、固定点、标准/smell、验收合同 | 拆为 standards/spec 两个只读 worker；聚合归主代理/gate |
| `.agents/skills/verify/SKILL.md` | 验收、执行、失败诊断、最终报告 | `gate-verify` 只验收报告；修复由 gate 路由 |
| `.agents/skills/write-agent-notes/SKILL.md` | Note 位置、格式、生命周期、校验 | Gate 在 planning worker 启动时注入，不复制 |
| `docs/agents/GATES.md` | Plan/Implementation Review 各最多 5 轮；达上限不通过 | `gate_record` 持久计数；需要用户决定时回 discuss |

## Proposal

### 1. 新插件，完整替代旧 gate

```text
tools/gate/
  package.json
  index.js
  src/config.js
  src/classify.js
  src/state.js
  skills/
    gate-planning/SKILL.md
    gate-plan-review/SKILL.md
    gate-implement/SKILL.md
    gate-code-review-standards/SKILL.md
    gate-code-review-spec/SKILL.md
    gate-verify/SKILL.md
  cordis.patch.yml
  test.mjs
```

- 包名 `@dsh-nove/gate`；
- 新 marker `.agents/gate.json`；
- 新 state `.agents/state/gate/`；
- 不修改 `.agents/skills`；
- 不修改旧 `implement-gate`；切换后删除旧插件、旧 marker、旧 state。

### 2. 职责边界

| 角色 | 职责 |
|---|---|
| 主代理 | 派发 worker、接收 findings、在需要用户决定时回 discuss、汇报 |
| Gate | phase、写权限、阶段协议注入、`gate_record`、轮次、blocked/complete |
| worker | 按注入的技能方法完成单节点，返回结构化结果 |

Gate 不直接派 worker；worker 由主代理通过 subagent 工具派发。

### 3. Gate 状态

```json
{
  "phase": "discuss | orchestrating | docs | complete",
  "node": "plan | plan-review | plan-revise | implement | code-review-standards | code-review-spec | implement-revise | verify",
  "task": "...",
  "rounds": { "planReview": 0, "codeReview": 0 },
  "work": "active | blocked",
  "blockReason": null
}
```

主代理在 `orchestrating` 只编排、派发、汇报，不能直接写代码/文档。

### 4. 命令

```text
/gate-plan <工作项>
/gate-implement <工作项>
/gate-docs <范围>
/gate-status
/gate-return
```

- 命令 handler 直接写状态并注入编排协议；
- 进入前检查工作项：proposed Note，或 implement 允许 `mechanical:`；
- review/verify 不是用户命令，由主代理按协议推进。

### 5. 主代理派发协议

`/gate-plan`：

```text
1. 派 gate-planning；
2. 派 gate-plan-review；
3. 调 gate_record 记录 findings/requiresDiscussion；
4. 可内部修正：派 gate-planning 修订，再 review；
5. 需要用户决定：/gate-return → discuss；
6. 无发现：discuss。
```

`/gate-implement`：

```text
1. 派 gate-implement；
2. 派 gate-code-review-standards；
3. 派 gate-code-review-spec；
4. 调 gate_record 记录两轴 findings/requiresDiscussion；
5. 可内部修正：派 gate-implement 修订，再复审；
6. 需要用户决定：/gate-return → discuss；
7. 无发现：派 gate-verify；
8. verify PASS：complete；FAIL：回 implement-revise。
```

所有 worker prompt 必须包含对应技能正文、输入、输出契约、轮次；主代理不得让 worker 自己再派 worker。

### 6. Review 结果分类与状态

review worker 输出：

```json
{
  "ok": true,
  "findings": [{"axis":"...","owner":"planning|implement|user","summary":"...","evidence":"..."}],
  "requiresDiscussion": false,
  "discussionReason": null
}
```

`requiresDiscussion=true` 或 findings 的 owner 是 user 时：

- 主代理必须先 `/gate-return`；
- Gate 设 `phase=discuss`、`blockReason=needs-user-decision`；
- 不允许继续派 worker 或写文件；
- 讨论完成后重新授权。

可内部修正的 findings：

- owner=planning/implement；
- 在已接受合同内；
- 由主代理派 revise worker；
- 每次 review 轮次 +1。

### 7. `gate_record`

新增 Gate 工具：

```text
gate_record({
  node: 'plan-review' | 'code-review-standards' | 'code-review-spec',
  findings: [],
  requiresDiscussion: boolean,
  discussionReason?: string
})
```

行为：

- `requiresDiscussion=true`：`phase=discuss`，记录 blockReason；
- false：轮次 +1，返回下一节点；
- 轮次达到 5 且有 findings：`work=blocked`，`blockReason=*-review-rounds-exhausted`；
- 没有记录不能进入下一节点。

### 8. 5 轮语义

- 主代理和 worker prompt 都显示 `round: n/5`；
- Gate 持久化计数；
- 第 5 轮仍有实质 findings：blocked，不得 complete；
- 达到上限不是通过。

### 9. 子代理写权限

主代理派发 worker 时，Gate 需要让 worker 获得对应写权限，但不继承主代理的 `orchestrating` 禁写：

- worker 派发前/启动时登记 child session；
- plan/revise：允许 proposed Note；
- review：只读；
- implement/revise：允许代码；
- verify：只读/收据；
- 结束后清理 child state；
- 具体用 `subagent/start` 事件或 Gate worker 登记接口实现，不在规划阶段假定。

### 10. planning 与 write-agent-notes

`gate-planning` 负责：

- 工作项（proposed Agent Note）；
- 产品合同、技术设计、决定；
- 接收主代理转交的 review findings，决定并修正；
- 交回 Note 路径、决定摘要、未决项。

`write-agent-notes` 负责：

- Note 位置、分类、格式、生命周期；
- 新旧 Note 的更新/取代/归档；
- `verify-notes` 校验。

Gate 派 planning worker 时注入 `write-agent-notes` 正文；不复制到插件。取不到就失败。

planning 不建独立 Spec；产品合同由工作项拥有，技术设计归 Agent Note。

### 11. 技能拆分

- `gate-planning`：原 planning §1/§2/决定权限/修正 + 原 review.md 的“决定与修正”；
- `gate-plan-review`：原 review.md 的三轴、合同/设计检查、评审标准；只报告；
- `gate-implement`：原 implement §1-3、findings 归属表、receipt；
- `gate-code-review-standards`：原 code-review 固定点、标准来源、smell baseline；
- `gate-code-review-spec`：原 code-review 固定点、验收合同识别；
- `gate-verify`：原 verify 验收/证据/失败诊断；只报告。

### 非目标

- 不做子代理再派子代理；
- 不修改 `.agents/skills`；
- 不修改旧 `implement-gate`；
- 不做旧数据迁移；
- 不把编排顺序写进技能正文。

## Alternatives considered

**Gate 直接派 worker。** 最强理由是自动化；与用户确认的主代理派发流程冲突，故改为 Gate 只做协议与门禁。

**review findings 一律自动 revise。** 最强理由是流程快；需要用户决定的事会被错误地在 implement 状态下继续，故必须分类并回 discuss。

**复制 write-agent-notes 到插件。** 最强理由是 worker 自包含；会产生第二套生命周期规则，故由 Gate 注入。

**保留独立 Spec。** 最强理由是原技能支持；本项目已明确不使用独立 Spec，故插件 binding 不建 Spec。

## Acceptance criteria

1. `/gate-plan` 启动主代理编排，Gate 不直接派 worker；
2. plan-review findings 分类；需要用户决定时回 discuss，状态不再是 orchestrating；
3. `/gate-implement` 两轴 review 由主代理派发；findings 分类同上；
4. 5 轮计数与 blocked；达上限不通过；
5. verify FAIL 回 implement-revise；
6. worker prompt 含对应技能、轮次、输出契约；
7. planning 使用 write-agent-notes；不建独立 Spec；
8. review worker 只报告，planning/implement 决定与修正；
9. child 写权限正确，worker 不嵌套；
10. 切换后删除旧插件、旧 marker、旧 state。

## Plan Review

- Standards：主代理编排、Gate 门禁、技能方法分离；与 GATES 一致。
- Spec：状态、findings 分类、轮次、verify、切换均可观察。
- Architecture：主代理派发，Gate 记录；review 两轴直接派；planning 使用 Note 生命周期。
- 结论：通过，进入实施需 implement 授权；建议分阶段交付。

## Risks

- 主代理派发与 child 写权限需要 DSH subagent 事件/登记接口验证；
- `requiresDiscussion` 依赖 worker 输出质量；
- Gate 不能强制主代理不跳过 `gate_record`，需要 pre-execute 阻断未记录的下一节点；
- 这是大改，必须分批实现与真实回执。
