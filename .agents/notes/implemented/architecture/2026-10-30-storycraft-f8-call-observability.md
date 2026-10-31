# Agent Note: F8 成本与调用观测

Status: implemented

工作项：`#88`。

## Problem

每次角色派发只留下回执里的 `submissionAttempts` 和上下文 trace；没有统一的：

- 派发耗时、attempt、stopReason、失败码；
- 子代理实际 token usage（prompt/completion/total/cache）；
- 模型/provider 身份；
- 输入/输出字符量；
- 按作品/章节/角色聚合的调用成本。

现有 `trace` 只记上下文预算，且按 `trace:<chapter>:<role>` 覆盖；`story_settle` 的 settler/validator 与 reviewer 引文重试也没有独立记录。F14 要做失败重试与单章成本上限，缺少数据基础。

## Decision

### 存储

作品库新增 `model_calls` 表（**schema v14**；作者已确认）：

```sql
CREATE TABLE model_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter INTEGER,                    -- 非章调用（architect）为 NULL
  role TEXT NOT NULL,
  scope TEXT NOT NULL,                -- 操作上下文：architect:frame、review:r2、settle:r1…
  attempt INTEGER NOT NULL,           -- 同一 scope 内首次 1，重试 2…
  submission_attempts INTEGER,        -- 子代理提交尝试次数，事后更新
  trigger TEXT NOT NULL,              -- first/reviewer-quote-retry/settler-revalidate/validator-revalidate/transient-retry
  delegation_id TEXT,
  child_session TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  stop_reason TEXT,
  outcome TEXT NOT NULL,              -- completed/accepted/rejected/error/timeout/cancelled
  prompt_chars INTEGER NOT NULL,
  output_chars INTEGER NOT NULL,      -- assistant 文本 + tool-call 参数总字符
  model_calls INTEGER,                -- 子会话 assistant/message 数
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  usage_source TEXT NOT NULL,         -- session/partial/unavailable
  model TEXT,
  provider TEXT,
  error_code TEXT
);
CREATE INDEX model_calls_chapter_role ON model_calls(chapter, role);
```

`WORK_SCHEMA_VERSION` 13→14；旧库直接 `schema-version-mismatch`，不做迁移（项目政策：测试作品重建）。`model_calls` 加入 `WORK_SCHEMA_REQUIRED_COLUMNS`，`migration.test` 同步。

### 采集归属

`runChild` 是唯一写入者：

1. 开始派发时记 `started_at`、`prompt_chars`、`scope`、`attempt`、`trigger`；
2. `activation.result` 返回后、`dispose` 前，通过注入的 `sessions` 读取 `sessions.get(activation.childId)?.ownEvents()`；
3. 统计 `assistant/message` 数、usage 求和、请求头里的 model/provider、assistant 文本与 `tool/call` 参数总字符；
4. 调用注入的 sink 写一行；初始 `outcome` 为 `completed`/`error`/`timeout`/`cancelled`，`submission_attempts` 先为 NULL；sink 返回 `callId`；
5. 返回 telemetry + `callId` 给 receipt；call site 在 `finally` 里按 `callId` 写入 `submission_attempts`（consumeSubmission 的 attempts，0..3）并更新 `outcome`：
   - 有 payload 且被接受 → `accepted`；
   - 提交被拒（reviewer/settler/validator 任一）→ `rejected` + `error_code`；
   - 没有任何提交且子代理失败/超时/取消 → 保留初始 `error`/`timeout`/`cancelled`。
   sink 失败只 warning。

`ChildActivation` 需暴露 `childId`；`DelegateHost` / `ChildRunInput` 增加可选 `sessions` 与 telemetry 上下文（work/chapter/role/scope/attempt/trigger/delegationId）。不把 store 依赖塞进 subagents 服务。

### 调用点

- `delegateRole`：writer/reviewer/reviser/summarizer/planner，首次 `trigger='first'`、`attempt=1`；
- reviewer 引文重试：`attempt=2`、`trigger='reviewer-quote-retry'`，不覆盖第一行；
- `delegateArchitect`：`chapter=NULL`，`trigger='first'`；
- `state-settle` settler 第一次 `trigger='first'`；同一结算轮次的第二次 settler 用 `settler-revalidate`，attempt=2；
- `state-check` 首次 `trigger='first'`；同一轮次的第二次 validator 用 `validator-revalidate`，attempt=2；
- attempt 的作用域是 `(chapter, role, scope)`；scope 标识操作上下文（architect 的 frame/rules/roles/cards、review:r2、settle:r1、validate:r1…），同一 scope 内重试才递增，新 stage/新 review 轮次从 1 开始；trigger 只记录重试原因；
- F14 已增加启动重试的 `transient-retry`，并把初始 attempt 改为按 scope 派生；见 [F14 Note](2026-10-31-storycraft-f14-retry-budget.md)；
- 所有提交被拒（reviewer/settler/validator）→ `outcome='rejected'` + `error_code`；超时/取消分别 `timeout`/`cancelled`。

### usage 与成本口径

- 只记 token 与模型身份，**不换算金额**；F14 再做费用与上限。
- usage 从子会话 `assistant/message.data.usage` 求和；无 usage 的消息不补 0，按覆盖情况：
  - 全部消息有 usage → `usage_source='session'`；
  - 部分有、部分无 → `usage_source='partial'`，token 字段为**已观测部分之和**，聚合必须同时给出 `callsPartial` 与 `usageComplete=false`；
  - 全部无 → token 字段 NULL、`usage_source='unavailable'`。
- `usageComplete` 只有在所有记录都是 `session` 且 count>0 时为 true；F14 不得把 partial 当完整成本。
- `model`/`provider` 从子会话 request header/context 读取，缺失 NULL。
- `output_chars` 取 assistant 文本与 tool-call 参数总字符；不存正文。
- 主会话自身的模型调用不记录。

### 可见面

- `story_delegate` 回执增加 `durationMs`、`usage`；`story_settle` **复用现有 `trace.durationMs`**，在 `trace.usage` 中给本次结算的聚合 usage，不新增顶层 duration；
- `story_status.calls` 聚合：`count`、`totalDurationMs`、`totalTokens`（无 usage 为 null）、`callsWithUsage`、`callsPartial`、`callsWithoutUsage`、`usageComplete`、`byRole`；
- 不新增面板页面；调用明细留给后续 E7/CLI。

## 对拍参考

- `inkos-master/packages/core/src/agents/writer.ts:80,142-210`：writer 返回 tokenUsage（prompt/completion/total）；
- `inkos-master/packages/core/src/agents/continuity.ts:16-101`：review tokenUsage；
- `inkos-master/packages/core/src/pipeline/runner.ts:1338-1436`：章节累计 tokenUsage；
- `inkos-master/packages/core/src/utils/analytics.ts:24-35`：按章节聚合 token。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 代理返回 tokenUsage | 子会话 `assistant/message.usage` 求和 | DSH activation 结果不带 usage | 等价适配 | 有/partial/无 usage |
| 章节累计 usage | `model_calls` 按 chapter/role 聚合 | 需要 attempt/耗时/失败观测 | 采纳 | status.calls |
| analytics 只聚合 token | 同时记耗时、attempt、trigger、outcome | F14 需要重试/成本 | 扩宽 | 调用记录 |
| 无表概念 | 作品库 v14 新表 | 查询/聚合与备份同库 | 采纳（作者确认） | 旧 schema 拒绝 |

## Alternatives considered

**A. 扩展 `trace` artifact 记 calls，不升 schema。** 最强的理由是不破坏 v13 作品、复用现有产物。否决原因：trace 按角色覆盖，settler/validator 没有 trace，重试会丢历史；聚合要读全部 artifact 并解析，生命周期更差。

**B. 往 `events` 写 `kind='model-call'`。** 最强的理由是不加表、随事件日志持久化。否决原因：`events` 是状态事件权威，调用记录会污染 settle/reopen 计数与状态投影。

**C. 不升 schema，首次写入时 `CREATE TABLE IF NOT EXISTS`。** 最强的理由是旧作品也能用。否决原因：项目明确旧 schema 直接拒绝；按需建表让 schema 版本失去意义。

**D. 只把耗时/usage 放回执，不持久化。** 最强的理由是最小。否决原因：无法按作品/章节聚合，刷新后丢失，F14 无法做上限。

## Testing

- `tests/model-calls.test.mjs`：`model_calls` 插入/更新、session/partial/unavailable 聚合、`runChild` 读取子会话 usage/model/output chars、无 `sessions` 时 NULL。
- `tests/migration.test.mjs`：新作品 v14；旧 v13 被 `schema-version-mismatch` 拒绝。
- `tests/tools.test.mjs`：`story_status` 的 `calls` 字段声明与仅声明字段；delegate 输出的 `durationMs`/`usage` 声明。
- 全量 `node storycraft/scripts/ci.mjs`：84 单元 + 29 E2E。

## Consequences

- 每次角色派发在作品库留下耗时、attempt、trigger、outcome、token/model 观测；story_status 可聚合，delegate 回执带 duration/usage。
- usage 来自子会话 assistant/message；partial/unavailable 显式标记，F14 不得把 partial 当完整成本。
- schema v14 会拒绝 v13 作品；按项目政策重建测试作品，无迁移。
- 记录不存 prompt/正文，只存字符数；书籍导出不含调用记录。
- 观测写入失败只 warning，不影响派发；F14 需把缺行视为未知而非零成本。
