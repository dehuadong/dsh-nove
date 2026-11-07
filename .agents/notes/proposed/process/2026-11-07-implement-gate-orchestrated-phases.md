# Agent Note: implement-gate：宿主编排的阶段 worker

Status: proposed

工作项：把 planning/implement 从“主代理按文档执行”改为 Gate 派发阶段 worker；补齐 Plan Review、Implementation Review、Verify 与 5 轮收敛。

## Problem

当前/已规划的 `/gate-*` 命令只把 phase 写给主代理，技能正文注入主 session：

- 子代理有独立 system prompt，不继承主代理注入的技能；
- 主代理仍可能自己写代码或文档，不是真正编排；
- `planning` 技能把 Plan Review 混在工作方法里，无法独立派发；
- `implement` 链路缺 verify；
- 审查轮次、子代理 Gate state、技能对应关系都没有宿主约束。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `.agents/skills/planning/SKILL.md` §3 | Plan Review 混在 planning 内，读完 review.md 后自己评审 | 拆为 `planning` 作者 + `plan-review` 独立评审 worker |
| `.agents/skills/planning/review.md` | 三条评审线：Standards/Spec/Architecture；发现回到属主修正 | `plan-review` worker 拥有 review.md，Gate 记录轮次 |
| `.agents/skills/implement/SKILL.md` §4 | 实现后用 `code-review`，发现回 §3 修正并复审 | Gate 派 `code-review` worker；发现回 implement worker |
| `.agents/skills/code-review/SKILL.md` | Standards/Spec 两轴并行子代理 | review worker 按 skill 派两轴；每个子代理 prompt 带对应技能正文 |
| `docs/agents/GATES.md` 审查收敛 | Plan Review / Implementation Review 各最多 5 轮；达上限不等于通过 | Gate state 计数；5 轮未解决则停止并报告，不 complete |
| `.agents/skills/verify/SKILL.md` | 最终验收与记录 | `implement` 链路补 verify worker，complete 只在 verify PASS 后 |

## Proposal

### 1. 命令只做入口

```text
/gate-plan <工作项>
/gate-implement <工作项>
/gate-docs <范围>
/gate-status
/gate-return
```

review/verify 不是用户命令，由 Gate 自动推进。

### 2. Gate 状态

```json
{
  "phase": "orchestrating | docs | discuss | complete",
  "node": "plan | plan-review | plan-revise | implement | code-review | implement-revise | verify",
  "task": "...",
  "rounds": { "planReview": 1, "codeReview": 0 },
  "worker": { "childId": "...", "status": "running | done | failed" }
}
```

主代理处于 `orchestrating`：**不允许写代码或文档**，只汇报状态、接收 worker 回执。

### 3. 节点与技能对应

| 节点 | worker 技能 | 写权限 | 产出 |
|---|---|---|---|
| `plan` | `planning` | proposed Note/工作项 | 规划工件 |
| `plan-review` | `plan-review` | 只读 | 三轴发现 |
| `plan-revise` | `planning` | proposed Note/工作项 | 修正后规划 |
| `implement` | `implement` | 代码 | 改动与测试 |
| `code-review` | `code-review` | 只读 | 两轴发现 |
| `implement-revise` | `implement` | 代码 | 修正 |
| `verify` | `verify` | 只读/收据 | PASS/FAIL 与证据 |

每个 worker prompt 必须自包含：

```text
node / task / workspace
skill: <对应技能正文>
inputs: 工作项、Note、Spec、diff 基线
output contract: 文件路径或结构化发现
round: n/5
constraints: 写权限、禁止范围
```

不依赖 worker“碰巧读技能文件”。

### 4. 流程

Plan：

```text
/gate-plan
→ plan worker
→ plan-review worker
→ 有实质发现：plan-revise worker（最多 5 轮）
→ 无发现：回到 discuss
```

Implement：

```text
/gate-implement
→ implement worker
→ code-review worker
→ 有实质发现：implement-revise worker（最多 5 轮）
→ 无发现：verify worker
→ verify PASS：complete
→ verify FAIL：回 implement-revise
```

### 5. 技能拆分

- `planning` 删除 §3 Plan Review，只保留工作项/合同/设计形成；
- 新建 `plan-review` 技能，拥有原 `review.md` 的三轴与通过条件；
- `implement` §4 改为“交由 Gate 派 code-review worker”，不自己在实现 worker 内评审；
- `code-review` 保留两轴并行，但由 Gate 注入到 review worker；
- `verify` 作为独立节点，不混入 implement。

### 6. 5 轮收敛

- Gate 每次启动 review worker 时 `rounds.<kind> += 1`；
- 每轮发现非空则启动 revise worker；
- 达到 5 轮仍有实质发现：停止，状态 `blocked`，报告未解决问题；
- 达上限不得视为通过，不得 `complete`；
- 轮次计数持久化，跨 turn 不丢。

### 7. 子代理 Gate state

- Gate 用 `ctx.subagents.startActivation` 派 worker；
- 派发前为 childId 预写对应写权限的 state（planning/implement/review/verify）；
- 主代理状态 `orchestrating` 禁止写；
- worker 结束清理 child state；
- 失败/取消也要清理，避免残留授权。

### 8. 失败与取消

- worker 失败：gate 记录 failed，不自动重试；报告原因；
- 用户 `/gate-return`：取消当前 worker，回 discuss；
- 不允许主代理接管 worker 失败范围。

## Alternatives considered

**主代理自己执行，Gate 只提示。** 最强理由是简单；无法保证技能加载、review 独立性和写权限，故不采用。

**只拆 plan-review，不拆 verify。** 最强理由是减少节点；implement 缺 verify 会重演当前问题，故补 verify。

**review worker 再派所有子代理，Gate 不直派。** 最强理由是贴合 code-review 方法；会多一层 child state 与技能对应，故 Gate 只派一级 worker，worker 按技能方法派轴子代理时必须携带对应方法正文。

**把 5 轮上限写进技能。** 最强理由是文档可见；技能无法持久计数，故由 Gate state 执行。

## Acceptance criteria

1. `/gate-plan` 只启动 orchestrating，主代理不能写；
2. plan worker 使用 planning 技能正文，产出 proposed Note；
3. plan-review worker 独立三轴评审；发现回 plan-revise；最多 5 轮；
4. `/gate-implement` 启动 implement worker；code-review 独立；发现回 implement-revise；最多 5 轮；
5. verify worker 通过后才 complete；verify FAIL 回修正；
6. 每个 worker 的 prompt 含对应技能正文与输出契约；
7. child Gate state 预写/清理，worker 可写范围正确；
8. 主代理只汇报，不直接写代码/文档；
9. 测试覆盖节点、轮次上限、失败、取消、技能注入。

## Plan Review

- Standards：Gate 拥有编排、计数、子代理状态；技能只拥有方法；与 GATES 5 轮规则一致。
- Spec：节点、写权限、轮次、complete 条件都可观察。
- Architecture：Gate 派一级 worker；worker 按 code-review 方法派轴子代理；child state 预写。
- 结论：通过，进入实施需 implement 授权；建议分阶段交付（命令/状态 → planning 拆分 → implement/code-review/verify → 5 轮与 child state）。

## Risks

- `startActivation` 是异步派发，命令 handler 不应阻塞整轮；需异步编排与完成通知；
- 预写 child state 的 hash 必须与 Gate state 文件一致；
- 子代理结果不自动落库，worker 输出契约必须要求文件/结构化结果；
- 嵌套 code-review 子代理不共享 child state，必须只读；
- 这是大改，建议拆成多个 implement 批次，不能一次伪装成“完成”。
