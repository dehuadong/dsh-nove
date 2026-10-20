---
title: 故事工坊：reviser 模式与字数恢复修正（#19 实测）
status: proposed
created: 2026-10-20
updated: 2026-10-20
---

# Agent Note：故事工坊：reviser 模式与字数恢复修正（#19 实测）

## 问题

`session-3d9fec25-8732-4e0a-918c-731a4c09cf12` 的真实单章暴露了 #19 的遗留缺陷：

- reviser `patch` 改动 100% > 20%，`revise-mode-violation`；
- reviser `polish` 改动 100% > 40%，`revise-mode-violation`；
- reviser `rewrite` 只返回 8 字，仍成功（低于 min 只 warning）；
- 主编随后手动 `subagent` + `story_write`（3,093 / 3,092 字符）+ `story_revise`（3,397 字符），正文多次进入主会话；
- 主会话工具参数+结果约 26,538 字符，总 token 约 1.46M；
- #19 AC6 明确“手动正文回退判失败”。

这不是 #23 的传输通道问题：即使改成结构化提交，8 字 rewrite 仍会被接受，reviser 模式失败仍可能导致回退。

## 参考基线与证据

参考工程 `inkos-master` 2.0.0（只读；用户 2026-10-20 授权功能对拍）。只吸收校验与重试行为，不复制代码。

- `runWorkerAgentTool` 让角色通过一个结构化结果工具提交，`validate` 在工具执行时校验；失败把错误回给模型，模型在**同一次 worker 运行内**重试，最多 3 次（`maxResultTurns = 3`）。
- `assertChapterLength` 对显式 min/max 都硬拒绝，错误 `CHAPTER_LENGTH_OUT_OF_RANGE`；不是低于 min 只 warning。
- reviser 的 `submit_revised_chapter` 在 `validate` 中检查正文非空与长度；spot-fix 另有范围编辑与 replacement budget。
- 宿主只在结构化提交通过后接收结果；不解析最终文本，不由宿主重新发起角色调用。

结论：正确做法不是“宿主再跑一遍 reviser”，而是**把校验放进提交工具，让子代理在同一次运行内自我修正**。

## 与既有记录

- 本项是 `proposed/pipeline/2026-10-20-storycraft-host-delegation.md` 的范围内修正：保留 DSH subagent、`story_delegate` 编排、角色契约。
- 本项不改 #21 的 warning-only；未登记人名仍 warning。
- 本项不改 #22 的 artifact ID/阶段上下文。
- 本项不改 #23 的结构化提交设计；#23 解决“结果从哪来”，#19 修正解决“结果是否合格”。

## 提案

### 1. 把 reviser 校验放进 `story_submit`

`story_submit` 在接收 payload 时校验：

- writer：`wordRange.min` / `wordRange.max` 都硬校验；
- reviser：`wordRange.min` / `wordRange.max` 都硬校验（这是本项对 #19 原“低于 min 只 warning”的修正）；
- reviser mode：用与 `reviseChapter` 相同的比例校验：
  - `patch` 改动 ≤ 20%；
  - `polish` 改动 ≤ 40%；
  - `rewrite` 不限制比例；
  - `deslop` 必须减少腔调命中；
- 校验失败返回 `submit-word-range` / `submit-mode-violation`，带 `retryable: true` 与实际值/限制；
- **失败不消费 entry、不落盘**，子代理可以在同一次运行内修正 payload 后再次提交；
- 最多 3 次提交尝试（与参考 `maxResultTurns` 对齐）；超过返回 `submit-attempts-exhausted`；
- 成功后 entry 标记 consumed，父代理才读取。

### 2. 不采用宿主重试

`story_delegate` 不再做：

- 重新发起下一次子代理；
- 自动换 mode；
- 自动重写。

父代理只负责：

1. 启动子代理；
2. 等待 accepted submission；
3. 校验/落盘；
4. 返回紧凑回执。

子代理自己看到工具错误并重试，符合参考的 `validate + 3 attempts`，也避免宿主多次启动子代理的成本。

### 3. 委派与手动路径分开

- 委派 reviser：低于 min 硬拒绝；
- 手动 `story_revise`：保持现有低于 min 只 warning；
- 委派 clean 路径不得用 `subagent` + `story_write`/`story_revise` 手动搬运正文；发生即记录 `manual-body-fallback`，真实测量判失败。

### 4. 角色契约同步

- `promptFor`：注入 `delegationId`，要求调用 `story_submit`；删除 TITLE/CHAPTER/JSON 与“不要调用任何动作”；
- `storycraft-revise-craft`：`patch`/`polish` 保留未点名段落；`rewrite` 必须完整成章；收到 `submit-word-range`/`submit-mode-violation` 时修正后重提；
- `storycraft-studio-orchestration`：委派失败先重提，不直接手动搬正文；
- `story_delegate` 回执增加 `submissionAttempts`/`lastMode`/`wordRange`，不含正文。

## 备选方案

- **宿主重试**：需要重新启动子代理，成本高，且与参考的 in-tool validation 不一致；否决。
- **只把 min 改成 error，不做工具内重试**：能挡住 8 字，但子代理没有修正机会；不完整。
- **继续用提示词要求完整成章**：实测 8 字成功，提示词不能替代校验；否决。
- **把 reviser 改成宿主内 worker**：放弃 DSH subagent，超出 #19 范围；否决。

## 验收条件

1. 委派 reviser 低于 min 返回 `submit-word-range`，不落盘；
2. 8 字 rewrite 回归测试被拒绝，不再成功；
3. 失败不消费 entry，子代理最多 3 次提交尝试；超过返回 `submit-attempts-exhausted`；
4. patch/polish 超幅返回 `submit-mode-violation`，不落盘；
5. 手动 `story_revise` 仍允许低于 min（只 warning）；
6. 真实单章重跑无手动正文回退；主会话工具参数+结果 ≤4,000；
7. 回执含提交次数/最后 mode/字数范围，不含正文；
8. 单元测试与 E2E 全过，新增 8 字、3 次上限、mode 比例、无手动回退测试。

## 风险

- 子代理可能反复提交错误；用 3 次上限终止；
- 低于 min 硬拒绝可能拒绝作者故意写的短章；仅限委派 reviser，手动路径不变；
- 主编仍可能违反流程手动回退；只能通过测量判失败，不静默通过；
- 本项的 in-tool 校验/重试依赖 #23 的 `story_submit`；实施顺序必须是 **#23 先提供通道，再在本通道加 #19 的 min/max 与 3 次校验**。若把校验直接并入 #23，#19 退化为验证项，避免重复实现。

