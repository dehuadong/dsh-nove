# Agent Note: 故事工坊：与参考实现的能力对拍清单

Status: proposed


> 本文件是长期跟踪表，不随交付迁移 lifecycle；能力落地后更新状态列，不另建记录。

## 问题

角色化提案只说了「主编 + 工作子代理」，没有写清**对拍范围**：参考实现里哪些角色、哪份文档要采纳，哪些只借结构、哪些暂不做。缺少这张表，切片只能按我当下的理解实现，容易漏、也容易重复造。

对拍口径：**参考实现的产物结构是规格；角色与文档可采纳；脚本、命令与动作名按我们的来**。结构差异必须写成偏差行并经作者裁决，未登记的偏差视为越界。`inkos-master` 是本项目的目标产品：产品结构与行为按它复现，运行时机制（Provider、Agent 循环、CLI、存储、调度）逐项整改为 DSH 的运行机制；不 import、不运行 inkos 代码，也不引入它自带的运行时。DSH 缺少的机制不得删能力，必须给出等价实现并逐项登记验证。不得自创参考没有的产品限制（数量上限、白名单、格式限制）；工程预算只能在消费层解决。

> 2026-10-19：角色不再各自成预设。派发由主编用官方 `subagent` 完成，角色由任务提示与技能区分；上下文由只读动作 `story_context` 交付（见 [#12](https://github.com/dehuadong/dsh-nove/issues/12)）。

> 2026-10-23 复核基线：`inkos-master` 2.0.0（无 `.git`，以 `package.json` 与源码为准）。本轮只补**方法、Skill/资源组织、Agent 编排与交接**；2.0 源码增量见 `docs/report/inkos/2.0-harness-delta.md`，研究索引见 `docs/report/inkos/readme.md`。路线图见 `workspace/2026-10-19-storycraft-roadmap.md`。

## 2026-10-23 复核结论

- **最强差距不在「有没有角色」，而在三处交接**：
  1. 委派只到 writer / reviewer / reviser / summarizer；architect、planner 没有委派角色；
  2. `story_state` 是手工写入口；R11 已有 `story_settle` 自动抽取与一次重算，未解决时不自动定稿；
  3. writer 委派硬编码「长篇小说」和长篇技能，短篇/剧本子代理拿不到形态技能。
- **Skill 不是数量问题，是资源深度与路由问题**：11 个技能覆盖主干；长篇三份方法参考（foundation / 读者承诺 / 状态投影）已在 `storycraft-longform-method`；分析与市场研究仍没有 lens/rubric。
- **不复制 InkOS 的权限层**：capability gating、`propose_action`、Profile 注入、`skills-applied` 证据是它 2.0 的宿主模型；DSH 已有自己的动作、作者闸门与委派回执，只借方法与资源组织。

### 运行时整改（逐项）

每一行都要有参考位置、DSH 落点、差异与验证；缺一行的整改不算完成。

| 参考运行时 | 参考位置 | DSH 落点 | 差异 / 约束 | 验证 |
| --- | --- | --- | --- | --- |
| Provider / 模型配置 | `packages/core/src/llm/provider.ts`、`secrets.ts` | 宿主模型与会话配置；插件不持有 provider | 不 import inkos 的 provider；模型由宿主选择 | 插件 runtime dependencies 无 provider SDK；模型调用只经子代理 |
| Agent 循环、`submitStructured`、工具调用 | `packages/core/src/agent/agent-session.ts`、`agents/architect.ts` | Subagent 回合 + `story_submit` 校验 + Plugin tool 分发 | 不复制 agent loop；结构化提交换成 `story_submit` schema | 子代理只调 `story_*`；非法 payload 被 `story_submit` 拒绝 |
| CLI 命令（outline/write/…） | `packages/cli/src/program.ts` | `story_*` 工具、面板动作、会话指令 | 不提供 inkos CLI；同等能力走工具/面板 | 每个 CLI 能力都能指到对应工具或面板动作 |
| 文件状态（`story/*.md`、runtime state） | `packages/core/src/state`、`utils/outline-paths.ts` | 工作区文件 + SQLite + artifact 注册表 | 文件布局不同；identity 与生命周期按我们的合同 | 旧 schema 拒绝；产物可读、可导出、有消费者 |
| 调度 / 队列 | `packages/core/src/pipeline/scheduler.ts` | `story_next` 推进 + 会话/工具驱动；不引入 daemon | 无后台队列；推进由会话触发 | 无常驻进程；`story_next` 每一步可解释 |
| server / Web UI | `packages/studio/src` | DSH Web 面板 Plugin Slot | 不复刻 studio server；面板走 Host/Client plugin | E2E 面板 spec 覆盖动作、刷新与不自动发送 |

## 提案

### 角色对拍

| 参考角色 | 职责 | 我们的落点 | 状态 |
| --- | --- | --- | --- |
| architect | 书级设计（世界观、卷、人物弧、初始伏笔） | 规划角色 + `story_delegate` architect 四阶段 | 已采纳：frame/rules/roles/cards 由 #44 生产；planner 仍未委派 |
| planner | 单章计划（目标/阻力/代价/变化） | 规划角色 + `story_context` + 章纲 | 部分：`story_delegate` 仍不含 planner，章纲由主编写 |
| writer | 写正文 | 写手子代理 + 形态 craft（`storycraft-*-writing`）+ 形态契约 | 已采纳：form 路由已接；定稿时由 `story_settle` 自动抽取 |
| auditor / reviewer | 审稿清单与证据 | 审稿子代理 + `storycraft-review` | 部分：已有 observation code/quote/sourceRefs；行号与前后 revision 对比仍缺 |
| reviser | 按条目改稿 | 修订者子代理 + `storycraft-revise-craft` | 已采纳：按 observation id 处理，可标 resolved |
| settler | 把事实与伏笔归档 | `story_settle` + `storycraft-state-settler` | 已采纳：定稿时自动抽取；未解决回退 `story_state` |
| continuity | 跨章连续性检查 | 并入审稿技能 | 部分：已有 observation code；跨章前后 revision 对比未做 |
| detector | AI 内容检测打分 | `story_critique` + `deslop` | 已采纳（换实现） |
| composer | 上下文选择/编译（另含多段拼接） | `story_context` 固定分段 + 8000 字符预算 | 部分：无 token 预算、语义选择与持久化 trace；拼接不做 |
| researcher / radar | 素材与趋势检索 | 材料库 + 检索 | 部分：有库与召回，无研究方法与来源 rubric |
| short-fiction | 短篇专门流水线 | `storycraft-short-story` + 同一动作 | 部分：R6b 形态路由已接；独立短篇流水线未落地 |
| script-storyboard | 剧本/分镜 | 剧本形态 | 部分：有短剧技能；独立 spec/场次流水线与分镜对象未落地 |

### 技能对拍

参考 `inkos-master/packages/core/skills` 共 20 个技能、18 份 references；我们 14 个技能、9 份 references（A0-5 共享方法落地后）。

| 参考技能（refs） | 我们的落点 | 状态 |
| --- | --- | --- |
| 长篇写法（4） | `storycraft-long-writing` + 4 refs；角色技能读共享方法 | A0-5 已合并；`storycraft-longform-method` 只留迁移别名，L 下线 |
| 短篇写法（1） | `storycraft-short-writing` + `production-checklist.md`；`storycraft-short-story` 只留形态契约 | A0-5 已落地；S 阶段接批量流水线 |
| 剧本写法（1） | `storycraft-script-writing` + `episode-scene-craft.md`；`storycraft-short-drama` 只留形态契约 | A0-5 已落地；D 阶段接 spec/场次 |
| 审稿（1） | `storycraft-review` + `review-dimensions.md` | 已采纳 |
| 状态对账（0） | `storycraft-state-check` + `story_state_check` | 已采纳：只读、advisory；R11 的 `story_settle` 已接自动 settler + 一次重算 |
| 去 AI 味（1） | `storycraft-revise-craft` + `deslop.md` | 已采纳；`deslop.md` 未在正文点名 |
| 续写（0） | 长篇「承接上一章」一句 | 部分：无正典重建、续写点 |
| 导入（1） | `story_bible_import`（仅旧 `design/` 真值） | 部分：不导入章节，`bible.js:240` 还阻断 outline |
| 长篇/短篇分析（2） | 无 | 缺失（R7） |
| 长篇/短篇市场研究（2） | 无 | 缺失、暂缓（R7b） |
| 同人 / 仿写 / 番外（3） | 无 | 缺失、暂缓（R7c） |
| 分镜 / 封面 / 翻译 / 互动影游 / Play（5） | 无 | 不适用（R8 再评估） |
| `skills/SKILL.md` 路由 | `storycraft-studio-orchestration` + 预设 persona | 部分：有单一入口，无按 form 的技能路由 |

### Skill 资源组织对拍

| 维度 | 参考实现 | 我们当前 | 状态 | 决定 |
| --- | --- | --- | --- | --- |
| 主文件 / references | 主体短，长篇 4 份，正文链接 3 份 | 14 技能 9 份；long-writing 4 份、short/script 各 1 份；9 份均有正文点名 | 已采纳 | A0-5 共享方法与角色薄契约已落地；不复制参考实现字段 |
| 激活与证据 | Profile 必需技能注入并记 `skills-applied` | `mode: all`；子代理按提示自己 `skill`，无加载证据 | 部分 | 保留模型加载；补技能名存在性测试，不复制注入层 |
| 形态→技能 | Profile 按作品类型绑定必需技能 | writer 按 `form` 追加形态技能；reviewer/reviser 按设计不加 | 部分 | writer 路由已接；reviewer/reviser 只加载角色技能；short-story 输出契约已由 R6b-fix 修正 |
| 技能来源 | 包内 + 外部目录 + 项目技能 | 插件包内技能 | 部分 | 暂不开放外部导入；先保证内置技能自洽 |
| 资源检索 | 统一检索内核按 scope/kind 检索 | `story_context` 检索段 + 材料库 | 部分 | 先做确定性召回与 trace；语义选择待 R12 |

### Agent 编排与任务交接对拍

| 交接点 | 参考实现 | 我们当前 | 差距 | 状态 | 决定 |
| --- | --- | --- | --- | --- | --- |
| 结构化提交 | 模型经 typed tool 提交，宿主校验后落盘 | `story_submit` + `submission.js` 校验 | 无 | 对齐 | 保留 |
| 委派角色 | architect / planner / writer / reviser / settler / validator | architect / writer / reviewer / reviser / summarizer / settler / validator | architect 已补；planner 仍缺 | 部分 | 补 planner |
| 作者闸门 | 计划/章纲确认 + 提案确认 | 面板确认 + 提案同意 | 无 | 对齐 | 确认后不自动发送 |
| 完成证据 | 只认 ActionResult / artifact revision | 委派回执 + revision | 回执有，artifact 证据弱 | 部分 | 回执补 artifact id/版本 |
| foundation 交接 | 三段式 submit + 原子写 story_frame/volume_map/book_rules/role cards | `story_delegate` architect 四阶段 | 已对齐 | 已采纳 | #44 |
| 章计划交接 | planner 产出 ChapterIntent + ChapterMemo | 章纲五字段 | 无独立 memo | 部分 | 保留章纲，不新增对象 |
| 上下文装配 | composer：半窗预算、语义选择、trace | `story_context` 固定段 + 8000 字符 | 无 token 预算/trace | 部分 | R12 |
| 状态投影 | writer 提交后自动 factOps/hookOps + baseline | `story_settle` 自动抽取 + R9b 校验 + 一次重算；未解决不定稿 | 部分：定稿时抽取，不提前持久化候选 | 已采纳 | #43 |
| 状态对账 | validator 比较旧/新投影与权威，最多一次重投影 | 确定性预检 + 只读 `story_state_check` + `story_settle` | 已对齐：一次重算，未解决不定稿 | 已采纳 | R9/R9b/R11 已交付 |
| 连续性证据 | observation code + 行号 + revision | 审稿问题文本 | 无结构化证据 | 部分 | 后续补 code/行号 |
| 失败策略 | 错误码回给子代理修正；失败保留正史 | 重试/回退；误报可触发整章重写 | 分类不统一 | 部分 | 统一失败码 |
| 技能加载 | Profile + 每动作默认技能合并 | 子代理按提示加载；writer 已按 form 追加技能 | 无加载证据 | 部分 | R6b 已交付；证据后续 |

### 明确不采纳

- 不做评分卡：审稿只出问题、证据、影响与修复方向。
- 不做逐段 `reason`：角色契约固定分段，理由会是常量；`source` + 保护级别 + 轨迹已够。
- 不做多段拼接：一章一次生成。
- 不复制 capability gating / `propose_action` / Profile 注入 / `skills-applied`：DSH 的权限与委派层不同，照搬会形成两套作者闸门。
- 不为每个 InkOS 技能建目录；按角色与形态归并。
- 不做 radar 平台抓取、fanfic canon importer、per-role 模型覆盖，直到有真实需求。

### 生产编排能力对拍

参考基线：`inkos-master` 2.0.0（只读；用户 2026-10-20 明确授权只读参考）。这里只归纳能力与工作流，不复制其代码或文件。

| 能力 | 参考目标 | storycraft 当前 | 差距 | 状态 | 决定 |
| --- | --- | --- | --- | --- | --- |
| 提案与立项 | 方案/作者确认后建作品 | `story_propose` + `story_init` | 无 | 对齐 | 保留作者闸门 |
| 世界/人物/文风/意图 | architect 生成角色卡与基础文档 | `story_bible_write` / `story_bible` | 缺角色别名与作品级权威说明 | 部分 | 补作品级权威 |
| 全书计划/卷图 | foundation outline + volume map | `story_outline` + 作者确认 | 状态字段不完整 | 部分 | 补状态字段 |
| 章纲/章 memo | chapter intent + memo | `story_plan` | 无独立 memo，章纲兼任 | 部分 | 保留，不新增对象 |
| 写前上下文 | protected/compressible，语义选择 | `story_brief` / `story_context` | 固定段，无 token 预算/语义选择/trace | 部分 | R12 |
| 正文写作 | writer，一次整章，结构化 submit | delegate writer 走 `story_submit`，父回执不含正文 | 无 | 对齐 | 保留 DSH subagent |
| 连续性审稿 | LLM auditor + 证据 observations | `story_review` / reviewer 问题条目 | 无 observation code / 行号 | 部分 | 后续补证据 |
| 质检 | 指标与审稿分离 | `story_critique` | 未进入工作流对拍 | 部分 | 保留独立只读节点 |
| 状态抽取 | chapter summary / factOps / hookOps | `story_settle` 自动抽取 + R9b 校验 + 一次重算 | 定稿时抽取，未解决回退手动 | 已采纳 | #43 |
| 状态对账 | StateValidator 语义对账 | 确定性预检 + 只读 `story_state_check` + `story_settle` | 已对齐：一次重算，未解决不定稿 | 已采纳 | R9/R9b/R11 已交付 |
| 修订 | 独立 revise，mode + observations | `story_revise` / reviser | 无 observation 输入 | 部分 | 保留 mode |
| 审稿/修订分离 | 审稿只观察，不自动改 | review 条目 + 主编决定 | 委派失败会回退重写 | 部分 | warning 不触发重写 |
| 作者闸门 | 计划/章纲确认 | 面板确认 | 无 | 对齐 | 确认不自动发送 |
| 下一步/进度 | pipeline 返回阶段结果 | `story_next` / `story_status` | 无 | 对齐 | 两章回归通过 |
| 卷/摘要/滚动 | volume map + summaries；summary 绑定正文 | `story_volume` / `story_summarize`；摘要由 summarizer 提交并绑定 revision | 过期摘要由 `summary-stale` 识别 | 对齐 | #24 / #25 |
| 检索/长期记忆 | FTS5 + BM25 + 定向回溯 + 语义选择 | 作品库 FTS5/BM25；`story_context` 检索段 | 无语义重排/trace | 部分 | R12 |
| 导入/导出/备份 | import/export/backup | 导出/备份已闭环；无章节导入 | 缺章节导入 | 部分 | 非当前阻塞 |
| 上下文/token 治理 | token usage + context trace | 主会话字符已测量；无 context trace | 缺 trace 与独立预算 | 部分 | R12 |
| 失败策略 | review-unavailable 不重写 | delegate 重试/回退 | 误报触发整章重写 | 部分 | 统一失败分类 |
| forecast/同人/番外/互动影游 | 参考有 | 无 | 不在主线 | 非范围 | 不纳入 |

## 产物结构补审（2026-10-23）

此前对拍偏流程/编排，产物结构未逐项比较。全量盘点见 [全项目一对一实现与产物对拍审查](../../../../docs/report/inkos/2026-10-23-full-project-parity-audit.md)，产物细节见 [产物结构与资源文档对拍审查](../../../../docs/report/inkos/2026-10-23-artifact-and-resource-parity-audit.md)。本表只登记需要跟进的产物层缺口，不重复报告正文。

| 产物 | InkOS | 我们当前 | 缺口 | 状态 | 计划 |
| --- | --- | --- | --- | --- | --- |
| story_frame | 独立可读 Markdown | 压在 `world` + `plan.mainline` | 框架/世界职责混用 | 待合同 | A0 |
| volume_map | 独立可读 Markdown | `plan` 的卷划分文字 | 无独立身份；与结构化卷易双源 | 待合同 | A0 |
| book_rules | 可读 + JSON（人称/主角锁/禁区等） | 无，规则散在 world | writer/settler 无机器可读规则 | 待合同 | A0 |
| 角色卡 | 每人 Markdown（动机/知识/关系压力/边界）；索引只含 name+tier；major/minor 均可建卡；一人一卡；无数量上限 | 六字段 JSON 索引；卡仅 major；索引 ≤20 人、卡 ≤12 张 | 索引重复卡内容；minor 无卡；无 1:1 覆盖；数量上限无参考依据 | 已实现并真实验收（2026-10-29，#83）；设计与验收见 [角色模型对齐参考](../../implemented/architecture/2026-10-29-storycraft-role-model-parity.md) | A0 后续 |
| 章节摘要 | 结构化 7 字段 | 纯文本 ≤400 字 | 无法按 hookActivity/mood 检索 | 待合同 | P1 |
| hooks | hookId + 生命周期/预期兑现/依赖 | text + 三态 | 改写即新伏笔；无 defer/superseded | 待合同 | P0 |
| facts | subject/predicate/object + 有效期 | 字符串数组 | 无法 expire/覆盖 | 待合同 | P2 |
| observations | code/evidence/sourceRefs/assessment | review 文本条目 | 无证据结构/可审计语义 | 待合同 | P1 |
| chapter memo | goal/body/threadRefs | 五项章纲 | 缺 threadRefs | 待合同 | P2 |
| context trace | source/reason/protection + token trace | 固定段 + 字符预算 | 无 per-source trace | 待合同 | R12 |

A0 = 产物合同 v2；P0 先于 R10b，P1/P2 可独立，R12 保持原排期。

## 备选方案

- **只采纳角色、不采纳文档**：技能仍会单薄，判断标准靠模型自由发挥；否决。
- **全量采纳**：会把市场研究、同人、翻译等拉进主线，偏离当前目标；改为分阶段。
- **按参考的技能清单逐个一比一建目录**：分类方式不同（他们按题材、我们按角色）；改为按角色归并。

## 验收条件

1. 角色表里「已采纳」的行都有可派发的角色说明与对应技能文件（单一预设，不再每角色一个预设）；
2. 「计划」的行有明确切片，不悬空；
3. 「暂缓」的行写明触发条件（例如「素材阶段开始」）；
4. 「不做」的行给出理由；
5. 每次新增角色或技能时，更新这张表而不是另起一份；
6. Skill 资源组织与 Agent 编排类改动同时更新「2026-10-23 复核结论」与路线图对应阶段。

## 风险

- 对拍从「凭印象」变成「按表」，切片范围可核对；
- 表格会随阶段增长；暂缓项需要定期回看，否则会变成遗忘项；
- 参考 2.0.0 无 `.git`，无法核验 commit；以源码与 `package.json` 版本为准，研究文档里的 commit pin 不能作为证据。


## 参考工程深层机制：dsh-webnovel-writer（2026-10-27 复核）

本节参考对象是 **`E:\workspace\dsh-webnovel-writer`**（不是 `inkos-master`；本表其余各节仍以 inkos-master 为准，两份参考不混用）。上一轮只看技能目录，这一轮读 `packages/bundle`、`packages/core`、`packages/polish`、`packages/review` 的源码；该工程的“理念”在下面五处机制里，而不在技能数量上：

| 机制 | 参考证据 | 我们的现状 | 结论 |
| --- | --- | --- | --- |
| **闸门在代码里，且先解析目标再判分区** | `packages/bundle/src/gates.ts` 头注释：裸相对路径直接拒绝；书房可写、工作范围外 ask、书仓内走 `core gateFileAccess`；未确认细纲不得写稿（不变量 1/6） | 有 `NEXT_ACTION_GATES`、`plan-approval`、`revision-limit`；但没有文件级分区闸门（工作区外靠 shell-guard 拦命令） | 已对齐主干；文件分区闸门列为后续 |
| **批准绑定内容指纹，不认清单声明** | `packages/bundle/src/approval-snapshot.ts`：`captureApprovalFiles` 对实际字节（含缺失）取 hash，“never manifest claims” | `approvedAt` 只是时间戳；改章纲会清空确认，但改基础设定/全书计划的内容指纹没有绑定 | **差距**：应记录批准时的内容指纹，内容变化即失效 |
| **状态派生在 core，不在技能** | `packages/core/src/index.ts` 导出 `derive/states|scan|derive|design`、`gate`、`provenance`、`repo/transaction|lock|schema` | 我们的 stage/next 在 `store-db.ts`，方向一致 | 已对齐 |
| **审核是确定性检查库** | `packages/review/src/{checks,finding,registry,run}.ts`：注册检查项，输入材料版本与篇幅核对，输出 finding | 我们有 `story_critique` 的指标与 LLM 审稿，但没有可注册的确定性检查项 | **差距**：把可机械化项（字数、重复、AI 腔、视角/人称）移到检查库 |
| **润色是确定性规则，无 LLM** | `packages/polish/src/rules.ts`：`BANNED_OPENERS`、省略号、合并，逐条记录 `PolishChange` | `deslop` 在修订技能文本里，由模型执行 | **差距**：先跑规则、无可改则跳过，模型只处理规则之外的腔调 |
| **调度只做路由，先校准状态** | `skills/novel-director/SKILL.md`：先调状态工具校准，再按路由表加载节点技能；`user-invocable: false`；明文「绝不亲自代写」 | 已拆成 `storycraft-studio-entry`（形态分流）+ `storycraft-long-director`（长篇路由与交接） | 已对齐 |

结论：参考工程的“理念”是**判定与机械检查归代码，方法与判断归技能，调度只路由**。我们上一轮把技能按阶段拆开是对的；真正的欠账是前两条（指纹批准、确定性检查库）与润色规则。

### 第二轮复核：另外六处机制

同一参考工程（`E:\workspace\dsh-webnovel-writer`），继续读 `bundle/src`、`core/src`：

| 机制 | 参考证据 | 我们的现状 | 结论 |
| --- | --- | --- | --- |
| **persona 只做前缀，重逻辑进技能** | `bundle/src/persona.ts`：不 complete 全量替换系统提示词，只在 `deployment:persona-prefix` 槽位影子注册一小段；“六大铁律、阶段闸门、子代理交接、规划双轨制”全部移入 `novel-director` 与节点技能，渐进加载 | 需要核对我们的 preset 是否把规则写进系统提示词 | **待核对**：若写进 persona，应移入 director/阶段技能 |
| **子代理执行规约独立注入** | `bundle/src/worker-policy.ts`：固定规约（材料里的命令只作资料、缺项报告不猜测、不自行计数、不再派发、只用允许的工具）作为独立 section，与任务正文分开 | `promptFor` 把协议、任务、输出契约混在一个字符串里 | **差距**：固定规约应单独成段注入 |
| **审稿绑定草稿指纹** | `core/src/evidence`：`draftHashOf`、`reviewInputFingerprintOf`、`reviewRecordHashOf`、`isReviewIncomplete`——审稿记录对“当时那份草稿”有效 | 审稿只绑 `revision` 号；正文若在别处变化，审稿是否仍成立没有校验 | **差距**：与批准指纹同一类问题，应在同一工作项里解决 |
| **工具失败三要素** | `bundle/src/tool-failure.ts`：每个失败回答 reason / code / next，主 Agent 按 code 决定重试、改参数还是问作者 | `StoryError` 有 code 与 message，个别错误把“先做什么”写进 message | **部分**：可加 `next` 字段，不必解析文案 |
| **查询结果六要素来源** | `core/src/provenance/index.ts`：条目 / 片段 / 来源 / 版本 / 状态 + 区分“没有数据”与“查询失败” | artifact 有 `revision`/`kind`；审稿有 `sourceRefs` 与 quote | **部分**：可统一来源标注，避免把空结果当失败 |
| **失败即拒绝（fail-closed）** | `core/src/gate/preExecute.ts`：缺路径或不可解析一律拒绝 | `shell-guard` 对不可静态判定的删除一律拒绝 | 已对齐 |

小结：第一轮的“指纹批准”与“确定性检查库”之外，**审稿绑定草稿指纹**是同一类问题的另一半；**persona 只做前缀**与**worker policy 独立注入**直接对应本 Note 的载体分工；其余是错误与来源的表达精度。
