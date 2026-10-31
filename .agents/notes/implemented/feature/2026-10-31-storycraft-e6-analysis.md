# Agent Note: 故事工坊：E6 分析

Status: implemented

工作项：当前任务 E6（不新建 GitHub issue）。产品范围与验收归本 Note；依赖 A10、F8 已交付。

## Problem

作者能在看板看到进度、伏笔和摘要，但看不到：

- 字数与节奏趋势（重复句、AI 短语、对话比例）；
- 审稿问题在各章的分布（严重度、类别、未处理/已解决）；
- 调用成本按角色/模型的分布（看板目前只显示调用次数/token 总数，未按角色/模型展开）；
- 这些数据目前要逐章打开审稿/正文，无法形成全书视图。

E6 要求“字数/节奏/审稿问题分布/调用成本”。B1/B2 是新的导入/检索能力，E6 只需读现有状态。

## 对拍参考

- `inkos-master/packages/core/src/utils/analytics.ts:24-35`：按章节聚合 token；参考以章节结果/统计对象呈现成本；
- `inkos-master/packages/core/src/agents/continuity.ts:16-101`：审稿返回结构化问题与 tokenUsage；
- `inkos-master/packages/core/src/__tests__/artifact-methods.flow.test.ts` 与 `critique` 相关测试：确定性节奏检查是程序规则，不交给模型；
- 本项目 `src/critique.ts` 已有 words/chars/sentences/repeated/aiPhrases/dialogueRatio；`src/telemetry.ts` 已有调用行。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 按章聚合 token | `/analysis` 按 role/model 聚合 `model_calls` | 面板需要角色/模型分布，章节字数已在看板 | 等价适配 | 聚合测试 |
| 审稿结构化问题 | 取每章最新审稿的 observations，按 severity/category 计数 | 避免历史轮次重复计数 | 收窄 | 分布测试 |
| 参考无独立分析面板 | 看板内懒加载“分析”段，不新增第 8 标签 | 保持七标签信息架构 | 新增 | E2E |
| 参考成本含金额 | 只显示 token/次数/耗时，不换算金额 | F8 作者裁决只记 token | 不采用金额 | 成本卡 |

## Decision

### 看板内懒加载

在看板“摘要”段之后增加 **分析** 段：

- 默认折叠，点“展开分析”才请求 `/analysis`；
- 不新增主标签、不新增模型工具、不改 schema；
- 展开后按需加载，失败可重试。

### `/analysis` 数据

新增只读 `GET /api/see-storycraft/analysis?root&id`：

- **words 不重复返回**：看板已经加载 `status.chapters`，分析段直接用客户端已有的 words/stage，不调用 `status()`、不调用 `readDashboard`；
- `reviews`：一条 SQL 取每章最新 review（与 `openProblemCountByChapter` 相同的 latest 语义），只统计 `assessment==='issue'` 的 observation：
  - `issues.total` 必须等于 `story_status.openProblems` 的总和；
  - `bySeverity`：blocking/major/minor + `unspecified`（severity 可选，缺失归入这个桶，不能丢）；
  - `byCategory`：execution/quality/scope（category 必填）；
  - 另给 `resolved` 数量；不累加历史轮次、不返回 observation 正文；
- `calls`：扩展 `callSummary` 的单次 `model_calls` 读取，按 role/model 分组（不新增平行查询），返回 count、totalDurationMs、totalTokens（无 usage 为 null）、callsWithoutUsage；model 缺失归“未记录”；不再调用 `status()`；
- 不返回正文、摘要正文或审稿原文；分析路由只含计数与聚合，不含章节全文。

### 性能与数据边界

- `/analysis` 固定两次只读查询：最新 review 一次、`model_calls` 聚合一次，不逐章打开数据库；
- 复用 F13 的 250 章 fixture，`/analysis` DTO 读取预算 **<300ms**；测试断言响应不含正文/审稿文本；
- 响应只含按章计数与 role/model 小聚合，不随章节正文增长。

### 节奏

不批量扫描全书正文。作者在分析段选择一章，点“查看节奏”，调用现有 `GET /critique`：

- 显示 words/chars、平均/最长句、repeated、aiPhrases、dialogueRatio；
- 与写手/审稿使用的同一 `critique` 规则，不另写一套；
- 一次只读一章正文，避免 250 章首屏成本。

### 客户端

- 分析段为 `<details>` 或按钮展开，状态机 idle/loading/error/ready；
- 审稿分布用计数行（不引入图表库），成本按 role/model 分组；
- 无数据时显示“还没有审稿/调用”；
- 分析状态必须按 `workId` 重置（组件不按作品重新挂载），切换作品不能显示上一部的分析；
- 复用现有 `sc-dash-section` 样式，不引入图表库；README 的路由表与工作台说明同步 `/analysis`。

## Alternatives considered

**A. 新增第 8 个“分析”标签。** 最强理由是入口最清晰。否决原因：七标签已在窄屏接近上限，E6 是看板的延伸；懒加载段更符合“先看全局再展开”。

**B. 在 `/dashboard` 一次返回所有分析。** 最强理由是一次请求简单。否决原因：成本/审稿分布会放大每次看板加载；分析是低频操作，单独路由更轻。

**C. 全书批量算节奏。** 最强理由是无需选章。否决原因：要读所有正文，250 章会拖慢面板；节奏本来就适合按章查看。

**D. 显示金额。** 最强理由是最直观。否决原因：F8 只记 token/model，没有价格表；金额需要供应商定价，属于后续决定。

## Testing

- `tests/analysis.test.mjs`：最新审稿与 openProblems 对齐、severity unspecified、category、resolved、role/model 与 null usage、空作品、无正文/审稿文本。
- `tests/store-perf.test.mjs`：250 章 analysis 单次读取 <300ms，响应只含计数。
- `e2e/analysis.spec.cjs`：展开前不请求 /analysis、审稿/成本分布、按章节奏只请求一次 /critique、空状态。
- 完整 CI：88 单元 + 37 E2E。

## Consequences

- 审稿分布只取最新轮，历史问题的演化看不到；这与“当前需要处理什么”一致；
- 成本按 token，不显示金额；usage 缺失时只能显示未知，不能当零；
- 分析懒加载多一次请求；首屏不加载；
- 节奏按章读取正文，频繁点击会增加读库次数；一次一页，无缓存。
