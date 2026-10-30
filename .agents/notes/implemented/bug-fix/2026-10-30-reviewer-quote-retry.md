# Agent Note: reviewer 引文校验失败应自动带反馈重试一次

Status: implemented

## Problem

真实链路 #50 的第 1、2 章都出现：reviewer 子代理提交的 observation 中，`sourceRefs.quote` 不是当前正文的逐字子串，宿主以 `observation-source-unverified` 拒绝整批提交，父会话只能手动重新派发 reviewer。第 1 章重试两次后才成功；第 2 章在 r2 上再次失败，章节停在 `revised`，审稿没有落盘，后续摘要/结算/定稿全部阻塞。

这不是校验过严：引文必须可核对是审稿证据的合同。问题是失败没有反馈回路：父会话拿到的错误只有“第 N 条 observation 的引文不在正文中”，reviewer 下次仍可能重复同类错误。

## Decision

`story_delegate` 在 reviewer 落审稿时捕获 `observation-source-unverified`，自动带反馈重试一次：

- 第一次 `writeReview` 因引文不可核对失败时，不写任何 review；
- 用新的 delegationId 重新开一次提交通道，并把旧 prompt 里的 delegationId 替换成新的，追加“上次提交被拒绝”的反馈（第几条、哪条 sourceRef、逐字引文要求）；
- 重试成功才写 review、推进阶段，回执 `submissionAttempts` 为 2；
- 重试仍失败则返回 `observation-source-unverified`，不写 review、不改阶段；
- 只对该错误码、只对 reviewer 生效，其他失败不触发。

## 对拍参考

`inkos-master` 的审稿产物是 reviewer 输出的文本/结构化结论，没有“引文必须是当前正文逐字子串”的提交校验（`packages/core/src/agents`、`packages/core/src/pipeline/chapter-review.ts`）。本项属于我们的证据绑定合同，**无参考实现**；检索范围 `inkos-master/packages/core/src/agents`、`packages/core/src/pipeline`。裁决：保留校验，只补失败后的自动反馈重试。

## Alternatives considered

**A. 只改 reviewer 技能提示，要求逐字引文。** 最强的理由是不增加宿主逻辑与模型调用。否决原因：真实链路已按这条提示重试两次，第 2 章仍在 r2 上失败；提示无法保证模型遵守，失败后仍无反馈闭环。

**B. 放宽或跳过引文校验。** 最强的理由是彻底消灭这类失败、降低延迟。否决原因：引文是审稿证据可核对性的基础，放宽会让“证据不在正文”的审稿进入清稿流程，违背既有合同。

**C. reviewer 逐条提交 observation。** 最强的理由是失败粒度最小，只重试坏的那条。否决原因：提交协议与阶段机要支持部分审稿，改动远大于一次带反馈重试；本项先解决最常见的整批失败。

## Testing

`storycraft/tests/reviewer-retry.test.mjs` 覆盖：首次引文失败 → 自动重试一次且只落一份 review（`submissionAttempts=2`，重试 prompt 含拒绝反馈）；两次都失败 → 返回 `observation-source-unverified`、只派发两次、不写 review。全量 `node storycraft/scripts/ci.mjs` 为 81 单元 + 27 E2E。

## Consequences

- reviewer 的引文错误不再直接阻塞章节，父会话少写一轮手工重试；失败仍可观察，不会静默吞掉证据问题。
- 每次引文失败多一次 reviewer 子代理调用，延迟与成本上升；上限为一次，不无限重试。
- 重试逻辑只收窄到 `observation-source-unverified` 与 reviewer 角色，其他角色的失败处理保持原样。
