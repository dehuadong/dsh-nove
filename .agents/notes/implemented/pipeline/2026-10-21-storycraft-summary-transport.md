---
title: 故事工坊：章节摘要的角色提交通道
status: implemented
created: 2026-10-21
updated: 2026-10-21
verification: e0992f9；23 个单测 + 11 条 E2E；真实第 4 章摘要窗口 591 字符、整轮 2,735、summaryChars 317、0 次 story_read
---

# Agent Note：故事工坊：章节摘要的角色提交通道

> 2026-10-21 部分修订：摘要绑定正文 revision、过期识别与迁移由 [摘要 revision 绑定](../../proposed/pipeline/2026-10-21-storycraft-summary-revision-binding.md) 承接；本 Note 的 `summary-exists` 语义改为“当前版本已有摘要”，`nextStep`/`hasSummary` 的旧描述以新 Note 为准。

## 问题

真实单章链路（`session-91e3c83e`）里，主编在写摘要前调用 `story_read` 把整章读回主会话：

- 第 1 章：`story_read` 结果 2,224 字符，随后 `story_summarize` 写 220 字；
- 第 2、3 章：同一模式，摘要步骤都要先读整章；
- 摘要步骤不在 #19 AC6 的窗口内（AC3 把 summary/state 排除），所以它不是 #19 的失败项，但它是主会话里最后一块整章正文。

参考实现把摘要放在修订后的独立 settler 里：`WriterAgent.settleChapterState` 读取最终正文，产出 `chapterSummary`，宿主持久化，`Composer` 之后按需选择章节摘要。它不是主编读全文后手写。

摘要没有绑定正文 revision 是既有缺口；本项不改 `summaries` 表结构，也不引入 schema 迁移，绑定与过期判断另立工单。

## 与既有记录

- 承接 #23 的 `story_submit` / SubmissionStore 通道；本项**扩展** `2026-10-20-storycraft-role-submission.md` §2/§2.1/§7 的角色枚举、payload 与错误码，writer/reviewer/reviser 契约不变。
- 扩展 `2026-10-20-storycraft-host-delegation.md` 的角色枚举、预检与回执；其“delegate 只在预检会通过时出现”继续适用于第四个角色。
- 交付时同步 `implemented/pipeline/2026-10-18-storycraft-role-agents.md` 与 `implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md` 的角色清单；新增 `summarizer`，原三角色不变；规划阶段不改已交付记录。
- 摘要阶段的读取范围沿用 `2026-10-20-storycraft-artifact-identity.md` §3「摘要/定稿只读当前章与 `state`」；本项不新增 `章纲`、人物卡或旧章正文。交付时把该行改为「`story_next` → `story_delegate`，正文不进入主会话」，并同步其 AC4。
- 部分替代 `2026-10-20-storycraft-production-parity.md` 中“摘要由主编手写”的当前做法；不替代 `story_state` 的 fact/hook 折叠，本项不引入自动 settler。
- 不改变 `story_summarize` 的 artifact 身份（`summary:<n>`，内容哈希）。
- 对拍表 `2026-10-18-storycraft-parity-matrix.md` 的「卷/摘要/滚动」与「上下文/token 治理」两行随本项同步。

## 决定

### 1. 角色与工具契约

`story_delegate` 的 `role` 增加 `summarizer`，与 writer / reviewer / reviser 共用 `story_submit` 与 3 次提交上限。

**派发前置**（`preflight` 与 `story_next` 使用同一组条件，保证阶段与摘要前置不会失败；`task-required` 等其他既有失败原样透传，summarizer 豁免人物卡门槛）：

| 条件 | 结果 |
| --- | --- |
| 章节不存在或 `currentRevision === 0` | `chapter-not-written` |
| 已有非空摘要文本 | `summary-exists`（作者的主动重写走手动 `story_summarize`） |
| 阶段 `revised`，摘要缺失或为空 | 允许 |
| 阶段 `reviewed`，最新审稿是清稿（零问题）、且审稿 `revision === currentRevision`，摘要缺失或为空 | 允许 |
| 阶段 `settled`，摘要缺失或为空 | 允许 |
| 其他阶段、审稿不干净、审稿针对旧版本 | `review-required` |

`story_next` 只在“允许”条件下返回 `delegate: { role: 'summarizer' }`；已定稿补摘要路径同样适用。

**提交契约**：

- payload `{ summary }`；先 `trim`，再按 trim 后的 Unicode code point 计数，非空且最多 400（复用 `SUMMARY_MAX_CHARS` 与手动路径的同一实现）。
- 失败 envelope：空/缺字段 `submit-invalid`；超长 `submit-summary-range`（带 `actual: "N 字"`、`limit: "≤400 字"`）；都 `retryable: true`，不消费 entry。
- 每次调用计入 3 次尝试；第 3 次仍失败返回 `submit-attempts-exhausted`，父代理最终只看到 `delegation-no-submission`。
- 成功 envelope 沿用现有 `{ok, submitted, bytes, words}`；摘要长度由宿主在回执里给 `summaryChars`，不改 `SUBMIT_OUTPUT`。

**回执**（沿用 #22 的 artifact 身份，不嵌套 `summary`）：

```json
{
  "ok": true,
  "workId": "…",
  "chapter": 3,
  "role": "summarizer",
  "stage": "revised",
  "artifact": { "workId": "…", "artifactId": "summary:3", "revisionId": "<内容哈希>", "kind": "summary" },
  "summaryChars": 234,
  "submissionAttempts": 1
}
```

回执不含摘要正文，也不含 `path`；`summaryChars` 是 code point 数，与 400 上限同一口径。

**枚举与 schema**：`NEXT_OUTPUT.delegate.role`、`DELEGATE_OUTPUT.role`、`story_delegate` 的参数枚举增加 summarizer；`DELEGATE_OUTPUT` 增加 `summaryChars`；`SUBMIT_OUTPUT` 不变；`story_context` 的 role 枚举保持不变（summarizer 只走委派）；动作总数仍 30。

**面板固定指令**：`client.js` 的摘要按钮改为“先 `story_next`；只有返回 `delegate.role=summarizer` 才用 `story_delegate`；否则不读正文，回报「摘要已存在或当前阶段不需要摘要，重写请明确要求」”。「一路做完」指令同样补一句：摘要步骤委派不可用/未提交时只报告停手，不自动转手动、不重派。

**技能同步**：编排技能的「手动兜底」小节把 summarizer 的手动兜底列设为「—（仅作者显式要求时由主编手动写）」，并写明摘要步骤只在作者显式要求时读取正文。

### 2. 上下文

`loadRoleInput` / `assembleRoleContext` 增加 summarizer 分支，只给摘要阶段必需的段：

- 当前章正文（current revision）；
- 当前 `state`（人物事实与伏笔口径）；
- 元信息：权威顺序与任务段；
- 不提供：章纲、人物卡、审稿条目、风格标准、硬约束里的本书意图/主角语气/字数、上一章正文尾巴、旧章摘要；`characters` 缺失不阻断 summarizer（`context.js` 的人物卡门槛对 summarizer 豁免）。

实现要落到这些固定接缝，漏一处会让角色被拒或输出 schema 失败：

1. `delegate.js` 的 `ROLE_META`（label，无技能）与 `promptFor`（摘要契约，跳过“加载角色技能”那一行）；
2. `delegate.js` 的 `preflight` 新增 summarizer 分支（上表）与落盘分支顺序（summarizer 分支必须在 reviser 的 `{body}` 兜底之前）；
3. `role-input.js` 的正文读取条件（当前只覆盖 reviewer/reviser）；
4. `context.js` 的 `needsPlan`、`AUTHORITY[role]`（不能落到 writer 默认）、`taskText`、正文段、`recent` 段开关、`constraints` 段（summarizer 不生成）、人物卡门槛（summarizer 豁免）与空正文门槛（覆盖 summarizer）；
5. `submission.js` 的 `validateShape` 与长度校验；
6. `store-db.js` 的 `delegateOf`（`story_summarize → summarizer`）；
7. `tools.js` 的四处角色枚举、工具描述与 `DELEGATE_OUTPUT.summaryChars`；
8. `client.js` 的摘要固定指令。

`context.test.mjs` 增加一条断言：summarizer 的 section 集合恰为 `authority`、`task`、`body`、`state`（没有 `constraints`、`plan`、`recent`、`style`、`standard`）。

任务文本：`给第 N 章写摘要：只写本章发生的事实与状态变化，≤400 字；不评价、不写下一章计划。`

### 3. 宿主落盘

- 摘要写入的唯一属主是 `store-db.js` 的一个事务内函数；`SUMMARY_MAX_CHARS` 与 code point 计数规则移到 `domain.js`，`bible.writeSummary` 与 `tools.js` 都从属主读取，不再保留两套签名。
- 该函数带 `ifAbsent` 参数：手动 `story_summarize` 不传（保持现有 upsert，允许作者重写）；delegate 传 `ifAbsent: true`，事务内检查是否已有非空摘要（`trim(text) <> ''`），有则返回 `summary-exists`、不覆盖、不落盘，防住子代理运行期间作者手动写摘要的竞态。
- 子代理提交通过后，`delegateRole` 调用该函数并把 `artifact` / `summaryChars` / `submissionAttempts` 放进回执。
- 落盘失败（如 `body-not-found`、`empty-summary`、`summary-exists`）把 store 的 `StoryError` 原样返回，不包装成 `delegation-failed`，不重跑子代理。
- 不修改 `summaries` 表，不新增 revision 列；`nextStep` 与 `hasSummary` 的现有语义保持不变。

### 4. 失败与回退

| 情况 | 行为 |
| --- | --- |
| `subagents` 服务缺失 | `delegation-unavailable`；不自动改为主编读正文、不自动重派；报告后停手 |
| 子代理没有提交 | `delegation-no-submission`；不自动改为主编读正文、不自动重派；报告后停手 |
| 摘要超长/为空 | `submit-summary-range` / `submit-invalid`，子代理同轮修正，最多 3 次 |
| 摘要落盘失败 | store 错误原样返回，章节与状态不变，不自动重跑子代理 |
| 作者显式使用手动 `story_summarize` | 允许；可覆盖已有摘要，会读正文，单独记录，不计入委派路径的测量 |

### 5. 非范围与后续

- **摘要 revision 绑定与过期判断**：需要 `summaries` 增加 revision 并处理 `WORK_SCHEMA_VERSION` 升级、既有作品回填、目录/导出版本对账；本项不碰 schema，另立工单。
- 既有行为不变：摘要过期不会在 `story_next` / `story_read` / 面板被识别；这是已知缺口，不在本项验收。
- 不把 fact/hook 折叠改成自动 settler；`story_state` 仍由主编提交。
- 不改 writer / reviewer / reviser 的 payload 与落盘校验。
- 不新增动作，不改面板布局。

### 6. 验证切入点

- 单元：`node storycraft/tests/submission.test.mjs`（summarizer 形状、空、400/401 code point、尝试上限、失败 envelope 通过 `SUBMIT_OUTPUT`）、`node storycraft/tests/context.test.mjs`（summarizer section 集合恰为 authority/task/body/state）、`node storycraft/tests/delegate.test.mjs`（三条 `story_next` 路径、preflight、回执、`summaryChars`、错误透传）、`node storycraft/tests/store-db.test.mjs`（`delegateOf`、无摘要时 next 指向 summary、写入事务内 `summary-exists`）。
- E2E：`node storycraft/e2e/run.mjs` 或 `node storycraft/scripts/ci.mjs`；判定摘要按钮固定指令、`story_delegate` 角色枚举；在已摘要章节点「摘要」不产生整章 `story_read`；强制注入 `delegation-unavailable` / `delegation-no-submission` 时，主会话不出现第二次 `story_delegate`、不调用 `story_context` 取正文、不出现整章 `story_read`。
- 真实链路：在 `session-91e3c83e` 的 1200–1800 字新章上测：`story_next` 出现 `delegate.role=summarizer` 时不调用 `story_read`；窗口 ≤700，整章整轮 ≤6,311；作者显式重试单独记录。

## 备选方案

- **writer/reviser payload 直接带 summary**：少一次子代理调用，但把创作与摘要混在同一次生成里；reviser 每次修订都要重写摘要，payload 与校验会扩散到已验收的 #23 契约；否决。
- **宿主确定性摘要**：不增加模型调用，但摘要质量与事实准确性不可接受；否决。
- **新增独立动作 `story_summarize_delegate`**：与 `story_delegate` 重复，增加第 31 个动作与两套回执；否决。
- **继续主编手写摘要**：不解决整章进入主会话；否决。
- **本项一并加 revision 绑定**：需要 schema 迁移与既有作品升级，超出摘要通道范围；拆出后续工单。

## 后果

- 主会话在摘要步骤只保留 `story_next` + `story_delegate` 两个回执；摘要窗口实测 591 字符，整轮 2,735 字符（第 4 章）。
- 摘要变成一次额外子代理调用，单章总调用数上升；换来主会话不再持有整章正文。
- 手动 `story_summarize` 保留覆盖语义，作者仍可主动重写；委派路径用 `ifAbsent` 防并发覆盖。
- 已有摘要过期仍不会被识别；这是本项明确保留的既有缺口，需后续工单补齐。
- 角色接缝较多（枚举、`AUTHORITY`、`recent` 段），靠 `context.test` 的精确 section 集合与真实链路兜底。
- 面板按钮已改为委派优先；已摘要章节不显示摘要按钮。

## 验证

- `node storycraft/scripts/ci.mjs` → PASS：23 个单测文件 + 11 条 E2E。
- `node scripts/decisions/check.mjs` → PASS。
- 真实第 4 章（`session-91e3c83e`）：writer 1,278 字 → reviewer 6 条 → reviser 1,456 字 → `story_next` 给 `delegate.role: summarizer` → `story_delegate` 回执 `summary:4`、`summaryChars: 317`、`submissionAttempts: 1`；主会话 0 次 `story_read`、0 次手动摘要/正文回退；子代理最终回答均为「已提交」。
- 窗口：摘要 591 字符（≤700）；整轮工具参数+结果 2,735（≤6,311）。
