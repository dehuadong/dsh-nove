# Agent Note: 故事工坊：plan.chapter 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `plan.chapter`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

章纲是正文写作的闸门：`plan:<n>` 固定身份、五字段/body/threadRefs、未确认阻断正文、确认绑定 revision。审计发现共享读取仍按 rowid 取最新，可能把 superseded 章纲当 current。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/planner.ts:22-60` | planner 输出 intent + memo，章号 identity 固定 | 复刻 `plan:<n>` 固定 artifactId，内容保存五字段与 body |
| `inkos-master/packages/core/src/models/input-governance.ts` | ChapterMemo 有 chapter identity 与 threadRefs | 复刻 `writePlan` 校验五字段、body、threadRefs |
| `inkos-master/packages/core/src/harness/artifact-revisions.ts:14-110` | current/superseded revision 区分 | 复刻审批/读取必须取 current，不能取最新 rowid |

## Decision

- 章纲写入：
  - 五字段非空；
  - body 非空；
  - threadRefs 字符串数组；
  - `plan:<n>` 首次由 planner 写，重写由主会话；
- 确认：
  - `approveChapterPlan` 只绑定 current revision；
  - 未确认阻断正文；
- 共享读取修正：
  - `artifactRevisionOf` / `latestSummaryContent` / `reviewInputOf` / `approveChapterPlan` / `readManifest` 优先 `status='current'`，回退 rowid；
- 测试：
  - 插入一条更晚的 superseded 章纲，审批仍绑定 current；
  - 重写章纲使旧确认失效。

## Alternatives considered

- **继续按 rowid 取最新。** 最强理由是简单；artifact identity 已有 current/superseded，rowid 不代表 current，故不采用。
- **章纲不存 threadRefs。** 最强理由是 memo 已够；源 memo 用 threadRefs 绑定伏笔，故保留。
- **planner 允许重写已有章纲。** 最强理由是省一次派发；首次章纲由 planner、重写由主会话是现有边界，故不扩大。

## Consequences

- **收益**：章纲确认、读取、review binding 都按 current；superseded 不会覆盖 current；审批 revision 可信。
- **代价**：共享读取改动涉及 outline/summary/review，已跑全量测试。
- **边界**：不做正文写入/review/revise；这些是后续能力。

## Verification

```text
node storycraft/tests/memo-consumers.test.mjs   # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e          # PASS: 102 unit files
npm run verify                                   # 14 verified / 26 missing
```

真实 fixture `示例短篇`：第 1 章 `plan_revision=7f383bf6a357`，artifact status current，approval source panel。

回执：`artifacts/real-runs/plan.chapter.json`。
