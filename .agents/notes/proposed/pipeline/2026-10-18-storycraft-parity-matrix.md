---
title: 故事工坊：与参考实现的能力对拍清单
status: proposed
created: 2026-10-18
updated: 2026-10-21
---

# Agent Note：故事工坊：与参考实现的能力对拍清单

> 本文件是长期跟踪表，不随交付迁移 lifecycle；能力落地后更新状态列，不另建记录。

## 问题

角色化提案只说了「主编 + 工作子代理」，没有写清**对拍范围**：参考实现里哪些角色、哪份文档要采纳，哪些只借结构、哪些暂不做。缺少这张表，切片只能按我当下的理解实现，容易漏、也容易重复造。

对拍口径：**角色与文档可采纳；脚本、命令与动作名按我们的来**。

> 2026-10-19：角色不再各自成预设。派发由主编用官方 `subagent` 完成，角色由任务提示与技能区分；上下文由只读动作 `story_context` 交付（见 [#12](https://github.com/dehuadong/dsh-nove/issues/12)）。

## 提案

### 角色对拍

| 参考角色 | 职责 | 我们的落点 | 状态 |
| --- | --- | --- | --- |
| architect | 书级设计（世界观、卷、人物弧） | 规划角色（作品级 `story_context` + 全书计划） | 已采纳（并入规划） |
| planner | 单章计划（目标/阻力/代价/变化） | 规划角色（章级 `story_context` + 章纲） | 已采纳 |
| writer | 写正文 | 写手子代理 + 写法技能 | 已采纳 |
| auditor / reviewer | 审稿清单 | 审稿子代理 + 审稿技能 | 已采纳 |
| reviser | 按条目改稿 | 修订者子代理 + 修订技能 | 已采纳 |
| settler | 把事实与伏笔归档 | 主编 + `story_state`（不单独设子代理） | 已采纳（合并） |
| continuity | 跨章连续性检查 | 并入审稿技能（连续性维度） | 已采纳（合并） |
| detector | AI 内容检测打分 | 本地 `story_critique` 指标 + `deslop` 模式 | 已采纳（换实现） |
| composer | 多段拼接成章 | 不采纳：我们一章一次生成 | 不做 |
| researcher / radar | 素材与趋势检索 | 素材与检索阶段 | 暂缓 |
| short-fiction | 短篇专门流水线 | 写手 + 形态包（短篇） | 已采纳（合并） |
| script-storyboard | 剧本分镜 | 剧本形态深化 | 暂缓 |

### 技能对拍

| 参考技能 | 我们的落点 | 状态 |
| --- | --- | --- |
| 长篇写法 | `storycraft-write-craft` + 篇幅参考 | 已采纳 |
| 审稿 | `storycraft-review` + 维度清单 | 已采纳 |
| 去 AI 味 | `storycraft-revise-craft/references/deslop.md` | 已采纳 |
| 短篇写法 / 竖屏短剧写法 | 形态技能（已有） | 已采纳 |
| 续写 | 并入长篇技能「承接上一章」一节 | 计划 |
| 导入 | 已有 `story_bible_import`，补一段导入说明 | 计划 |
| 长篇/短篇分析 | 规划子代理的输入方法（拆解参考作品） | 计划（切片 5 之后） |
| 长篇/短篇市场研究 | 素材与检索阶段 | 暂缓 |
| 同人 / 仿写 / 番外 | 形态与入口另行设计 | 暂缓 |
| 分镜 / 封面 / 翻译 / 交互影游 | 独立能力，不在当前主线 | 暂缓 |

## 生产编排能力对拍

参考基线：`inkos-master` 2.0.0（只读；用户 2026-10-20 明确授权只读参考）。这里只归纳能力与工作流，不复制其代码或文件。

| 能力 | 参考目标 | storycraft 当前 | 差距 | 状态 | 决定 |
| --- | --- | --- | --- | --- | --- |
| 提案与立项 | 方案/作者确认后建作品 | `story_propose` + `story_init` | 无 | 对齐 | 保留作者闸门 |
| 世界/人物/文风/意图 | architect 生成角色卡与基础文档 | `story_bible_write` / `story_bible` | 缺角色别名与作品级权威说明 | 部分 | 补作品级权威 |
| 全书计划/卷图 | foundation outline + volume map | `story_outline` + 作者确认 | 状态字段不完整 | 部分 | 补状态字段 |
| 章纲/章 memo | chapter intent + memo | `story_plan` | 无独立 memo，章纲兼任 | 部分 | 保留，不新增对象 |
| 写前上下文 | protected/compressible，语义选择 | `story_brief` / `story_context` | 固定段，无语义选择/预算 | 部分 | 补预算；语义选择后续 |
| 正文写作 | writer，一次整章，结构化 `submit_chapter_draft` | delegate writer 走 `story_submit`，父回执不含正文 | 无 | 对齐 | 保留 DSH subagent；2026-10-21 两章真实链路验证 |
| 连续性审稿 | LLM auditor + 证据 observations；空 observations 有效 | `story_review` / reviewer 问题条目；委派走 `story_submit` | 无 observation 证据模型；委派空清单未在真实链路触发 | 部分 | 未登记人名转 warning；手动空清单清稿 2026-10-21 已通过 |
| 质检 | 指标与审稿分离 | `story_critique` | 未进入工作流对拍 | 部分 | 保留为独立只读节点 |
| 状态抽取 | chapter summary / factOps / hookOps | `story_state` 手写 | 无自动 settler | 部分 | 本项不自动 settler |
| 状态对账 | StateValidator 语义对账 | 无 | 缺失 | 缺失 | 单列后续工作 |
| 修订 | 独立 revise，mode + observations | `story_revise` / reviser | 无 observation 输入 | 部分 | 保留 mode |
| 审稿/修订分离 | 审稿只观察，不自动改 | review 条目 + 主编决定 | 委派失败会回退重写 | 部分 | warning 不触发重写 |
| 作者闸门 | 计划/章纲确认 | 面板确认 | 无 | 对齐 | 2026-10-21 两章回归通过；确认不自动发送 |
| 下一步/进度 | pipeline 返回阶段结果 | `story_next` / `story_status` | 无 | 对齐 | 2026-10-21 两章回归通过 |
| 卷/摘要/滚动 | volume map + summaries；writer 提交 `chapterSummary` | `story_volume` / `story_summarize`；摘要由 `story_delegate` 的 summarizer 角色提交并绑定正文 revision | 摘要不再进主会话；过期摘要由 `summary-stale` 识别 | 对齐 | #24 / #25 已交付 |
| 检索/长期记忆 | FTS5 + BM25 + 前章保底 + Hook 定向回溯 + LLM 语义选择 | 作品库已有 FTS5/BM25（#18）；`story_context` 检索段由 #16 规划 | 第一版不做 LLM 重排/向量；先做确定性召回 + trace | 部分 | #16 规划中 |
| 导入/导出/备份 | import/export | `story_export` / `story_backup`；无导入 | 缺章节导入 | 部分 | 非本项阻塞 |
| 上下文/token 治理 | token usage + context trace | 主会话字符已测量；#19 AC6 clean 窗口 1,758 / 2,107；摘要通道已接（#24）；无 context trace | 缺 trace 与独立预算 | 部分 | trace 后续 |
| 失败策略 | review-unavailable 不重写 | delegate 失败重试/回退 | 误报触发整章重写 | 部分 | 统一失败分类 |
| forecast/同人/番外/互动影游 | 参考有 | 无 | 不在主线 | 非范围 | 不纳入本项 |
### 明确不做

- 不做评分卡：审稿只出问题、证据、影响与修复方向；
- 不做逐段「选择理由（reason）」：参考用它记录「为什么选这条来源」，我们每段的取舍由**角色契约固定**（写手永远是那六段），
  reason 会是同一句常量的复制，信息量为零且会与设计文档漂移。`source` + 保护级别 + 轨迹已能回答「这段从哪来、有没有被裁」。
  检索（路线图 R5）接入后再重新评估：那时「为什么召回这一条」才是真实、随实例变化的理由。
- 不做多段拼接：一章一次生成，靠场景预算控制长度；
- 不引入参考实现的命令名与脚本名。

## 备选方案

- **只采纳角色、不采纳文档**：技能仍会单薄，判断标准靠模型自由发挥；否决。
- **全量采纳**：会把市场研究、同人、翻译等拉进主线，偏离当前目标；改为分阶段。
- **按参考的技能清单逐个一比一建目录**：分类方式不同（他们按题材、我们按角色）；改为按角色归并。

## 验收条件

1. 角色表里「已采纳」的行都有可派发的角色说明与对应技能文件（单一预设，不再每角色一个预设）；
2. 「计划」的行有明确切片，不悬空；
3. 「暂缓」的行写明触发条件（例如「素材阶段开始」）；
4. 「不做」的行给出理由；
5. 每次新增角色或技能时，更新这张表而不是另起一份。

## 风险

- 对拍从「凭印象」变成「按表」，切片范围可核对；
- 表格会随阶段增长；暂缓项需要定期回看，否则会变成遗忘项。

