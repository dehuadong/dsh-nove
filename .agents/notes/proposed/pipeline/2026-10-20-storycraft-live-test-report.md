---
title: 故事工坊：真实单章测试收口报告（#19/#21/#22/#23/#24）
status: proposed
created: 2026-10-20
updated: 2026-10-21
---

# Agent Note：故事工坊：真实单章测试收口报告（#19/#21/#22/#23/#24）

> 本文件是测试收口记录，不是新的实现设计。用来防止会话变长后丢失真实结论；实施决定仍归各工作项。

## 问题

> 2026-10-20 首次真实链路保留为历史证据；2026-10-21 复验结论见后文，数值以复验为准。

- 会话：`session-3d9fec25-8732-4e0a-918c-731a4c09cf12`
- 作品：`dengxia`（《灯下》），longform，单章 1,500–2,500 字
- 路径：空白会话 → 提案/立项 → 全书计划确认 → 章纲确认 → writer → reviewer → reviser → 摘要 → 状态/定稿
- 最终状态：第 1 章 `settled`，`r5`，1,999 字

## 2026-10-21 复验结论

会话 `session-91e3c83e-05b6-4781-b319-a3f539b74ef8`，作品《雪线邮路》（longform，单章 1200–1800 字）。三章各跑一遍链路：提案/立项 → 全书计划（面板确认）→ 章纲（面板确认）→ writer → reviewer → reviser / 清稿 → 摘要 → 定稿。第 1 章从零建档，第 2 章在作品已备好的情况下复测 AC6 窗口，第 3 章验证 #21 的空清单清稿。三章均 `settled`：第 1 章 `r2` 1,485 字，第 2 章 `r2` 1,703 字，第 3 章 `r1` 1,408 字，`openProblems 0`。宿主运行的是当前代码（persona 已含 `story_submit`，无需重载）。

| 工作项 | 结论 | 证据 |
| --- | --- | --- |
| #23 角色结果通道 | **通过** | 三章共 8 个子代理（3× writer、3× reviewer、2× reviser）都只调 `story_submit`，最终回答均为「已提交」（3 字符）；父回执含 `submissionAttempts`/`lastMode`/`wordRange`，不含正文 |
| #19 无手动正文回退 | **通过** | 主会话无 `subagent` / `story_write` / `story_revise` 调用；正文只出现在 `story_read` 的只读结果里 |
| #19 字数硬校验 + 同轮重提 | **通过** | 第 1 章 writer 连续两次被 `submit-word-range` 拒绝（1,042 / 1,165 < 1,200），第 3 次提交 1,247 字成功；同一子代理运行内完成，父回执 `submissionAttempts: 3`。第 2 章 writer / reviewer / reviser 均一次通过 |
| #19 reviser mode | **通过（未触发违规提交）** | 两章 reviser 都是 `patch` 一次成功（1,247→1,485；1,461→1,703），Q1–Q6 resolved，`submissionAttempts: 1`；没有 mode 违规被接受 |
| #19 主会话 ≤4,000 字符（AC6 clean 窗口） | **通过** | 第 2 章 2,107；第 1 章补完 bible 后 1,758。均 ≤4,000 |
| #19 首次建档 setup episode | **单独记录** | 第 1 章 `bible-missing` + 源码排查 + 4 份 bible：6,290（≤10,000，不并入 clean 值） |
| #22 路径 / artifact ID | **通过** | 主会话无 `works/`、`.dsh/` 路径；只按 `chapter:1` / `chapter:2` 读取，未跨章 |
| #21 warning-only | **通过** | 未登记人名 / 地名只进 `warnings`，未阻断落盘 |
| #21 清稿路径 | **通过（手动空清单）** | 第 3 章 `story_review(problems: [])` 落盘 `review:3:r1:2`；`story_next` 返回 `story_summarize`（reason「清稿审稿无问题」）；`story_state` 定稿到 `settled`。委派 reviewer 的空清单未触发（严格指令下仍报 3 条硬伤），由 `delegate.test.mjs` 覆盖 |

### 量化

| 指标 | 2026-10-20 | 2026-10-21 |
| --- | --- | --- |
| 主会话工具参数 + 结果（第 1 章整轮） | 26,538 | 18,909（-29%） |
| #19 AC6 clean 窗口 | 未测 | 2,107（第 2 章）/ 1,758（第 1 章补完 bible 后） |
| 首次建档 setup episode | — | 6,290 |
| 总 token（第 1 章） | 1,459,887 | 865,521（uncached 28,923 / output 11,510 / cache read 825,088） |
| 手动正文回退 | 3 次 | 0 |
| 子代理最终回答正文 | 有 | 无 |
| #24 摘要窗口（第 4 章） | — | 591 字符；整轮 2,735；`summaryChars` 317；摘要前 `story_read` 0 次 |

主会话字符分布（第 1 章整轮）：

- 问候轮 28；
- 提案 / 立项 / 全书计划 4,968（其中 `skill` 结果 3,807）；
- 章纲 773；
- 写→定稿 13,140：setup episode（`bible-missing` + 4 份 bible + 源码排查）6,488，核心生产链 6,652；其中摘要前 `story_read` 2,224。

### AC6 窗口口径

#19 AC6 的测量窗口是「本章第一次 `story_next` → 修订完成」，排除 `story_init`/`story_outline`/`story_bible` 准备动作与 `skill` 加载；summary/state 不在 #19 范围（AC3）。按该口径：

- 第 2 章（作品已备好）：**2,107 ≤ 4,000**；三个角色均一次通过，无恢复 episode。
- 第 1 章：补完 bible 后 **1,758 ≤ 4,000**；从零建档触发的 `bible-missing` episode **6,290** 单独记录（≤10,000），不并入 clean 值。
- 若不拆 setup、把整轮（含摘要/定稿）都计入：第 1 章 18,909、第 2 章 6,311。这两个数用于观察整体成本，不是 AC6 值。

### 子代理提交明细

| 章 | 角色 | 提交次数 | 失败码 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | writer | 3 | `submit-word-range` ×2（1,042 / 1,165） | 1,247 字，`r1` |
| 1 | reviewer | 1 | — | 6 条问题，`review:1:r1:1` |
| 1 | reviser | 1 | — | `patch`，1,485 字，Q1–Q6 resolved，`r2` |
| 2 | writer | 1 | — | 1,461 字，`r1` |
| 2 | reviewer | 1 | — | 6 条问题，`review:2:r1:1` |
| 2 | reviser | 1 | — | `patch`，1,703 字，Q1–Q6 resolved，`r2` |

### #21 清稿路径明细（第 3 章）

1. writer 委派：1,408 字，`submissionAttempts: 1`，`chapter:3 r1`。
2. 委派 reviewer 时明确要求「只报阻断定稿的硬伤，没有就 `items: []`」，回执仍为 3 条问题；委派空清单路径未触发。
3. 主编按作者要求调用 `story_review(chapter=3, problems=[])`：接受，`review:3:r1:2`，`problems: []`。
4. `story_next`：`action: story_summarize`，`reason: 第 3 章清稿审稿无问题：先写摘要，再定稿`；没有返回 `story_revise`。
5. `story_summarize`：234 字，`summary:3`；`story_state`：`state seq:22`，第 3 章 `settled`。
6. 全程未派 reviser、未改正文。

### #24 摘要角色通道（第 4 章）

真实单章在 `session-91e3c83e` 跑到摘要完成（未定稿）：

1. writer 1,278 字（`r1`，1 次提交）→ reviewer 6 条问题 → reviser `patch` 1,456 字（`r2`，Q1–Q6 resolved，1 次提交）。
2. `story_next` 返回 `action: story_summarize`、`delegate.role: summarizer`。
3. `story_delegate(role: summarizer)` 回执：`summary:4`、`summaryChars: 317`、`submissionAttempts: 1`；摘要正文只写事实与状态变化。
4. 主会话本步只调 `story_next` + `story_delegate`，**没有 `story_read`**，也没有手动 `story_summarize` / `story_write` / `story_revise` / `subagent`。
5. 测量：摘要窗口（`story_next` 调用 → 摘要回执）**591 字符**；整轮工具参数+结果 **2,735 字符**；均低于 #24 的 700 / 6,311 基线。
6. 三个子代理最终回答均为「已提交」，未回正文。

### 本轮遗留

1. ~~摘要前 `story_read` 把整章读回主会话~~：2026-10-21 #24 已由 summarizer 角色通道关闭（第 4 章摘要窗口 591，无 `story_read`）。摘要 revision 绑定仍是后续缺口。
2. #21 清稿路径：手动空清单已通过；委派 reviewer 的 `items: []` 真实链路未触发（严格“只报硬伤”指令下仍出 3 条），该分支由 `delegate.test.mjs` 覆盖。
3. 一致性 warning 误报：把「交叉两」「看见山」「用袖口」「院门口」等分句/短语当人名地名；只 warning、不阻断，噪声偏高。
4. 8 字 reviser 的真实链路未复现；同一条 `submit-word-range` 校验由 writer 两次越界实测，8 字、3 次上限与 mode 比例由 `storycraft/tests/submission.test.mjs` 覆盖。

## 提案

| 工作项 | 结论 | 证据 |
| --- | --- | --- |
| #22 路径/artifact ID | **通过** | 全程无 `works/` 路径；工具只返回 `artifactId`/`revisionId`/`kind`；`story_read` 按 ID 读取正常 |
| #21 warning-only | **通过** | `story_write` 对未登记人名/尺寸只 warning，正文落盘 |
| #21 清稿路径 | **未验证** | 本轮审稿有 5/7 条问题，没有空清单清稿 |
| #19 主会话不搬运正文 | **失败** | reviser 模式失败后主编手动 `subagent` + `story_write`/`story_revise`，正文多次进入主会话 |
| #23 角色结果通道 | **未实施** | 规划已扩展为“通道 + #19 的 reviser 校验”；本轮暴露的是 reviser 质量与回退 |

## 失败链

1. writer delegate 成功：回执约 256 字符，1,602 字；
2. reviewer delegate 成功：回执约 232 字符，5 条问题；
3. reviser `patch` → `revise-mode-violation`（改动 100% > 20%）；
4. reviser `polish` → `revise-mode-violation`（改动 100% > 40%）；
5. reviser `rewrite` → 成功但只有 **8 字**（低于 min 只 warning）；
6. 主编走手动兜底：
   - `subagent` prompt 1,248 字符；
   - `story_write` body 3,093 字符；
   - `story_write` body 3,092 字符；
   - `story_revise` body 3,397 字符；
7. 第 1 章最终 `r5` / 1,999 字 / settled。

## 量化

- 主会话工具参数 + 结果：约 **26,538 字符**（#19 AC6 要求 clean 路径 ≤4,000）；
- 总 token：约 **1,459,887**（cache read 约 1,389,056）；
- 父会话正文出现：手动 `story_write`/`story_revise` 三次；
- writer/reviewer delegate 回执本身不含正文。

## 根因

1. **reviser 的低于 min 只 warning**：8 字 rewrite 被接受，缺少严重低于下限的拒绝；
2. **reviser mode 重试没有阻止回退**：patch/polish 超幅后 rewrite 产出过短，主编转向手动；
3. **手动兜底仍会把正文搬回主会话**：`story_write`/`story_revise` 的 body 参数是全文；
4. **#23 不能替代 #19**：结构化提交只换角色结果通道，不修 reviser 质量/模式/回退；
5. **清稿路径未被真实触发**，不能宣称 #21 的 clean 链路已验证。

## 已解决

- #22 的虚拟路径误读在本次真实链路未再出现；
- #21 的全局角色词硬阻断已消失，未登记人名只 warning；
- 阶段机可到 `settled`，摘要/状态/定稿链路可走通。

## 未解决

> 以下为 2026-10-20 状态；2026-10-21 复验已把 #23 通道、手动正文回退、子代理最终回答与 AC6 窗口预算判为通过。整体成本仍高于单轮 AC6 值，原因是首次建档与摘要读取，见上文。

- #19：reviser 质量/模式/字数 + 手动正文回退，主会话字符超预算；
- #21：真实空审稿清稿链路；
- #23：角色结构化提交 + #19 校验仍是规划，不实施；
- 真实链路里子代理最终回答仍会展示正文（传输方式），与 #23 有关，但不是本轮首要阻塞。

## 验收条件

> 状态以 2026-10-21 复验为准。

1. **#23 先提供 `story_submit` 通道** —— 已完成；
2. 在同一通道内加入 #19 的 reviser min/max、mode 校验与 3 次提交尝试；只做 #23 通道不加校验不算完成 —— 已完成，writer 两次字数越界在同轮重提；
3. 重跑真实单章，确认无手动正文回退且主会话 ≤4,000 —— 通过：无手动回退；AC6 clean 窗口 2,107（第 2 章）/ 1,758（第 1 章 setup 后），首次建档 episode 6,290 单独记录；
4. 再验证 #21 清稿路径 —— 仍未触发；
5. #22 路径项保持通过，不再用提示词补路径 —— 通过。

## 不可丢失的约束

- 测试目标是主会话链路与 token/正文搬运，不是故事情节/文笔；
- 不能把“21 个单元测试通过”当成真实链路通过；
- #23 只提供通道；必须和 #19 的 reviser 校验一起验收，不能把“#23 已实现”当成 #19 已解决；
- 每次真实测试结论要回写本报告或对应 Issue，不能只留在对话。

## 备选方案

- **把本报告做成新工单**：增加跟踪面但不改变失败事实；本报告挂在 #19/#21/#22/#23 之间，先不另立实现项。
- **把 #19 校验并入 #23**：推荐；结构化提交本来就要在工具内校验，避免两套实现。
- **先做 #23 通道但不加校验**：8 字 rewrite 仍会成功；否决。
- **继续用提示词约束 reviser**：本轮已出现 8 字成功；提示词不能替代字数/模式校验；否决。
- **直接关闭 #19 为已解决**：2026-10-20 当时与 AC6 的 4,000 字符和“手动正文回退判失败”冲突，否决；2026-10-21 复验两项均通过后，可按 AC6 口径关闭。

## 风险

- 本报告含 2026-10-20 与 2026-10-21 两轮证据；后续修复会改变数值和结论，必须更新而不是继续引用旧数；
- 总 token 含 cache read，不能当成等价计费；主会话字符数才是 #19 的直接指标；
- 如果只做 #23 通道、不把 #19 校验并入，会掩盖 reviser 失败；因此两项必须同批验收；
- 真实会话的模型行为会波动，重跑要记录是否触发手动回退，不能只报最终 settled；
- 本报告不替代 #19/#21/#22/#23 的验收，只作为当前结论与顺序依据。



