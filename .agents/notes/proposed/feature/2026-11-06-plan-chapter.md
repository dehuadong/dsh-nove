# Agent Note: 故事工坊：plan.chapter 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `plan.chapter`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

章纲需要：

- 五字段（视角/目标/阻力/代价/结尾变化）+ body + threadRefs；
- 写 `plan:<n>` 工件，首次章纲由 planner 写，重写走主会话；
- 未确认前 `story_write` 阻塞，确认绑定 revision；
- 读取/审批/闸门必须拿 **current** revision，而不是 rowid 最后一行。

当前 `writePlan`/`approveChapterPlan` 已有五字段与 revision 绑定，`memo-consumers` 覆盖未确认阻塞；但 `artifactRevisionOf` 仍按 rowid 取最新，artifact 表已有 current/superseded 后，可能把 superseded 当成当前。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/planner.ts:22-60` | planner 输出 intent + memo，章号 identity 固定 | 复刻 `plan:<n>` 固定 artifactId，内容保存五字段与 body |
| `inkos-master/packages/core/src/agents/planner-tool.ts` / `ChapterMemoSchema` | memo 是结构化章纲，threadRefs 指向伏笔 | 复刻 `writePlan` 校验 threadRefs 为字符串数组 |
| `inkos-master/packages/core/src/models/input-governance.ts` 的 ChapterMemo | memo 有 chapter identity，不能跨章 | 复刻 `plan:<n>` typed identity 与 `assertArtifactIdentity` |

## Proposal

### 范围

- 审计 `writePlan`：
  - 五字段非空；
  - body 非空；
  - threadRefs 字符串数组；
  - `plan:<n>` 首次/重写规则；
- 审计 `approveChapterPlan`：
  - 只确认 current revision；
  - 记录 source/reason/revision；
- 修正共享读取：
  - `artifactRevisionOf` / `latestSummaryContent` / `readPlan` 优先 `status='current'`，旧库无 status 时回退 rowid；
- 消费者测试覆盖：
  - 未确认阻塞；
  - 确认绑定 revision；
  - 重写章纲后确认失效；
  - superseded revision 不会被当成 current；
  - threadRefs 非法拒绝。

### 非目标

- 不做正文写入（`chapter.write`）；
- 不做 revise/review；
- 不迁移旧作品。

### 失败行为

- 五字段缺失/空 → `plan-incomplete`；
- body 空 → `plan-incomplete`；
- threadRefs 非数组 → `plan-incomplete`；
- 未确认写正文 → `plan-not-approved`；
- 重写后旧确认不匹配 → 再次阻塞。

## Alternatives considered

**只看 rowid 最后一行。** 最强理由是简单；artifact identity 已有 current/superseded，rowid 不代表 current，故不采用。

**章纲不存 threadRefs。** 最强理由是 memo 已够；源 memo 用 threadRefs 绑定伏笔，故保留。

**planner 允许重写已有章纲。** 最强理由是省一次派发；首次章纲由 planner、重写由主会话是现有边界，故不扩大。

## Acceptance criteria

1. 五字段、body、threadRefs 校验；
2. 未确认章纲时 `story_write` 阻塞 `plan-approval`；
3. 确认绑定 current revision；
4. 重写章纲后旧确认失效；
5. superseded revision 不会被读取为 current；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先修 current revision 读取，再补测试；不扩 planner 边界。
- Spec：五字段、确认、失效、current/superseded 都可观察。
- Architecture：章纲是 `plan:<n>` 工件，审批是 chapter 行；共享读取必须按 artifact identity。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 共享 `artifactRevisionOf` 被 outline/summary 等复用，改读取会影响多处，需要全量测试；
- 旧库没有 status，代码需回退 rowid，不能直接拒绝；
- 真实回执需要真实章纲确认，不能只用 fixture。
