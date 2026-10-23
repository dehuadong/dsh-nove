---
title: 故事工坊：与参考实现的能力对拍清单
status: proposed
created: 2026-10-18
updated: 2026-10-23
---

# Agent Note：故事工坊：与参考实现的能力对拍清单

> 本文件是长期跟踪表，不随交付迁移 lifecycle；能力落地后更新状态列，不另建记录。

## 问题

角色化提案只说了「主编 + 工作子代理」，没有写清**对拍范围**：参考实现里哪些角色、哪份文档要采纳，哪些只借结构、哪些暂不做。缺少这张表，切片只能按我当下的理解实现，容易漏、也容易重复造。

对拍口径：**角色与文档可采纳；脚本、命令与动作名按我们的来**。

> 2026-10-19：角色不再各自成预设。派发由主编用官方 `subagent` 完成，角色由任务提示与技能区分；上下文由只读动作 `story_context` 交付（见 [#12](https://github.com/dehuadong/dsh-nove/issues/12)）。

> 2026-10-23 复核基线：`inkos-master` 2.0.0（无 `.git`，以 `package.json` 与源码为准）。本轮只补**方法、Skill/资源组织、Agent 编排与交接**；2.0 源码增量见 `docs/report/inkos/2.0-harness-delta.md`，研究索引见 `docs/report/inkos/readme.md`。路线图见 `workspace/2026-10-19-storycraft-roadmap.md`。

## 2026-10-23 复核结论

- **最强差距不在「有没有角色」，而在三处交接**：
  1. 委派只到 writer / reviewer / reviser / summarizer；architect、planner 没有委派角色；
  2. `story_state` 是手工写入口，没有 settler 自动投影，也没有 state validator 对账；
  3. writer 委派硬编码「长篇小说」和长篇技能，短篇/剧本子代理拿不到形态技能。
- **Skill 不是数量问题，是资源深度与路由问题**：8 个技能覆盖主干，但长篇缺 foundation / 读者承诺 / 状态投影三份方法参考；分析与市场研究没有 lens/rubric；短篇技能仍写 `stories/*.md`，与 SQLite 作品库冲突。
- **不复制 InkOS 的权限层**：capability gating、`propose_action`、Profile 注入、`skills-applied` 证据是它 2.0 的宿主模型；DSH 已有自己的动作、作者闸门与委派回执，只借方法与资源组织。

## 提案

### 角色对拍

| 参考角色 | 职责 | 我们的落点 | 状态 |
| --- | --- | --- | --- |
| architect | 书级设计（世界观、卷、人物弧、初始伏笔） | 规划角色 + 全书计划；无 foundation 委派 | 部分：缺 story_frame / volume_map / book_rules 分层与初始伏笔投影（`architect.ts:142-184`） |
| planner | 单章计划（目标/阻力/代价/变化） | 规划角色 + `story_context` + 章纲 | 部分：`story_context` 有 planner 枚举，`story_delegate` 不含 planner（`tools.js:1118,1783`） |
| writer | 写正文 | 写手子代理 + `storycraft-write-craft` + 形态技能 | 部分：form 路由已接；仍缺提交后 settler |
| auditor / reviewer | 审稿清单与证据 | 审稿子代理 + `storycraft-review` | 部分：有问题清单，无 observation code / 行号证据（`continuity.ts:74-97`） |
| reviser | 按条目改稿 | 修订者子代理 + `storycraft-revise-craft` | 部分：有 mode；无 observation 输入 |
| settler | 把事实与伏笔归档 | `story_state` 手写 | 缺失：委派 writer 提交后不自动投影（`writer.ts:271-363`） |
| continuity | 跨章连续性检查 | 并入审稿技能 | 部分：无 observation code、无前后 revision 对比 |
| detector | AI 内容检测打分 | `story_critique` + `deslop` | 已采纳（换实现） |
| composer | 上下文选择/编译（另含多段拼接） | `story_context` 固定分段 + 8000 字符预算 | 部分：无 token 预算、语义选择与持久化 trace；拼接不做 |
| researcher / radar | 素材与趋势检索 | 材料库 + 检索 | 部分：有库与召回，无研究方法与来源 rubric |
| short-fiction | 短篇专门流水线 | `storycraft-short-story` + 同一动作 | 部分：有方法，委派不加载形态技能 |
| script-storyboard | 剧本/分镜 | 剧本形态 | 部分：有短剧技能，无分镜对象 |

### 技能对拍

参考 `inkos-master/packages/core/skills` 共 20 个技能、18 份 references；我们 8 个技能、4 份 references。

| 参考技能（refs） | 我们的落点 | 状态 |
| --- | --- | --- |
| 长篇写法（4） | `storycraft-write-craft` + 篇幅参考；`storycraft-plan-craft` | 部分：缺 foundation-design / reader-contract / state-projection |
| 短篇写法（1） | `storycraft-short-story` | 部分：缺生产/包装清单；`SKILL.md:9,36-37` 与阶段机/SQLite 冲突 |
| 剧本写法（1） | `storycraft-short-drama` | 部分：缺改编边界与制作约束 |
| 审稿（1） | `storycraft-review` + `review-dimensions.md` | 已采纳 |
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
| 主文件 / references | 主体短，长篇 4 份，正文链接 3 份 | 8 技能 4 份，仅 2 份被正文点名 | 部分 | 补长篇 2 份；每份 reference 必须在正文点名 |
| 激活与证据 | Profile 必需技能注入并记 `skills-applied` | `mode: all`；子代理按提示自己 `skill`，无加载证据 | 部分 | 保留模型加载；补技能名存在性测试，不复制注入层 |
| 形态→技能 | Profile 按作品类型绑定必需技能 | writer 按 `form` 追加形态技能；reviewer/reviser 不加 | 部分 | 路由已接；short-story 输出契约待 R6b-fix |
| 技能来源 | 包内 + 外部目录 + 项目技能 | 插件包内技能 | 部分 | 暂不开放外部导入；先保证内置技能自洽 |
| 资源检索 | 统一检索内核按 scope/kind 检索 | `story_context` 检索段 + 材料库 | 部分 | 先做确定性召回与 trace；语义选择待 R12 |

### Agent 编排与任务交接对拍

| 交接点 | 参考实现 | 我们当前 | 差距 | 状态 | 决定 |
| --- | --- | --- | --- | --- | --- |
| 结构化提交 | 模型经 typed tool 提交，宿主校验后落盘 | `story_submit` + `submission.js` 校验 | 无 | 对齐 | 保留 |
| 委派角色 | architect / planner / writer / reviser / settler / validator | writer / reviewer / reviser / summarizer | 缺 architect、planner、settler、validator | 部分 | 先补 planner/architect，再做 settler/validator |
| 作者闸门 | 计划/章纲确认 + 提案确认 | 面板确认 + 提案同意 | 无 | 对齐 | 确认后不自动发送 |
| 完成证据 | 只认 ActionResult / artifact revision | 委派回执 + revision | 回执有，artifact 证据弱 | 部分 | 回执补 artifact id/版本 |
| foundation 交接 | 三段式 submit + 原子写 story_frame/volume_map/book_rules/role cards | 三次 `story_bible_write` / `story_outline` | 无一次生成与初始伏笔投影 | 缺失 | R10 |
| 章计划交接 | planner 产出 ChapterIntent + ChapterMemo | 章纲五字段 | 无独立 memo | 部分 | 保留章纲，不新增对象 |
| 上下文装配 | composer：半窗预算、语义选择、trace | `story_context` 固定段 + 8000 字符 | 无 token 预算/trace | 部分 | R12 |
| 状态投影 | writer 提交后自动 factOps/hookOps + baseline | `story_state` 手工 | 无自动投影 | 缺失 | R11 |
| 状态对账 | validator 比较旧/新投影与权威，最多一次重投影 | 无 | 缺失 | 缺失 | R9（最高优先） |
| 连续性证据 | observation code + 行号 + revision | 审稿问题文本 | 无结构化证据 | 部分 | 后续补 code/行号 |
| 失败策略 | 错误码回给子代理修正；失败保留正史 | 重试/回退；误报可触发整章重写 | 分类不统一 | 部分 | 统一失败码 |
| 技能加载 | Profile + 每动作默认技能合并 | 子代理按提示加载 | 无证据/无形态路由 | 部分 | form 路由 + 名字测试 |

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
| 状态抽取 | chapter summary / factOps / hookOps | `story_state` 手写 | 无自动 settler | 缺失 | R11 |
| 状态对账 | StateValidator 语义对账 | 无 | 缺失 | 缺失 | R9 |
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
