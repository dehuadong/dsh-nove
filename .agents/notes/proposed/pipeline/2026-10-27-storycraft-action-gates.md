---
title: 故事工坊：动作分类、交互闸门与载体分工
status: proposed
created: 2026-10-27
updated: 2026-10-27
---

# Agent Note：故事工坊：动作分类、交互闸门与载体分工

## 问题

流水线把三种东西混成了一个词「闸门」：

- **能自动判定的**（有没有正文、章纲批没批、审稿是否干净）被做成了面板按钮；
- **必须和人商量的**（审稿条目取舍、修订范围、正文是否接受）被做成了自动文案，「已确认，继续」一点就跑完整章；
- **作者自己在面板上的操作**（导出、删除、重排）被列进了「确认点」。

后果在 #50 的验收里都出现过：一次章纲确认驱动整章生产，审稿—修订四轮不收敛，结算失败后手写状态。根因不是某个工具，而是**没有区分“谁有资格判定”**。

## 对拍参考

- `inkos-master/docs/harness-result-first-redesign.md`：记录两条做法——「自然语言与确认入口共用转换函数」「确认动作的可见范围与执行策略共用判断」。**采纳**：同一个作者决定，无论从对话还是面板进来，都写同一个事件；判定逻辑只有一份。
- 同一文档记录的真实缺陷：「多余确认、重复提示词」「复合创作请求在局部动作成功后提前结束」。**作为反例**：本设计禁止“自动继续”文案，也禁止把一步决定拆成多次确认。
- 本仓库既有决定：#14 / #15（作者闸门在宿主侧，模型不能代签）、#66（面板统一状态模型）、#76（确认文案与修订上限）、#50 验收报告（D6/D8/D11）。

## 提案

四类动作，按“谁有资格判定”分。

| 类别 | 判定者 | 动作 | 交互 | 违反时 |
| --- | --- | --- | --- | --- |
| 只读 | 无 | `story_next` `story_status` `story_read` `story_brief` `story_context` `story_state_check` `story_current` | 随时调用 | — |
| 协议闸门 | 宿主 | `story_write` `story_review` `story_revise` `story_summarize` `story_settle` `story_plan` `story_outline` | 无 | `not-next-action` / 既有前置错误码 / `revision-limit` |
| 判断点 | 作者（对话） | 提案、基础设定、全书计划、章纲、**审稿取舍、修订范围与 mode、正文验收、结算失败处理、章间是否继续** | 主编摆材料 → 作者实质决定 | 不得自动推进 |
| 面板操作 | 作者（界面） | 导出、备份/恢复、重命名、删除作品、章节上移/下移/删除、真值编辑、素材导入、刷新 | 作者自己点 | 主编不代劳、不在对话里请示 |

### 协议闸门（宿主自动，零交互）

每个动作执行前，宿主比对 `story_next` 的当前动作；不在当前步骤即 `not-next-action`，并回执“现在应做的是 X”。`story_revise` 另加轮次上限（3 轮），到顶后在派发子代理之前就拒绝（`revision-limit`），由作者裁决。

### 判断点（九处，必须沟通）

下表是**协议的形状**，不是技能正文：每个节点的材料与问题由宿主按当前状态生成（`story_next` 回执的 `ask` 字段），技能只保留“怎么判断、怎么谈”的原则。理由与对拍证据见「知识放置」。

| 判断点 | 摆什么 | 问什么 |
| --- | --- | --- |
| 提案 → 立项 | 一句话故事、人物、冲突、篇幅与禁区 | 这个方向要不要立 |
| 基础设定 | 故事框架、卷图、作品规则、角色卡要点 | 哪份要改，还是可以进入计划 |
| 全书计划 | 主线、卷划分、结局方向 | 按这个写章纲吗 |
| 章纲 | 视角、目标、阻力、代价、结尾变化各一句 | 写正文，还是先改哪一项 |
| 审稿 | 每条 id、一句话、severity、建议改法 | 哪几条改、哪几条不改 |
| 修订 | 选中的条目、mode 与理由 | 范围与模式确认吗 |
| 正文验收 | 字数、版本、与前版差别（≤3 条） | 接受，还是继续改 |
| 结算失败 | findings 原样（含 severity 与 fix） | 修 payload 重试，还是先停 |
| 章间 | 下一章章纲要点 | 开始下一章，还是先停 |

规则：一次只问一个决定；作者没表态不得推进；作者说“可以”只放行一个动作。

### 面板操作（作者的事）

导出、备份/恢复、重命名、删除、重排、真值编辑、素材导入、刷新都属于这一层：拓扑上它们不改变阶段，也不需要主编同意。主编只在被问到时说入口。

## 载体分工与内容要求

对拍证据：`inkos-master/packages/core/src/agents/writer-prompts.ts` 首行——「Writer protocol. Narrative craft comes from the active long-writing Skill.」；同目录另有 `planner-prompts.ts`、`settler-prompts.ts`，`src/prompts/` 放阶段提示词。即**协议在代码里按节点组装，craft 在技能里常驻**。

每种载体装什么、不装什么，是本提案的主体，不只是“代码 vs 技能”两句：

| 载体 | 装什么 | 不装什么 | 本项目的落点 |
| --- | --- | --- | --- |
| **代码** | 闸门、顺序、上限、前置校验、错误码 | 创作判断、措辞、节点材料 | `tools.ts` 的 `NEXT_ACTION_GATES`、`delegate.ts` 的 `ROLE_ACTION`、`store-db.ts` 的 `MAX_REVISION_ROUNDS` |
| **宿主拼接的提示词** | 该节点的材料、约束、要问的问题、失败回退 | 通用方法、长期记忆、跨节点规则 | `story_next` 的 `ask`；角色侧 `role-input.ts` + `promptFor` |
| **技能（常驻）** | 方法、判断标准、语气、边界（“什么样的意见值得改”） | 节点操作步骤、闸门条件、字段清单、模板 | `storycraft-long-writing`、`storycraft-review`、`storycraft-revise-craft` |
| **references（按需）** | 模板、清单、样例、字段表 | 判定逻辑、跨节点规则 | 各技能 `references/*.md` |
| **产物** | 正文、章纲、真值、事件 | 过程性说明 | `.storycraft/works/*.db` |

反例（本提案修正的对象）：把「blocked 非空时不要执行」写进技能——那是闸门，应由代码拒绝；把判断点表写进技能——那是逐节点协议，写进常驻技能会让所有节点变成同一份说明。

### 每个节点的上下文由什么组成

| 节点 | 材料（宿主） | 问什么（宿主 ask） | 方法（技能） | 细则（references） |
| --- | --- | --- | --- | --- |
| 全书计划 | 基础设定四份、字数范围、章数 | 按这个写章纲吗 | `storycraft-plan-craft` | — |
| 章纲 | 全书计划、前章摘要、角色卡 | 写正文，还是先改哪一项 | `storycraft-plan-craft` | — |
| 正文 | 章纲、装配上下文、字数范围 | —（写完进验收） | `storycraft-write-craft` | 长篇再加方法参考 |
| 审稿 | 正文、章纲、既有事实 | 哪几条改、哪几条不改 | `storycraft-review` | — |
| 修订 | 选中条目、mode、原正文 | 范围与模式确认吗 | `storycraft-revise-craft` | — |
| 摘要 | 正文 | — | — | 摘要字段表 |
| 结算 | 正文、事件、拟写 payload | 失败时 findings 原样 | `storycraft-state-settler` | `state-projection` |
| 正文验收 | 字数、版本、与前版差别 | 接受，还是继续改 | — | — |

这张表的每一行都是**宿主按状态生成**的输入，不是技能里的说明。

## 技能重组：按形态 × 节点

### 问题（实测）

- `storycraft-write-craft` 一份覆盖三种形态，任何形态都整份加载 → 误判、歧义、白占上下文；
- `storycraft-plan-craft` 覆盖两种形态、两种方向（「出全书计划 / 划卷 / 种初始伏笔」与「写章纲 / 判断一章是否成立」），同一个毛病；
- `storycraft-long-writing` 的四份 references 实际不会全加载，但技能正文没有说明“何时加载哪一份”；
- `storycraft-studio-orchestration` 把工具用法（`story_current`）、动作规则（`story_plan`）与阶段判断混在一处，没有说明哪些属于技能、哪些属于阶段脚本。

### 对拍证据

- `inkos-master/packages/core/skills/inkos-long-writing/SKILL.md`：**按形态**一份 craft；正文末尾逐条写明加载条件——`references/foundation-design.md` 用于创建或重建基础设定，`reader-contract-and-progression.md` 用于规划、写作、审稿、修订章节，`state-projection.md` 用于观察已完成章节或结算真值。同目录 `planner-prompts.ts` / `writer-prompts.ts` / `settler-prompts.ts` 承担角色协议。
- `dsh-webnovel-writer/packages/bundle/skills/`：**按节点**切分（`novel-design` / `novel-outline` / `novel-drafting` / `novel-review` / `novel-revision` / `novel-polish` / `novel-settle` / `novel-director` / `novel-export`），单形态。

### 提案

采纳两者并集：**形态做技能，节点做 reference，加载单元是（形态 × 节点）**。

```
skills/
  long/    SKILL.md（craft） + references/{foundation, chapter-plan, prose, review, revise, settle}.md
  short/   SKILL.md（craft） + references/{outline, batch-draft, review, revision-plan, package}.md
  script/  SKILL.md（craft） + references/{spec, script, scene-set}.md
```

加载规则写进每个 `SKILL.md` 尾部（与 inkos 同构）：基础设定/全书计划 → `foundation`；章纲 → `chapter-plan`；正文 → `prose`；审稿 → `review`；修订 → `revise`；结算 → `settle`。**不在节点上的 reference 不加载。**

角色契约（writer / reviewer / reviser / summarizer / planner）不再写成技能：由 `promptFor` 按（形态 × 节点）组装，与 inkos 的 `writer-prompts.ts` 同构。

编排技能只留“怎么判断、怎么谈”的原则；工具用法进 tool description，阶段规则进 `story_next.ask`。

### 验收

- 检索技能目录，不存在覆盖两种以上形态的 craft 技能；
- 每个 `SKILL.md` 末尾有按节点的加载条件；
- 真实链路中，写手/审稿/修订三次派发的上下文里只出现对应节点的方法与参考（`trace` 可核）。

### 规范符合性（按项目技能编写规范）

规范：`skills/<skill-name>/` 扁平 kebab-case；`SKILL.md` 必填，`scripts/`、`references/`、`examples/` 可选；front matter 只有 `name`（与目录一致）与 `description`（做什么 + 何时触发 + 读/写边界）；主文件只留决策流程，细节进 `references/`；一个技能一个目标，读写模式显式分流；写操作先出计划并取得确认；改完跑 `node scripts/validate.mjs`。

| 要求 | 现状 | 违反数 |
| --- | --- | --- |
| 扁平目录 | 8 个类别子目录（longform/plan/review/revise/screenplay/shared/shortform/write） | 15 / 15 |
| front matter 仅 name + description | 15 个都多一个 `whenToUse`；description 缺触发与读写边界 | 15 / 15 |
| 主文件只含决策流程 | `studio-orchestration` 9.9KB、`longform-chapter` 8KB、`review` 4.5KB，后两者 refs=0 | 3 |
| 一个技能一个目标 | `write-craft` 覆盖三形态；`plan-craft` 两形态 × 两方向 | 2 |
| 写侧先出计划并取得确认 | 写/修订技能未声明 | 写侧全部 |
| `validate.mjs` | 无技能校验器（仅有 Note 的 `decisions/check.mjs`） | 缺失 |

修复：扁平化、front matter 规范化、主文件拆到 references、拆多目标技能、写侧加确认、新增 `storycraft/scripts/validate-skills.mjs` 并接进 `ci.mjs`。

## 三个批准记录在哪里

基础设定 / 全书计划 / 章纲的「批准」是判断点的结果，不是闸门：

- 面板点击与会话中的实质认可**写同一个事件**（`approvedAt` + 来源）；
- 模型不得自行判定通过，也不得把“没有反对”当作同意；
- 当前实现只开了面板入口；对话入口是否需要，见「未决」。

## 与当前实现的差距

| 项 | 状态 |
| --- | --- |
| 协议闸门（写/审/修 + 上限） | 已实现（`7dfc63e`） |
| 正文验收的出口（接受当前版本） | 已实现（`8fb6f11`） |
| 确认后停止 | 已实现（`0d8c3a5`） |
| 判断点协议的位置 | **未做，且当前放错**：表写进了常驻技能，应改由 `story_next` 的 `ask` 按状态返回（`af60ed3` 是错误示范） |
| 技能里的闸门文字 | 未做：`blocked 非空时不要执行` 应由代码拒绝，从技能删除 |
| 面板操作与判断点在 UI 上分开 | 未做：状态卡仍可能与工具入口并列 |
| 批准事件的来源记录 | 未做：只有 `approvedAt`，没有“谁、从哪来” |
| 审稿条目口径（severity 与上限） | 未做：一轮 5–8 条是 D6 的另一半 |

## 验收条件

- 单元：闸门错误码、修订上限、接受后转摘要、`not-next-action` 时状态不变；
- E2E：状态卡只出现判断点动作；导出/删除/重排仍在各自入口，不进入状态卡；
- 真实链路（#50 重跑）：确认后停在原地、审稿先给清单再问、修订不越范围、结算失败会停。

## 风险

- **判断点过多**：九个点都摆材料会让对话变长；缓解是一次只问一个决定、材料限三条以内。
- **作者负担转移**：审稿一轮 5–8 条直接抛给作者等于把筛选工作外包；需要审稿侧先按 severity 收口（D6 另一半）。
- **批准来源不可证**：只有 `approvedAt` 时无法区分面板点击与会话决定；若开放对话入口，必须先解决归因。
- **状态卡与工具入口混排**：导出等操作若仍在状态卡里，会被读成“下一步必须做的事”。
- **闸门可绕过**：直接改库或手动 `story_state` 会跳过闸门；沿用既有口径——只在作者明确要求时使用，并记录原因。

## 备选方案

- **A. 每步人工确认**（面板点或对话说“继续”）：控制最细，但机械、token 贵，且正是 #50 里出现的“多余确认”。否决。
- **B. 全自动跑完一章再交人**：最省对话，但越过审稿取舍与修订范围两个判断点，D11 的失控由此而来。否决。
- **C. 本提案**：协议闸门自动判定、九个判断点必须沟通、面板操作独立成层。采纳。

## 未决

1. 批准是否开放对话入口（当前只有面板）。开放则要解决“如何证明是作者而不是模型的决定”。
2. 审稿器一轮 5–8 条是否需要设上限与严重度门槛。
3. 正文验收：现在是「接受当前版本」按钮，是否也要能“接受并继续下一章”。

## 引用

- 工作项：`#77`（本 Note 的产品合同与验收）
- 相关：`#50`（验收发现 D6/D8/D11）、`#76`（确认文案与修订上限）、`#66`（面板状态模型）
