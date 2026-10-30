# Agent Note: reviewer 引文校验失败应自动带反馈重试一次

Status: proposed

## Problem

真实链路 #50 的第 1、2 章都出现：reviewer 子代理提交的 observation 中，`sourceRefs.quote` 不是当前正文的逐字子串，宿主以 `observation-source-unverified` 拒绝整批提交，父会话只能手动重新派发 reviewer。第 1 章重试两次后才成功；第 2 章在 r2 上再次失败，章节停在 `revised`，审稿没有落盘，后续摘要/结算/定稿全部阻塞。

这不是校验过严：引文必须可核对是审稿证据的合同。问题是**失败没有反馈回路**：父会话拿到的错误只有“第 N 条 observation 的引文不在正文中”，reviewer 下次仍可能重复同类错误；每次重试都是一次完整子代理调用，靠父会话反复手写更严格的 instruction 收敛，成本高且不稳定。

## 对拍参考

`inkos-master` 的审稿产物是 reviewer 输出的文本/结构化结论，没有“引文必须是当前正文逐字子串”的提交校验（`packages/core/src/agents`、`packages/core/src/pipeline/chapter-review.ts`）。本项属于我们的证据绑定合同，**无参考实现**；检索范围 `inkos-master/packages/core/src/agents`、`packages/core/src/pipeline`。裁决：按本项目合同保留校验，只补失败后的自动反馈重试。

## Proposal

`story_delegate` 在 reviewer 角色提交校验失败且错误码为 `observation-source-unverified` 时，自动带反馈重试**一次**：

- 把失败回执（第几条 observation、哪个 sourceRef、错误信息）作为 feedback 注入下一次 reviewer 的派发 prompt；
- 明确要求：引文必须从当前正文逐字复制；无法核对就删除该条 observation；
- 只重试一次，`submissionAttempts` 记为 2；第二次仍失败则把最终错误返回父会话，不写 review；
- 失败路径不落任何一半审稿；重试成功才写 review、推进阶段；
- 其他错误（如 `submit-attempts-exhausted`、服务缺失）不触发这条重试。

## Alternatives considered

**A. 只改 reviewer 技能提示，要求逐字引文。** 最强的理由是不增加宿主逻辑与模型调用。否决原因：真实链路已按这条提示重试两次，第 2 章仍在 r2 上失败；提示无法保证模型遵守，失败后仍无反馈闭环。

**B. 放宽或跳过引文校验。** 最强的理由是彻底消灭这类失败、降低延迟。否决原因：引文是审稿证据可核对性的基础，放宽会让“证据不在正文”的审稿进入清稿流程，违背既有合同。

**C. reviewer 逐条提交 observation。** 最强的理由是失败粒度最小，只重试坏的那条。否决原因：提交协议与阶段机要支持部分审稿，改动远大于一次带反馈重试；本项先解决最常见的整批失败。

## Acceptance criteria

- reviewer 首次提交含不可核对引文时，宿主自动重试一次，第二次 prompt 含具体失败条目与引文修正要求；
- 第二次成功：只写一份 review，阶段正常推进，`submissionAttempts` 为 2；
- 第二次仍失败：返回 `observation-source-unverified`，不写 review、不改阶段，父会话可继续决定；
- 非引文类失败不触发该重试；
- 单测覆盖上述三种路径；全量 CI 通过。

## Risks

- 每次失败多一次 reviewer 子代理调用，延迟与成本上升；以“一次”为上限，不无限重试。
- feedback 可能仍不足以让模型修正引文；失败仍返回父会话，不掩盖问题。
- 重试逻辑放在 `story_delegate` 会让 reviewer 与其它角色的失败处理不完全对称；需在实现时把条件收窄到该错误码与该角色。
