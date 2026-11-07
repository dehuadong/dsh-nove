# Agent Note: 故事工坊：chapter.reopen 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.reopen`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

“重开单章”曾与源工程 `rollbackToChapter` 混淆。定义应是：把已定稿章节解锁为可编辑/可再审状态，保留正文、历史版本与后续章节；不是重写或润色本身，也不删除后续章。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/interaction/edit-controller.ts:18-35` | 作者可发 chapter-rewrite/chapter-replace/chapter-local-edit | 复刻 reopen 作为编辑前置解锁，随后 revise/rewrite |
| `edit-controller.ts:338-375` | replace 归档旧版、写新正文、清 runtime、记录 observation；不删后续章 | 复刻 reopen 清状态草稿、回 written；后续章保留 |
| `state/manager.ts:612-660` | rollbackToChapter 回滚并删除后续章 | 另一操作，不混入 reopen |

审计：`chapter.reopen` 判定机制等价，并链接 `docs/dsh-mapping.md` 的“章节重开”。

## Decision

- 保留 `reopenChapter`：未定稿拒绝；写 reopen 事件；stage/status 回 written；清状态草稿；保留正文版本与后续章；
- 源作者直接编辑定稿章，复刻拆成 reopen + revise/rewrite，属于机制等价；
- `docs/dsh-mapping.md` 记录源/复刻/原因/验证；
- consumer 保持 `reopen-target.test.mjs`。

## Alternatives considered

- **把 reopen 当源不可观测。** 最强理由是字面没有 reopen；源编辑路径支持改定稿章，故不采用。
- **用 rollbackToChapter 替代。** 最强理由是源有该行为；它会删后续章，与定义不同，故不替代。
- **删除能力。** 最强理由是避免自创；源编辑路径支持解锁编辑，故保留。

## Consequences

- **收益**：重开语义明确；不删除后续章；真实回执显示正文版本保留、后续章仍在、nextStep 回该章。
- **代价**：reopen 与编辑拆成两步，dsh-mapping 已登记机制等价。
- **边界**：不做 rollbackToChapter；不做正文改写本身。

## Verification

```text
node storycraft/tests/reopen-target.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e        # PASS: 105 unit files
npm run verify                                 # 23 verified / 17 missing
```

真实 fixture `定稿回执`：第 1 章 settled → written，revision 1 保留；第 2 章仍在 written；nextStep 回到第 1 章 review。

回执：`artifacts/real-runs/chapter.reopen.json`。
