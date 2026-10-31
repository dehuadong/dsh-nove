# Agent Note: 故事工坊：F14 失败重试与单章成本上限

Status: proposed

工作项：当前任务 F14（不再新建 GitHub issue）。验收与产品行为归本 Note；F8 的 `model_calls` 是数据基础。

## Problem

长篇章级派发目前只有零散的重试：

- 子代理启动阶段的临时 provider 故障没有重试，作者只能重跑整步；
- reviewer 引文校验有一次专用重试，其他角色没有；
- 超时、无提交和内容失败没有统一的分类，也不区分“可重试的启动故障”和“不能重试的内容失败”；
- 没有任何单章成本上限；F8 已能按 `chapter/role` 聚合 token，但派发前不检查；
- 中断只靠 `exec.signal` 透传，重试/退避期间没有统一的取消语义。

F8 之前无法测量重试成本，现在可以按章聚合；F14 只消费这份数据，不新增金额换算。

## 对拍参考

- `inkos-master/packages/core/src/llm/provider.ts:41`：`TRANSIENT_LLM_RETRIES = 2`；
- 同文件 `:145-210`：只在零可见事件时重试；线性退避 `800 * (attempt+1)`，可被 caller signal 中断；
- 同文件 `:761-807`：临时错误分类只看 429/502/503/504、`temporarily unavailable`、`rate limit`、`overloaded` 等；裸 500/`MODEL_NOT_AVAILABLE` 不重试；
- 同文件 `:188-196`：超时/流中断**不重试**，避免把半截内容当成功或重复生成；
- 参考没有单章 token 成本上限；上限是本项目 F14 的新增产品能力，按 F8 的 token 观测实现，不换算金额。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| provider 层启动重试 2 次 | `runChild` 在 `startActivation` 阶段重试 2 次 | DSH 子代理内部不可见 provider 流；启动失败时 child 尚未建立 | 等价适配 | 启动失败行数/attempt |
| 零可见事件才重试 | 启动失败天然零事件；激活开始后一律不重试 | 有 child 就可能已产生 `assistant/attempt` 部分流，重试会重复计费/提交 | 采纳 | 激活后失败不重试 |
| 超时/流中断不重试 | 超时、无提交、格式/审稿拒绝不自动重试 | 与参考一致；避免重复生成和单次提交被消费 | 采纳 | 超时单行测试 |
| 线性退避 | `800 * (attempt + 1)` 毫秒，abortable | 与参考一致 | 采纳 | 中断测试 |
| 无成本上限 | 作者可选 `maxChapterTokens`，无默认 | 不发明产品限制 | 新增 | 上限/不设限 |

## Proposal

### 重试（只覆盖启动阶段）

`runChild` 在 `startActivation` 阶段最多 **2 次重试**（初次 + 2 次）：

1. 只在以下条件同时满足时重试：
   - `startActivation` 抛错，child 尚未建立，因此没有事件、没有提交；
   - 错误是临时故障（分类见下）；
   - caller signal 未中止；
   - 还有重试余额。
2. 临时故障分类按参考：`429`、`502`、`503`、`504`、`temporarily unavailable`、`service unavailable`、`bad gateway`、`gateway timeout`、`too many requests`、`rate limit`、`overloaded`、`please retry`、`try again later`；裸 `500`/`MODEL_NOT_AVAILABLE` 不重试。**先做临时分类，再做 capability 判断**：错误文本含 `provider` 不等于不可用，只有 `UNSUPPORTED_CAPABILITY`/明确的 capability 缺失才映射为 `delegation-unavailable`；`provider unavailable` 文案仍按不可用处理、不重试。
3. 每次启动失败写独立 `model_calls` 行：`outcome='error'`、`error_code='delegation-transient'|'delegation-unavailable'`，`attempt` 按 `(chapter, role, scope)` 递增，`trigger='transient-retry'`（首行 `first`）。**只有实际调用 `startActivation` 后才写行**；`assertBudget` 拒绝和退避期间的 abort 发生在记录脚手架之外，不写行。
4. 重试前等待 `800 * (retryIndex + 1)` 毫秒（retryIndex 从 0 开始，即 800/1600ms，可被 signal 中断）。
5. 激活一旦开始，超时/错误/无提交都不自动重试；由作者决定是否重跑。最终失败保留最后一行与错误码，不写半成品。
6. 启动重试成功后，receipt 带 `retries`（实际重试次数）；失败用明确错误码，而不是只靠文案。

### 单章成本上限

- `story_settings` 增加可选 `maxChapterTokens`（正整数；`null` 清空）；**没有默认值**，未设置就不限制。
- 每次派发（包括启动重试）开始前，按 `chapter` 聚合 `model_calls.total_tokens`；达到或超过上限时抛 `chapter-budget-exceeded`，不启动新 child，不写 `model_calls`。
- 上限只按已观测 token 计算：`partial/unavailable` 不伪造成本，也不因缺 usage 自动放行；status 的 `callsPartial`/`callsWithoutUsage` 让作者知道成本可能低估。
- 上限按单章，architect 等 `chapter=NULL` 不参与；settler/validator 也走同一检查。
- 设置持久化在作品库 `meta.max_chapter_tokens`，schema 升至 **v15**；旧 v14 作品 `schema-version-mismatch`，按项目政策重建；书籍导出不含 `max_chapter_tokens`（现有导出仍含 wordRange/planApproval）。

### 中断

- `exec.signal` 中止时：不再启动重试；正在等待的退避立即结束；如果已有 child，立即 abort。
- 启动失败行保持 `error`，不事后改写成 `cancelled`；没有新 child 时不会产生额外行。
- 中断不写正文/状态/草案；已落地的提交不回滚，但不再继续新的 child。

## 实施落点

- `src/delegate.ts`：`runChild` 的启动重试循环、临时错误分类（先临时后 capability）、abortable backoff、每次启动独立 `model_calls` 行、`ChildCall.retries`；`CallTelemetry.assertBudget` 在每次启动前、记录脚手架之外调用。
- `src/telemetry.ts`：`chapterTokenTotal(root, work, chapter)`；`assertChapterBudget`。
- `src/store-db.ts` / `src/db.ts`：`maxChapterTokens` 设置、`meta.max_chapter_tokens`、schema 15、`WORK_SCHEMA_REQUIRED_COLUMNS.meta`。
- `src/tools.ts`：`story_settings` 参数/输出；`story_delegate` receipt `retries`；`story_settle`/`story_state_check` 的错误码传递；`chapter-budget-exceeded` 不被结算循环吞成反馈。
- `src/state-settle.ts` / `src/state-check.ts`：派发前 budget 断言、错误码映射；**除 architect 外所有 chapter 派发必须注入 `assertBudget`**，漏注入由类型/测试拦截，不能静默不设限。
- `tests/retry-budget.test.mjs`：启动重试/非临时/耗尽/中断/上限/未设限；`migration.test` 更新 v15。

## Alternatives considered

**A. 在 DSH 宿主/provider 层重试。** 最强理由是与参考的 LLM retry 完全同层。否决原因：本插件拿不到子代理内部的 LLM 流，宿主 provider 也不归本插件控制；只能在启动层等价实现。

**B. 激活后超时也重试。** 最强理由是作者不用手动重跑长章。否决原因：DSH 会把失败流写成 `assistant/attempt` 部分内容，重试会重复生成与计费；参考明确不重试超时；单次 submission 也会被旧 child 消费。F14 选择不自动重试。

**C. 固定默认 token 上限。** 最强理由是开箱即用。否决原因：项目禁止自创产品限制；不同模型/章节长度差异大，必须由作者显式设置。

**D. 上限按金额。** 最强理由是最直观。否决原因：F8 作者已裁决只记 token/model，不做单价；金额需要价格表和供应商变动，归后续独立工作项。

## Acceptance criteria

1. 启动阶段临时故障：自动重试最多 2 次，每次一行 `model_calls`，`attempt` 按 `(chapter,role,scope)` 递增，`trigger` 首行 `first`、重试行 `transient-retry`；非临时错误只写一行；
2. 激活开始后的超时/错误/无提交/格式/审稿拒绝：不自动重试，保留失败行与错误码；
3. 启动重试耗尽：抛明确错误码，正文/状态无半成品；成功回执带 `retries`；
4. 中断：退避或 child 期间 abort 后不再启动新 attempt；退避期间的 abort 不写行，不覆盖已写行；
5. `maxChapterTokens` 设置后，达到上限的下一次派发（含启动重试）在记录脚手架之前被 `chapter-budget-exceeded` 拒绝，且不新增调用行；未设置时不限制；
6. 上限只统计已观测 token，partial/unavailable 不被伪造；architect 不受单章上限；settler/validator 也受检查；
7. schema v15；旧 v14 被拒；`story_settings` 可设置/清空上限；导出不含该设置；
8. 现有单元 + 29 E2E 通过；新增重试/上限/中断测试。

## Risks

- 启动错误分类基于 provider 文案，文案变化可能漏判；漏判只导致不重试，不会误重试内容失败。
- 上限按已观测 token，usage 缺失时可能低估；status 已暴露缺失计数。
- schema v15 让 v14 测试作品失效，按政策重建。
- 启动重试不覆盖激活后的超时/格式失败，作者仍需手动重跑；这是为了避免重复计费和重复提交。
