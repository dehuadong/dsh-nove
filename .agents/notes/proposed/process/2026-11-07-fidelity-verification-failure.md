# Agent Note: 故事工坊：复审冻结与证据重建

Status: proposed

## Problem

2026-11-07 对 `docs/fidelity-audit.md` 的 25 个 `verified` 工作项做了回审：Plan Review 全部 `needs_changes`，`foundation.approval`、`chapter.finalize` 的 Plan Review 为 `fail`，`state.check` 的 code review 为 `fail`。问题不是“代码全部不存在”，而是记录把“有代码/单测绿”当成了“源行为已验证”：

- 只有 docs/ledger 变更的 commit 被当作测试交付：`chapter.summary`、`chapter.reopen`、`chapter.finalize` 的“test” commit 没有改实现或 consumer。
- 真实回执来自旧代码或旧会话：`runtime.load`、`runtime.telemetry`、`foundation.architect` 的 session 早于后续修复，部分 sessionId 在 DSH session 存储中不存在。
- 审计行把未偿还差异写成等价：`artifact.identity` 的文件落盘 vs SQLite、`workspace.single-form` 的自创单形态限制、`chapter.settle` 的缺失字段、`foundation.architect` 的单 tool schema 债。
- 源证据引错文件或字段：`chapter.summary` 的 `bodyRevision` 在源 `input-governance.ts` 不存在；`chapter.finalize` 引用的 `writer.ts:600-650` 不是 finalize。
- consumer 不覆盖声明：`chapter.review` 的 consumer 只测 `writeReview`，删掉 fail-open 仍绿；`chapter.write` 用无 Markdown 的正文，测不到双计数。
- checker 只检查路径/字段存在：`check-fidelity-audit.mjs` 对 `docs/dsh-mapping.md` 只做子串匹配，不验证条目存在；`check-capabilities.mjs` 不验证回执来自当前树。
- 真实 bug 被状态掩盖：`state.check` 增加了回执字段，但 `STATE_CHECK_OUTPUT` 仍 `additionalProperties:false`，真实工具调用会 `INVALID_TOOL_OUTPUT`。

这些是记录与验收失败，不等于所有实现都是伪造；但 25 个 `verified` 都不能继续作为完成证据。

## Proposal

### 冻结

- 25 个 `verified` 全部改为 `missing`；不再用 `verified` 表示“代码存在”。
- `docs/fidelity-audit.md` 的 25 行改为 `保真债`，债列指向本 Note 与逐项重验；具体实现/consumer/回执保留，等重验后再改回等价。
- 不做代码修复；本 Note 只建立冻结与重建规则。

### 记录

- 能力状态只由 `capabilities.yaml` 拥有；审计表只记录源证据、不变量、复刻现状、裁决与债，不新增“复审状态”列。
- 真实回执必须补 `testedCommit`、实际 consumer 路径与可重跑命令；旧回执保留为历史，不覆盖、不再作为当前证据。
- checker 后续必须验证：`testedCommit` 是 HEAD 祖先；从 `testedCommit` 到 HEAD，该能力的 implementation/consumer 未变化；审计债指向的 dsh-mapping/capability 条目真实存在。
- 每项重验通过后，才由 `check-capabilities --write` 单独置回 `verified`，一次一个能力。

### 逐项处置分类

1. **实现 bug，先修**：`state.check` 的 output schema；`chapter.review` 的 fail-open 范围；`chapter.write` 的 delegated 字数；`chapter.revise` 的 `wordRange` 与默认 mode。
2. **记录错，重取证据**：`runtime.load`、`runtime.telemetry`、`foundation.architect`、`context.retrieval`、`chapter.summary`、`chapter.reopen`、`chapter.finalize`。
3. **自创行为，删除或登记偏差**：`workspace.single-form`（源允许一个 workspace 多 profile）、`foundation.approval`（源无 foundation approval）、`chapter.finalize`（源无 draft/settled 闸门）。
4. **债，写偿还路径**：`chapter.move-delete` 的 `.trash`/快照、`chapter.settle` 的 postSettlement/chapterSummary、`context.brief` 的语义压缩、`chapter.revise` 的 spot-fix 范围替换、`artifact.identity` 的存储差异。

### 处置顺序

1. 冻结与记录（本 Note）。
2. 修 `state.check` 等会直接失败的实现 bug。
3. 重验底层：`runtime.load`、workspace、session-binding、commands、artifact.identity。
4. 重验章节链：write → review → revise → summary → settle → finalize → reopen → move-delete。
5. 重验状态/面板：state.check、panel.workbench。
6. 每项按 Plan Review → code review → verify 的顺序重做；通过一个升一个。

## Alternatives considered

**保留 verified，只加债。** 最强理由是代码确实存在、部分测试通过；但 `verified` 的证据合同已被破坏，保留会让后续工作继续引用假完成，故全部降为 missing。
**全部重写。** 最强理由是一次性清掉所有可疑实现；多数代码是真实资产，重写会丢掉已通过的局部行为，故按能力分类修复。
**新建复审状态表。** 最强理由是能一眼看到 25 项进度；项目铁律禁止第二套状态表，故只用 capabilities 状态 + 审计债 + 本 Note 的处置分类。

## Acceptance criteria

1. `capabilities.yaml` 的 25 个 `verified` 全部为 `missing`；
2. `docs/fidelity-audit.md` 的 25 行不再写 `等价`/`机制等价`，债列非空并指向逐项重验；
3. 本 Note 记录失败模式、分类与处置顺序；
4. 旧回执不被删除、不被当作当前证据；
5. 后续每次重验只在当前 `testedCommit` 上产生新证据；
6. 重验通过一个能力，才升一个 `verified`。

## Risks

- 冻结会让当前 CI 的 verified 数降为 0，短期看起来“全部未完成”；
- 逐项重验成本高，容易再次用旧回执走捷径；
- 部分自创行为需要作者裁决（例如 workspace 单形态是否保留），不能由代理自行决定；
- `state.check` 等真实 bug 不先修，重验会继续失败。
