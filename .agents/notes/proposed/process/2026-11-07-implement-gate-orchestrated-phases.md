# Agent Note: gate-plugin-replacement：新 Gate 插件与阶段 worker

Status: proposed

工作项：新建完整 Gate 插件，替代现有 `implement-gate`；由 Gate 派发阶段 worker，插件内管理技能，旧插件冻结到切换后移除。

## Problem

现有 `implement-gate`：

- 只有写权限门禁，没有阶段 worker 编排；
- 文档/命令仍是语义要求，模型可以不加载技能；
- 规划把 Plan Review 混在 planning 内，无法独立派发；
- implement 链路缺 verify；
- 审查轮次、子代理写权限、技能对应关系没有宿主约束。

不能在旧插件上继续加：旧插件冻结，新插件完整替代，避免新旧双门禁。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `.agents/skills/planning/SKILL.md` | 形成工作项，做技术决定，按 review 发现修正 | 新插件 `gate-planning` 拥有形成、决定、修正 |
| `.agents/skills/planning/review.md` | Standards/Spec/Architecture 三轴；决定与修正回属主 | `gate-plan-review` 只报告；发现回 `gate-planning` |
| `.agents/skills/implement/SKILL.md` §4 | 实现后用 code-review，发现回实现修正 | Gate 派 `gate-implement`，再派两轴 review |
| `.agents/skills/code-review/SKILL.md` | Standards/Spec 两轴并行 | Gate 直接派两个轴 worker，不做嵌套派发 |
| `.agents/skills/verify/SKILL.md` | 最终验收与记录 | Gate 增加 verify 节点，PASS 后才 complete |
| `docs/agents/GATES.md` | Plan/Implementation Review 各最多 5 轮；上限不等于通过 | Gate 持久化轮次；5 轮未解决则 blocked |
| `tools/implement-gate/` | 代码/文档写权限、phase、state、marker | 新插件完整复刻并扩展；旧插件不改，切换后移除 |

## Proposal

### 1. 新插件

```text
tools/gate/
  package.json
  index.js
  commands.js
  state.js
  dispatch.js
  classify.js
  skills/
    gate-planning/SKILL.md
    gate-plan-review/SKILL.md
    gate-implement/SKILL.md
    gate-code-review-standards/SKILL.md
    gate-code-review-spec/SKILL.md
    gate-verify/SKILL.md
  cordis.patch.yml
  tests/
```

- 包名：`@dsh-nove/gate`；
- 不修改 `.agents/skills`；
- 不修改 `tools/implement-gate`；
- 新旧不同时启用；
- 开发期使用临时 `DSH_HOME`，不装进当前 profile。

### 2. 完整 Gate 能力

新插件自己拥有：

- marker：`.agents/gate.json`（新文件，不复用旧 marker）；
- `codeExtensions`、`codePaths`、`protected`；
- `discuss / orchestrating / docs / complete` 主状态；
- pre-execute 写权限；
- state 持久化；
- proposed/mechanical 工作项检查；
- `end-docs`、`return-to-discuss`、`complete`；
- 人类可读 status。

旧 `.agents/implement-gate.json` 在切换前继续由旧插件使用；切换时新建 `.agents/gate.json`，停用旧插件，删除旧 marker 与旧 state。

### 3. 命令

```text
/gate-plan <工作项>
/gate-implement <工作项>
/gate-docs <范围>
/gate-status
/gate-return
```

- `/gate-plan`、`/gate-implement`、`/gate-docs` 由插件 handler 直接写状态并启动编排；
- 不再解析“批准，使用技能 ...”语义口令；
- review/verify 由 Gate 自动推进，不是用户命令；
- status 只输出事实，不给固定下一步命令。

### 4. 插件专项技能

新插件注册自己的 skills provider，读取 `tools/gate/skills/`：

- `gate-planning`：形成工作项、决定、修正；
- `gate-plan-review`：三轴评审，只报告；
- `gate-implement`：实现与实现内测试；
- `gate-code-review-standards` / `gate-code-review-spec`：两轴；
- `gate-verify`：验收。

每轮 worker prompt 自带对应技能正文、输入路径、输出契约、轮次与写权限；worker 不依赖 `.agents/skills`。

### 5. 状态

```json
{
  "phase": "orchestrating | docs | discuss | complete",
  "node": "plan | plan-review | plan-revise | implement | code-review | implement-revise | verify",
  "task": "...",
  "rounds": { "planReview": 1, "codeReview": 0 },
  "worker": { "childId": "...", "status": "running | done | failed" }
}
```

主代理 `orchestrating` 状态禁止写代码与文档，只汇报和接收回执。

### 6. 不做嵌套 worker

Gate 直接派：

```text
planning
plan-review
planning-revise
implement
code-review-standards
code-review-spec
implement-revise
verify
```

`code-review` 两轴不再由 review worker 再派；Gate 直接启动两个只读 worker。

### 7. 流程

```text
/gate-plan
→ planning
→ plan-review
→ 有实质发现：planning-revise → plan-review（最多 5 轮）
→ 无发现：discuss

/gate-implement
→ implement
→ code-review-standards + code-review-spec
→ 有实质发现：implement-revise → 复审（最多 5 轮）
→ 无发现：verify
→ PASS：complete
→ FAIL：implement-revise
```

### 8. 5 轮收敛

- 每次启动 review 节点 `rounds.<kind> += 1`；
- 每轮有实质发现才启动 revise；
- 达到 5 轮仍有实质发现：`blocked`，报告未解决项；
- 达上限不得通过，不得 complete；
- 计数持久化，跨 turn 不丢。

### 9. 子代理写权限

- Gate 用 `ctx.subagents.startActivation` 派 worker；
- 派发前为 childId 预写对应 phase 的 state；
- planning worker 允许 proposed Note；review 只读；implement 允许代码；verify 只读/收据；
- worker 结束清理 child state；
- 子代理不再派子代理。

### 10. 切换与移除

1. 新插件在临时 `DSH_HOME` 完成 parity + orchestration 测试；
2. 当前项目作者创建 `.agents/gate.json`；
3. 安装/启用新插件，停用旧 `implement-gate`；
4. 确认新命令、写权限、状态、worker 正常；
5. 删除旧插件源码、旧 marker、旧 state；
6. 不保留双读或兼容层。

### 非目标

- 不修改 `.agents/skills`；
- 不修改旧 `implement-gate`；
- 不做子代理再派子代理；
- 不做旧数据迁移；新 marker/state 从空开始；
- 不把 5 轮上限写进技能正文代替 Gate 计数。

## Alternatives considered

**在旧 implement-gate 上加编排。** 最强理由是复用现有门禁；用户要求先不动旧插件并最终替换，故新建完整插件。

**新插件只做编排，旧插件继续做门禁。** 最强理由是避免重写权限逻辑；用户明确要替换，且双插件会有状态/权限耦合，故不采用。

**保留嵌套 code-review worker。** 最强理由是贴合原技能；用户明确不做子代理再派子代理，故 Gate 直派两轴。

**复用旧 marker 平滑过渡。** 最强理由是配置不丢；新旧会同时识别同一 marker，无法安全并行，故新 marker、切换时删除旧配置。

## Acceptance criteria

1. 新插件独立安装，不修改旧插件与 `.agents/skills`；
2. `/gate-plan` 启动 planning worker，主代理不可写；
3. plan-review 独立三轴；发现回 planning-revise；最多 5 轮；
4. `/gate-implement` 启动 implement worker；两轴 review 直派；发现回 implement-revise；最多 5 轮；
5. verify PASS 才 complete；FAIL 回修正；
6. 每个 worker prompt 含对应插件技能正文与输出契约；
7. child state 预写/清理，写权限正确；
8. 5 轮上限 blocked，不通过；
9. 旧插件冻结；切换后删除旧插件、旧 marker、旧 state；
10. 临时环境测试与真实回执齐全。

## Plan Review

- Standards：新插件完整替代，不做双门禁；技能插件专项，不改全局 Skill；planning 保留决定/修正。
- Spec：命令、节点、写权限、5 轮、verify、切换步骤都可观察。
- Architecture：Gate 一级派发，无嵌套；child state 预写；插件 skills provider。
- 结论：通过，进入实施需 implement 授权；建议分阶段交付，不能一次伪装完成。

## Risks

- `startActivation` 异步与命令 turn 生命周期：handler 不能长时间阻塞，需要编排任务记录；
- child state hash 必须与新插件 state 实现一致；
- 插件 skills provider 与全局 skill 同名冲突，必须用 `gate-` 前缀；
- 新 marker 与旧 marker 共存期要确保新插件未启用；
- 大改需分批实现与真实回执，不能只靠单元测试。
