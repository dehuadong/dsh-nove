# Agent Note: 故事工坊：E7 调用日志

Status: implemented

工作项：当前任务 E7（不新建 GitHub issue）。产品范围与验收归本 Note；依赖 F8 已交付。用户裁决：本轮只做模型/子代理调用日志，不做通用工具/作者动作审计。

## Problem

作者能看到成本汇总和失败统计，但看不到具体调用：

- 哪一章、哪个角色、第几次尝试、什么触发；
- completed（已结束但未被接受）/ accepted / rejected / cancelled / timeout / error，以及 `error_code`；
- 耗时、token、usage 是否缺失、模型/provider；
- 连续失败或重试时，无法定位是哪一次。

E7 要求“动作调用与失败记录可查”。当前可用的权威数据是 F8 的 `model_calls`（含 outcome/error_code）；没有通用工具/作者动作审计表。本轮把 E7 收窄为**调用日志**，工具/作者动作审计另立工作项。

## 对拍参考

- `inkos-master/packages/studio/src/pages/LogViewer.tsx:26-44` 是独立日志页，调用 `/logs`，显示 level/tag/message/timestamp、刷新，没有失败过滤或分页；`studio/src/api/server.ts:4281-4291` 是后端入口；侧栏在 `Sidebar.tsx:588`。
- `inkos-master/packages/core/src/interaction/session.ts:39-54` 的 `ToolExecution` 有 `status`/`error`/`args`/`result`/`logs`，是内存中的工具执行记录，不是可持久查询的逐次调用表。
- 本项目 `src/db.ts:208-236` 的 `model_calls` 已记录 role/scope/attempt/submission_attempts/trigger/stop_reason/outcome/error_code/耗时/token；
- `src/telemetry.ts` 的 `recordCall`/`finishCall` 是唯一写入点，F8 已有 `callSummary`。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| Studio 独立 `/logs` 页 | 看板内折叠日志段 | 保持七标签；作者在作品上下文里用 | 偏差 | E2E |
| level/tag/message 文本行 | `model_calls` 结构化逐次调用行 | 需要角色/尝试/错误码 | 等价适配 | 单元/E2E |
| 仅最近条目、无分页 | `id` 游标、20 条/页 + 失败过滤 | 调用量需要定位更早失败 | 新增 | 单元 |
| ToolExecution 内存 status/error | 持久化 outcome/error_code | 同一信息的落盘版 | 采纳 | 失败行测试 |
| 通用工具审计 | 本轮不做 | 无表；需要 schema v16 与全部写入点 | 延后 | 另立工作项 |

## Decision

### 看板内日志段

- 看板“自检”之后增加折叠的“日志”段；不新增主标签；
- 默认折叠，点“展开日志”才显示；展开后加载最近调用；
- 失败切换：只显示 `outcome !== 'accepted'`；`completed` 标为“未接受”，不当作 accepted；
- 列表按 `id DESC`；每页 20 条，“更早”按 `before` 游标翻页；
- 空状态、失败状态、刷新；只读，不提供重试。

### `/logs`

新增只读 `GET /api/see-storycraft/logs?root&id&before&limit&failed`：

- 从 `model_calls` 查询，按 `id DESC`；
- 行字段：id、chapter、role、scope、attempt、submissionAttempts、trigger、stopReason、outcome、errorCode、durationMs、promptChars、outputChars、totalTokens、usageSource、model、provider、startedAt；
- `failed=true` 时 `outcome <> 'accepted'`；不做 role/chapter 过滤（本轮 UI 不消费，避免空接口）；
- `before` 为上一页最后一条 id；返回 `rows`、`nextBefore`（有更多时）；
- 不返回 prompt/output 文本、child_session、delegation_id；
- `limit` 默认 20、必须为正整数（不设产品上限）；非法参数返回既有失败信封 `{ok:false,error:{code:'invalid-query'}}`，不返回裸 400。

### 客户端

- 日志状态由组件持有，按 `workId` 重置；请求计数器丢弃旧作品/旧筛选的迟到响应；
- 失败切换与翻页共用同一加载状态；失败行用 warning/error 标记；
- 显示 outcome/errorCode/role/attempt/submissionAttempts/trigger/stopReason/duration/token/usage；
- README 路由表与说明同步。

### 性能

- 250 章 fixture 写入 250 条调用（含 accepted/completed/rejected/error），测量 **store 级 `readCallLogs`** 的失败过滤和深游标，预算 **<300ms**；
- 单条 SQL + `id` 游标，不逐章查询；响应不含正文。

## Alternatives considered

**A. 通用工具/作者动作审计（schema v16）。** 最强理由是“动作”完整。否决原因：当前没有表，需要所有写入点改 schema；用户已裁决本轮先做调用日志，审计另立。

**B. 独立“日志”标签。** 最强理由是入口清晰。否决原因：七标签已满，日志低频，折叠段足够。

**C. offset 分页。** 最强理由是实现简单。否决原因：新调用插入会导致重复/跳过；`id` 游标稳定。

**D. 直接复用分析成本聚合。** 最强理由是少一个路由。否决原因：分析只聚合，日志要逐次尝试与错误码；职责不同。

## Testing

- `tests/logs.test.mjs`：默认 20 条、id 游标、失败过滤（含 completed）、空作品、非法 limit/before、child_session/delegation_id 不返回、250 条失败深游标中位 <300ms。
- `e2e/logs.spec.cjs`：展开前不请求、游标翻页、失败过滤、completed 显示“未接受”、空状态。
- 完整 CI：90 单元 + 44 E2E。

## Consequences

- 只覆盖模型/子代理调用，不覆盖工具/作者动作；审计延后；
- `error_code` 可能为空（成功、completed 或未带错误码的失败），UI 显示“无错误码”；
- 游标分页不能跳页，只能“更早”；这是日志的合理交互；
- 无独立索引，按主键倒序；250 章/大量调用仍是小表。
