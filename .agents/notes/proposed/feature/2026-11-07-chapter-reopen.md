# Agent Note: 故事工坊：chapter.reopen 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.reopen`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计发现源工程没有“重开单章”的可观测实现：

- `state/chapter-workspace.ts` 只定义版本 id；
- 全仓检索 `reopen` 只命中测试/CLI 文案；
- 最接近的是 `state/manager.ts:612` 的 `rollbackToChapter`：回滚到目标章并删除其后章节；
- `state/chapter-delete.ts` 只删除最新章。

当前 `reopenChapter` 写 reopen 事件、回 written、清草稿，是复刻侧自建行为。按保真原则，不能把它当等价。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/state/chapter-workspace.ts:1-20` | 只定义版本 id 格式 | reference 不证明 reopen |
| `state/manager.ts:612-660` | `rollbackToChapter` 回滚到目标章，删除其后章节 | 与“重开当前章、保留后续章”语义不同 |
| `state/chapter-delete.ts:28-60` | 删除最新章并保留 trash | 不是 reopen |

审计：`chapter.reopen` 判定保真债；源行为**不可观测**（检索范围：core/src、studio/src、cli/src 的 reopen/rollback/restore/revert）。

## Proposal

### 方案 A（推荐）：登记为“源行为不可观测”的合法偏差

- 在 `docs/dsh-mapping.md` 增加一行：
  - 源工程做法：未找到单章 reopen；`rollbackToChapter` 只做整段回滚；
  - 复刻做法：`reopenChapter` 写 reopen 事件、回 staged written、清状态草稿；
  - 原因：源行为不可观测（检索范围与结果如上）；
  - 验证：`reopen-target.test.mjs` + 真实回执；
- 能力标题改为“重开与回滚（DSH 扩展）”或保留但说明扩展；
- 审计表判定从“保真债”改为“机制等价（源不可观测）”，并链接 dsh-mapping。

### 方案 B：实现源 `rollbackToChapter`

- 回滚到目标章，删除其后章节，恢复到该章快照；
- 语义比 reopen 更重，且会丢弃后续章；
- 不适合作为 `chapter.reopen` 的替代；若要做，应是独立能力。

### 方案 C：删除 `chapter.reopen`

- 账本只追加不删除；当前产品已依赖 reopen 事件与测试；
- 删除会破坏现有流程，且无法证明源不支持作者重开；不采用。

### 范围（方案 A）

- 不改 `reopenChapter` 行为；
- 补 dsh-mapping 偏差行；
- consumer 保持 `reopen-target.test.mjs`；
- 真实回执：真实作品 settled → reopen → nextStep 回到该章 → 重新结算。

### 失败行为

- 未定稿 → `not-settled`；
- 不存在章节 → `chapter-not-found`；
- reopen 保留正文版本，不删除事件。

## Alternatives considered

**把 reopen 当等价。** 最强理由是测试通过；源无证据，故不采用。
**实现 rollbackToChapter 替代。** 最强理由是源有该行为；语义不同，故不做替代。
**删除能力。** 最强理由是避免自创；产品已依赖且无法证明源不支持，故保留为扩展。

## Acceptance criteria

1. dsh-mapping 有“源行为不可观测”偏差行，含检索范围；
2. 审计表 verdict 改为机制等价/不可观测，并链接 dsh-mapping；
3. reopen 行为测试仍通过；
4. 真实回执：settled → reopen → nextStep 回该章 → 重新结算；
5. `check-capabilities --write` 后置 verified。

## Plan Review

- Standards：源不可观测是合法偏差来源；不伪造等价，登记后再验证。
- Spec：偏差行、审计链接、reopen 流程、真实回执都可观察。
- Architecture：reopen 是 DSH 扩展；rollbackToChapter 不混入本能力。
- 结论：**需要作者裁决**：是否接受把 reopen 登记为源不可观测的扩展；接受后进入 implement。

## Risks

- 如果作者要求严格只做源行为，reopen 应删除或改为 rollback；
- dsh-mapping 偏差行不能写成“成本高”，只能写源不可观测与检索范围；
- 真实回执需要 settled 章节与后续章，fixture 要准备。
