# Agent Note: 故事工坊：chapter.reopen 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.reopen`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计初查没有找到字面 `reopen`；进一步查源工程的作者编辑路径后发现：

- `interaction/edit-controller.ts` 支持 `chapter-replace` / `chapter-local-edit`，对已定稿章节也应可用；
- `executeChapterReplace` 会归档旧版本、写入新正文、清除该章 runtime 文件、记录 manual edit observation；
- 它不会删除后续章节；删除后续章节的是 `state/manager.ts:612` 的 `rollbackToChapter`，那是另一种操作。

所以“重开单章”应定义为：**把已定稿章节解锁为可编辑/可再审状态，保留正文与后续章节；不是重写或润色本身，也不删除后续章。**

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/interaction/edit-controller.ts:18-35` | 作者可发 chapter-rewrite/chapter-replace/chapter-local-edit | 复刻 reopen 作为编辑前置解锁 |
| `edit-controller.ts:338-375` | replace 归档旧版、写新正文、清 runtime 文件、记录 observation；不删后续章 | 复刻 reopen 清状态草稿、回 written；随后 revise/rewrite |
| `state/manager.ts:612-660` | rollbackToChapter 回滚并删除后续章 | 不复用为 reopen；语义不同 |

审计：源行为可观测；reopen 是机制等价的编辑解锁，不是源不可观测。

## Proposal

### 定义

**重开单章** = 将已定稿章节解锁为可编辑/可再审状态，保留正文、历史版本与后续章节；它不是重写或润色本身，也不删除后续章。

### 机制等价

- 源工程作者编辑路径：`chapter-replace` / `chapter-local-edit` 直接改已定稿正文，归档旧版、清 runtime、记录 manual edit observation；
- 复刻路径：`reopenChapter` 先解锁（写 reopen 事件、回 written、清状态草稿），再由 revise/rewrite 写新正文；
- 两者都不删除后续章；`rollbackToChapter` 是另一操作，不纳入本能力；
- 在 `docs/dsh-mapping.md` 增加“章节重开”机制等价行：
  - 源：作者编辑动作直接改定稿章节；
  - 复刻：reopen 解锁 + revise/rewrite；
  - 原因：DSH 动作拆分（编辑前需显式解锁），行为等价；
  - 验证：`reopen-target.test.mjs` + 真实回执。

### 范围

- 不改 `reopenChapter` 行为；
- 能力 reference 改为 `interaction/edit-controller.ts`；
- audit verdict 改为 `机制等价` 并链接 dsh-mapping；
- consumer 保持 `reopen-target.test.mjs`；
- 真实回执：settled → reopen → nextStep 回该章 → 重新结算。

### 失败行为

- 未定稿 → `not-settled`；
- 不存在章节 → `chapter-not-found`；
- reopen 保留正文版本，不删除事件；
- 不删除后续章。

## Alternatives considered

**把 reopen 当源不可观测。** 最强理由是字面没有 reopen；源作者编辑路径实际支持改定稿章节，故不采用。
**实现 rollbackToChapter 替代。** 最强理由是源有该行为；它会删除后续章，与重开定义不同，故不做替代。
**删除能力。** 最强理由是避免自创；源作者编辑路径支持解锁编辑，故保留并登记机制等价。

## Acceptance criteria

1. 审计表 verdict 改为机制等价并链接 dsh-mapping；
2. dsh-mapping 有“章节重开”四段行；
3. reopen 行为测试仍通过；
4. 真实回执：settled → reopen → nextStep 回该章 → 重新结算；
5. 不删除后续章；
6. `check-capabilities --write` 后置 verified。

## Plan Review

- Standards：源作者编辑路径可观测；reopen 是机制等价，不伪造不可观测。
- Spec：定义、机制差异、dsh-mapping、真实回执都可观察。
- Architecture：reopen 是解锁步骤；rollbackToChapter 是另一能力，不混入。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 源编辑动作与 reopen+revise 的步骤数不同，需在 dsh-mapping 说明机制等价；
- 真实回执需要 settled 章节与后续章，fixture 要准备；
- 不能把 rollbackToChapter 的删除后续章混入 reopen。
