---
title: 故事工坊：语义状态对账（只读检查）
status: implemented
created: 2026-10-23
updated: 2026-10-23
verification: 36 单测全过（含 state-check/submission/tools/skills）；all 挂载 10 个技能、review 2 个；docs check 通过；E2E 未跑
---

# Agent Note：故事工坊：语义状态对账（只读检查）

## 问题

R9 的 `state-validation.js` 只做确定性检查：重复事实 warning、伏笔状态机、二次归档拒绝。它无法判断一条事实是否被本章正文支持、伏笔状态是否被正文推进，也无法发现正文里发生的重要变化没有写进 delta。

2026-10-23 对 `works/大朔营造` 的三章做了小样本核对：这些 delta 都已通过 R9 预检并落库，但仍有 6 条事实不支持、2 条伏笔状态错误，每章还有 3 条以上重要变化没有记录。确定性层全部放过，说明语义对账不是重复劳动。

## 测量

方法与样本：

- 作品：`works/大朔营造`（legacy 文件作品，11 章已写、9 章已定稿）。
- 样本：第 1 章 r2、第 4 章 r5、第 8 章 r4；各取该章 `state/events.jsonl` 的 entity/hook 记录。
- 判定：每章一个只读核对子代理，逐条判断「正文明确支持 / 正文矛盾或没有 / 只能推断」，并另列 3 条未记录的重要变化；不做改写。
- 限制：单作品、3 章、每章单次判定、无第二评判者；结果只说明方向，不是总体比例。

| 指标 | 第 1 章 | 第 4 章 | 第 8 章 | 合计 |
| --- | --- | --- | --- | --- |
| 事实 | 14 支持 / 3 不支持 / 4 模糊 | 21 / 3 / 2 | 18 / 0 / 5 | 53 / 6 / 11（70 条） |
| 伏笔 | 3 支持 / 0 不支持 / 2 模糊 | 3 / 2 / 2 | 7 / 0 / 1 | 13 / 2 / 5（20 条） |
| 未记录的重要变化 | 3 | 3 | 3+ | 每章至少 3 条 |

错误类型集中在：说话人归属（谁说的、谁做的）、给人物加了正文没有的动机、数字/人数/引语走样、伏笔状态该 `resolved` 却记成 `used`、重要变化漏记。它们都能通过实体名与字符串检查，只有语义判断能发现。

同时，三章里有大量合法的归一化（「自称能磨」「用掉一份」「少两块半」）；如果按严格字面判断，会把它们误报成错误。因此结果必须是**建议性**的，且允许「模糊」而不是强行二分。

## 决定

### 1. 只读动作 `story_state_check`

新增 `story_state_check(work, chapter, entities?, hooks?)`，实现位于 `state-check.js`，注册在 `tools.js`（动作总数 30→31）：

```text
只允许主会话调用；子代理调用返回 state-check-parent-denied
→ 空 delta / 缺正文 / 已定稿分别返回 empty-state / chapter-not-written / chapter-settled
→ normalizeStateDelta + validateStateDelta；error 直接返回，不启动子代理
→ 读当前正文、当前摘要（若 current；不要求先存在）、章纲（缺失则省略）、delta 涉及的人物卡、折叠前状态
→ 启动一个 validator 子代理
→ 子代理通过 story_submit 提交 findings
→ 父代理复核正文 revision；变了返回 state-check-stale
→ 返回紧凑 items；不写 events、不改阶段、不写摘要
```

输出含 `checked`、`revision`、最多 8 条 `items`、`counts`、`warnings`、`durationMs`；`items` 带 `evidenceVerified`。正文是唯一事实证据，摘要、章纲、旧投影只作上下文。没有发现时 `items: []`，只表示本次未观察到不一致。

### 2. 检查项与建议性

| code | 含义 | 默认严重度 |
| --- | --- | --- |
| `fact-unsupported` | 正文矛盾，或正文没有这件事 | major |
| `fact-ambiguous` | 正文只能推断，不能明确支持 | minor |
| `missing-change` | 正文发生重要变化，delta 没记 | major / minor 按影响 |
| `hook-state-mismatch` | 正文支持的状态与 proposed 状态不同 | major |
| `hook-evidence-weak` | 伏笔状态变化只有暗示 | minor |

- 不重审旧投影里已存在的事实；只核对本次 delta。
- `missing-change` 至多 3 条，没有正文引文不得提交；`submission.js` 对 `missing-change` + `无对应段落` 直接拒绝。
- 宿主对 `evidence` 做正文包含校验（空白归一化）；对不上标 `evidenceVerified: false` 并加 `evidence-unverified`，不丢条目；`无对应段落` 为 `null`。
- 所有发现都是建议，`story_state` 仍是唯一写入口；没有自动改写、自动重试或自动重投影。

### 3. 子代理与提交

新增 `storycraft-state-check` 技能（`review` 目录），只定义判断标准、证据要求、模糊与不支持的区别、输出契约。

`story_submit` 增加 `validator` 角色，payload 为 `{items:[{code,where,problem,evidence,impact,severity,fix}]}`；最多 8 条，字段上限 120/160/240/120/120，severity 只有 `major` / `minor`，尝试上限 3 次。技能在 `all` 挂载后为 10 个，`review` 目录为 2 个。

### 4. 共用子代理启动助手

`delegate.js` 提取 `assertChildAvailability` 与 `runChild`；`runChild` 返回 `{result, dispose}`，调用方在 consume/落盘之后 dispose，保持既有委派顺序。`delegateRole` 与 `runStateCheck` 共用启动、超时、取消与失败映射；既有 `delegate.test.mjs` 全过。

### 5. 失败与成本

- 无服务 `state-check-unavailable`、超时/异常 `state-check-failed`、无合格提交 `state-check-no-submission`；失败绝不退化为「干净」。
- 超时上限 180 秒；每次只跑一个子代理，不自动重试整轮。
- 只有显式调用才产生一次模型调用；`story_state` 内部没有新增 LLM。

### 6. 与 R11 的衔接

R9b 的 validator 核心供 R11 复用。R11 落地时的自动链路：settler 抽取 delta → 复用本项的 normalize/validate 与 validator → 有可重算差异时带 findings 重算一次 → 仍不一致或 validator 不可用则保留旧投影、不自动定稿、返回 observations → 只有重算后一致才 fold 并定稿。

与 InkOS 的差异：InkOS 在未解决时仍落盘章节、保留旧状态；我们的阶段机把定稿和状态写入绑在一起，因此未解决时不自动定稿，避免出现 `settled` 但状态未应用的章节。

## 备选方案

- **把校验塞进 `story_state`，自动加一次 LLM 调用**：每次定稿都付费、失败策略与写事务耦合，且容易把建议误当阻断；本项改为显式只读动作。否决。
- **只让 reviewer 在审稿时顺带查状态**：reviewer 看得到正文与旧状态，但看不到尚未提交的 delta，无法核对本次新增事实与伏笔状态。否决为主路径，保留为后续补充。
- **要求每条事实带正文引文，做确定性匹配**：改事实 schema，旧数据与既有测试全要迁移，且引文正确不代表语义归属正确。否决。
- **宿主直接调 `ctx.llm`**：少一层子代理，但引入直接模型依赖、输出解析与另一套失败路径。否决。
- **自动重投影/自动改 delta**：会掩盖作者判断，且当前没有 settler；R11 再谈。否决。

## 后果

1. 主编可以在定稿前显式运行只读检查，得到带正文引文的建议性 findings；是否修改 delta 由主编/作者决定。
2. `story_state`、`story_delegate`、阶段机、落盘路径无行为变化；短篇、剧本不走这条检查。
3. 每次检查多一次模型调用；不自动调用，由主编在改完 delta 后显式运行。
4. 语义判断仍有主观性；对话无提示语、跨章承接、合法归一化会造成误报，因此只出 advisory，允许 `fact-ambiguous`。
5. `missing-change` 不是完整抽取，不能替代 R11 settler。
6. 显式动作依赖主编记得调用；技能点名与回执可见性只能降低漏跑，不能证明每次运行。
7. R11 接自动链路时，未解决不定稿是刻意差异，避免 `settled` 但状态未应用。

## 验证

- `node storycraft/scripts/ci.mjs --no-e2e`：36 个单测文件全过；新增 `state-check.test.mjs`，既有 35 个不回归。
- `state-check.test.mjs`：只读（events/stage/revision/摘要不变）、主会话限定、确定性短路、findings 与计数、引文校验 true/false/null、重复事实 warning、正文改版 stale、缺正文/已定稿/空 delta、无服务/超时/无提交/坏 payload、缺章纲仍可检查、prompt 不含其他章正文或路径。
- `submission.test.mjs`：validator 形状、字段上限、missing-change 引文要求、空/非空 payload、3 次尝试上限。
- `tools.test.mjs`：动作总数 31、输出 schema、子代理调用 `state-check-parent-denied`。
- `skills.test.mjs`：`all` 10 个、`review` 2 个，`storycraft-state-check` 被挂载。
- `node scripts/decisions/check.mjs` 通过。
- `package.json` 的 `files` 已包含 `state-check.js`；README、对拍矩阵、路线图已同步。
- E2E 未跑：本机 Playwright/DSH 登录弹窗仍阻塞，不能声称 E2E 通过。
