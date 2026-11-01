# 故事工坊（see-storycraft）

DSH 里的长篇创作编排：三十六个动作把立项、章纲、正文、审稿、修订、定稿归档与导出备份落到**一作品一库**的 SQLite 存储，一个**工作台**以只读方式看作品与章节，并按键把固定指令投给当前会话。故事工坊是**一个工作模式**（一个 Agent 预设），以标准预设为基线再挂自己的动作、技能与人设。

## 现状

| 工作模式 | 人设 | 技能 | 动作 | 工作台 |
| --- | --- | --- | --- | --- |
| 故事工坊 `storycraft` | 有（主编 / 子代理两用） | 有（长篇 / 短篇 / 剧本形态技能 + 角色写法、审稿、修订、规划、状态结算与对账；长篇另有方法参考） | **有**：`story_init` `story_plan` `story_write` `story_review` `story_revise` `story_settle` `story_state` `story_state_check` `story_status` `story_next` `story_delegate` `story_submit`，以及真值三件 `story_bible` `story_bible_write` `story_summarize`、只读 `story_read` 与写前上下文 `story_brief`；常备能力 `story_export` `story_backup` | 有 |

动作按预设作用域注册：只有「故事工坊」会话能看到 `story_*`，其他模式与其他会话的工具面不变。形态（长篇 / 短篇 / 剧本）是作品数据（`catalog.db` 的 `works.form`），不是预设；同一会话里可以分别打开三种形态的作品。

## 角色与委派

写手、审稿、修订、摘要、架构师、规划**不是预设**，而是子代理；六种角色默认由宿主动作 `story_delegate` 通过官方 `subagents` 服务启动：

- `story_delegate` 在宿主侧预检、装配上下文、启动子代理、校验并落库；主编只收紧凑回执，正文不进入主会话；
- 手动兜底仍用官方 `subagent`：省略 `agentPreset`，子代理加入故事工坊当前组合；写手与规划没有专属技能：角色协议由 `promptFor` 按形态组装，创作方法取阶段技能（`storycraft-long-*` / `storycraft-short-*` / `storycraft-script-*`）；审稿、修订、架构师仍用 `storycraft-review`、`storycraft-revise-craft`、`storycraft-architect` 薄契约；角色技能只写任务、提交 schema、闸门与失败回退，方法正文读形态技能；
- `planner` 只写**首次章纲**：已有 `plan:<n>` 时返回 `plan-exists`，改章纲仍由主编手动 `story_plan`，避免子代理覆盖已确认章纲；
- 写手按作品 `form` 加载形态 craft 与形态契约：长篇 `storycraft-long-prose` + `storycraft-longform-chapter`，短篇 `storycraft-short-prose` + `storycraft-short-story`，剧本 `storycraft-script-scene` + `storycraft-short-drama`；提示按「章 / 篇 / 集」显示单位；形态契约同样只写流程与提交，方法读各自的 craft；
- 定稿前的状态对账由 `storycraft-state-check` 子代理完成（`story_state_check`），只读、只出建议；它不替代 `storycraft-review` 的正文审稿；
- 结算由 `story_settle` 产出状态草案（不写事件）：`storycraft-state-settler` 从正文抽取 `factOps`/`hookOps`/`newHooks`，再走 `story_state_check`；作者接受草案或 `story_state` 改草案后，用 `story_finalize` 定稿入账；
- 长篇任务里，规划、写作、审稿与定稿前的主编按各自技能正文的触发加载 `storycraft-long-writing` 的 references；短篇、剧本各读 `storycraft-short-writing` / `storycraft-script-writing`；方法技能只给判断依据，不产出提交内容，也不替代角色技能的输出契约；
- 委派子代理通过 `story_submit` 提交结构化结果；预设作用域的守卫拒绝它调用 `write`、`edit`、`pwsh`、`bash` 与写动作（`story_write`、`story_review`、`story_revise`、`story_delegate` 等），落库一律由宿主/主编完成；
- 委派深度固定为 1，子代理不能再派发。

## 立项与提纲

1. 作者用自然语言给出想法 → 模型只讨论，不写文件；
2. 方向成熟后 `story_propose` 把提案写进 `catalog.db`（不是作品），作者确认后 `story_init`（必须带 proposal）；
3. 立项只建库与真值骨架；接着 `story_outline` 写主线/卷划分/结局方向到真值 `plan`；
4. 作者在面板点「确认全书计划」后由宿主记录（`POST /outline/approve`）；模型不能代签，未确认前任何章的 `story_plan` 都被拒（`outline-required`）；
5. 单章章纲的确认按作品设置 `planApproval` 执行：默认 `required`（写手/修订者上下文与写正文/修订都校验，`plan-not-approved`），可设为 `off` 关闭逐章确认；
6. 确认后才能写任何章的章纲。

## 形态

| 形态 | `story_init` 的 form | 单位 | 形态契约 | 共享方法 |
| --- | --- | --- | --- | --- |
| 长篇 | `longform`（默认） | 章 | 单章流程与闸门：章纲 → 正文 → 审稿 → 修订/清稿 → 摘要 → 定稿 | `storycraft-long-writing` |
| 短篇 | `short` | 篇 | 一篇或多章组成的完整短篇；默认 12 章 × 约 1000 字可配置（S 阶段接入批量流水线） | `storycraft-short-writing` |
| 剧本 | `script` | 集 | 按场次与台词组织，流程同上 | `storycraft-script-writing` |

形态是作品数据，决定用哪套技能与页面单位；动作与门禁完全一致。没有已知形态时按长篇读取。

## 共享方法

每个形态一份共享方法技能，由该形态的角色共同加载，不产出提交内容：

- `storycraft-long-writing`：四份 references，分别覆盖基础设计、读者承诺与推进、场景/对话/篇幅预算、状态投影；
- `storycraft-short-writing`：`references/production-checklist.md`；
- `storycraft-script-writing`：`references/episode-scene-craft.md`。

角色/形态技能只写任务、提交 schema、闸门与失败回退；`storycraft-longform-method` 保留为迁移别名，指向 `storycraft-long-writing`，L 阶段切换路由后下线。方法技能只给判断标准，不替代角色输出契约。

## 作品库

工作区下只有一棵存储目录，作品内容不出工作区：

```text
<工作区>/.storycraft/
  catalog.db                 目录：works、proposals、session_current
  works/<workId>.db          单部作品的全部内容
  trash/<workId>.db          软删除的作品库
  materials/                 素材托管副本（模型不可读；删除素材时保留）
  exports/<workId>/          按需导出（作者在系统文件管理器里取用）
  backups/<workId>-<ts>.db        单作品备份
  backups/<workId>-<ts>.materials.zip  显式备份的素材 sidecar
```

`catalog.db` 只存元数据，是 title/form/tags 的权威；作品库的 `meta` 行是导出副本。每部作品独立 `user_version`，升级一部不影响其他；作品库只支持当前 schema；没有旧作品，不做迁移或兼容读取，版本不符直接返回 `schema-version-mismatch`。表结构、连接策略、改名/删除/恢复顺序与启动对账的完整设计见 [作品入库 Note](../.agents/notes/implemented/architecture/2026-10-19-storycraft-sqlite-store.md)。

动作与路由返回的模型可见 artifact 只有 `artifactId` / `revisionId` / `kind`，不含文件路径；正文/章纲/审稿/摘要等内容按 ID 用 `story_read` 或上下文动作读取。UI 与作者导出仍显示路径；实际内容在作品库内。宿主启动及首次读取一个工作区时对账目录与文件：缺失的作品在列表跳过并记入宿主诊断，孤儿文件与回收站文件保留待人工恢复。

## 真值与写前上下文

每部作品有一套真值，由动作建立与校验（模型不直写）：

```text
bible/world       世界观：时代、地理、规则边界、已定事实
bible/characters  人物档案：[{ name, role, want, fear, limit, voice }]
bible/style       文风基准：人称、时态、句长节奏、禁用词与口头禅
outline/plan.md   全书计划：主线、卷划分、结局方向
bible/intent      作者意图与当前焦点
summaries         章节摘要（摘要 artifact `summary:<n>` 的虚拟路径；rawText 上限 400 字；bodyRevision 绑定正文版本）
materials         作者素材（txt/md/epub/pdf；用途 setting/character/scene/style/reference；FTS5 索引；元数据表格 + .storycraft/materials 副本）
```

- `story_bible`：读真值（可指定一份），缺失时指出缺哪几份。
- `story_bible_write`：校验后写入并返回内容版本；人物档案缺字段或重名会被拒绝，原内容不变。
- 没有旧作品导入：真值只由 `story_bible_write` / architect 生成；`story_outline` 是唯一的全书计划入口。
- `story_summarize`：手动写章节摘要（超 400 字截断并报告；写入时绑定当前正文版本）；正常链路先由 `story_next` 给出 `summarizer` 委派，子代理通过 `story_submit` 提交摘要，主编不读整章。摘要过期时 `story_next` 会重新要求摘要，`story_state` 返回 `summary-stale`。
- `story_brief`：装配写某一章前的上下文——意图、故事框架、作品规则、本章章纲、当前焦点、涉及人物、未解伏笔、卷图、卷摘要、最近摘要、上一章结尾、文风、字数口径；已写 ≥3 章时追加「相关素材」段（只取 setting/character/scene；最多 3 条、`select.chars ≤1200`），素材段在最后、预算不足时最先被裁。预算口径是 token（CJK 1 字符≈1 token、其余 4 字符≈1 token），默认 2600，可用 `budget` 覆盖；故事框架与作品规则是 protected 硬约束，裁剪在它们之前停止并如实报 `overBudget`；其他段按优先级裁剪并报告裁掉的段。回执带与 `story_context` 同形的 `trace`（每段 chars/tokens、tokenBudget、丢弃原因），同一输入两次结果逐字节一致。
- `story_context` 的检索段：作品内正文 ≥3 章时，按本章任务从作品库 FTS5 召回 current 摘要、未解伏笔（open/progressing/deferred）、卷摘要、素材（标题前缀 + ≤400 片段）与 foundation/角色卡（story_frame/volume_map/book_rules/roles/current_focus）；同时按 `roleMethod` 只取该角色允许的 `SKILL.md` + 单个技能 reference（≤400 片段）。章纲 `threadRefs` 会按 hookId 直接召回 `hook:<id>`（建立章；仅当最近推进早于目标章时才写推进），不依赖关键词。最多 5 条 / 1200 字，每类最多 2 条，`recent` 已发的摘要去重；技能候选带优先级，至少一个槽位。过期摘要、已解伏笔、reopen 前事件与目标章之后的材料不进入。`trace.retrieval` 记录 `engine / query / selectionMode / candidates[{id, kind, source, location?, score}] / semanticSelectedIds`；有技能被发送时 engine 为 `sqlite-fts5-bm25+host-lexical`。检索失败写进 `trace.notes`，检索段被裁剪时 `trace.dropped` 与段上的 `dropped` 标记体现。素材标题与正文都参与 FTS 命中，标题仍显示在片段前缀。

## 素材库

面板“素材”区由宿主直接管理，不经过 LLM：文件选择器导入 `.txt` / `.md` / `.epub` / `.pdf`，列表、重命名、删除；文本 ≤512 KB 且 UTF-8，epub/pdf 源文件 ≤18 MB，抽取文本 ≤2,000,000 字符；扫描版/加密 spine 拒绝，不做 OCR。素材写入作品库 `materials` 表并同步 FTS5，原文件副本放 `.storycraft/materials/`（模型不可读）；每份素材有用途（设定/人物/场景/文风/参考，默认参考），导入时可选、列表可改、可按用途筛选。删除只移除库与索引，保留副本。备份只含作品库，不含 `.storycraft/materials` 原文件；恢复后检索仍可用，但导出原 pdf/epub 会报 `material-origin-missing`。B2 起素材正文进入 `story_context` 检索段（标题前缀 + ≤400 片段）；B3 起 `story_brief` 只取设定/人物/场景，文风/参考仍可被 `story_context` 命中；标题与正文都参与 FTS。

## 作品操作与导出

| 动作 | 行为 |
| --- | --- |
| `story_rename` | 改标题或作品 id；改 id 时库文件一起移，冲突拒绝 |
| `story_delete` | 移入 `.storycraft/trash/`，不再出现在列表 |
| `story_restore` | 恢复回收站里最近一次的同名作品 |
| `story_export` | 导出为 `export:<workId>`；作者从只读 `/exports` 路由取目录，内容含 manifest v6、`book.txt` 与 `book.epub`、各版正文、章纲、摘要、各轮审稿、真值、`foundation/`（story_frame/volume_map/book_rules/roles/current_focus）、卷、事件、提案与 `materials/<id>.<format>` |
| `story_backup` | 生成单作品 DB + 素材 sidecar（无素材时仅 DB），返回 `integrity_check` |

导出是给作者在系统文件管理器里取用的，不是让模型读库；`.storycraft` 仍整体拒绝工具直接访问。

## 基础设定（architect）

新作品在写全书计划前，先由 `architect` 子代理分四阶段生成基础设定：`frame`（故事框架 / 卷图 / 当前焦点）→ `rules`（作品规则）→ `roles`（姓名 + 层级索引）→ `cards`（每人一张角色卡，major/minor）。`story_next` 给出下一阶段与 `delegate:{role:'architect',stage}`；每个阶段用 `story_delegate` 执行，宿主校验后写入 artifact（非法 payload 整批不落）。

四个阶段完成后 `story_next` 返回 `blocked:['foundation-approval']`，作者在面板「基础设定」里查看并点「确认基础设定」；确认只由面板触发，不通知模型自动继续。`story_outline` 仍可手动调用（architect 不可用时的回退），已写全书计划的作品不再提示基础设定。基础设定会进入 `story_brief`、`story_context`、检索、审稿/结算约束与导出；初始 hooks 不在这里生成。

## 阶段机

每章有一个阶段，只能沿 `已规划 → 已写 → 已审 → 已修订/清稿 → 已定稿` 前进；摘要不是独立阶段，当前正文版本的摘要写好后才能定稿。动作在入口校验，缺前置就拒绝并指出下一步：

- 没有章纲不能写正文（`plan-not-found`）；
- 没有审稿清单不能定稿（`review-required`）；没有摘要返回 `summary-required`，摘要过期返回 `summary-stale`；`story_state` 在写库前做确定性预检：重复 fact 三元组按投影去重，未知 hookId、非法转移、无可失效 fact 与二次归档直接拒绝；
- 结算用 `story_settle` 产草案：settler 抽取 `factOps`/`hookOps`/`newHooks`，确定性预检 + `story_state_check`，major/确定性差异带反馈重算一次；默认 8 分钟总预算，超时返回 `settled:false` + `state-settle-timeout`（不重试；有可用 ops 时写未就绪草案，否则不写库），回执带 `attempts` 与 `trace.perAttempt`；零 ops 章也产空草案，定稿写零事件；
- 手动修正仍用 `story_state`，payload 与 settler 同形；`story_state_check` 可在写前只读核对 payload，findings 只作建议，不阻断 `story_state`；
- 定稿要求当前正文版本的审稿没有 `issue` observation；修订后必须再跑一次审稿（新一轮用 `resolved` 指向上一轮 id），清稿审稿直接放行；
- 审稿只对「它记录的那个正文版本」有效：改过正文后要重新审稿才能再修订；定稿只认当前正文版本的 review artifact，且其中没有 `issue`；`reviews` 表已删除；
- 已定稿章改章纲要先带 `reopen: true` 重写正文回退（`chapter-settled`）；
- `reopen` 会追加一条 `reopen`；既有状态事件不撤回，重新结算时同状态 op 与重复 fact 按幂等处理。

`story_next` 是只读查询：告诉模型下一步该调哪个动作、为什么、缺什么；可委派时返回 `delegate.role`（writer/reviewer/reviser/summarizer/architect/planner，architect 另带 `stage`），主编据此调用 `story_delegate`，`action` 保留给手动路径。

## 动作

| 动作 | 做什么 | 拒绝条件 |
| --- | --- | --- |
| `story_init` | 建作品库、真值与检索表；无当前作品时设为当前 | 标题为空；同 id 已存在；会话已有其他当前作品（`work-mismatch`，请新建会话） |
| `story_plan` | 写章纲 | 五项（视角/目标/阻力/代价/结尾变化）缺一；`body` 为空；`threadRefs` 不是数组；已定稿 |
| `story_write` | 写正文并更新字数与版本 | 正文为空；已有正文且未声明 `rewrite`；已定稿且未 `reopen` |
| `story_review` | 写一轮 observation（逐字引文/问题/修法；轮次按章独立编号；空数组合法=清稿） | 正文不存在；已定稿；引文不在正文或章纲；**不改正文** |
| `story_revise` | 生成新版本正文，回执列出本轮处理（resolved）的 observation id | 没有未处理审稿；未指定条目；条目不存在；正文与当前版本相同；模式与改动幅度不符 |
| `story_state_check` | 只读语义对账：把拟写入的 `factOps`/`hookOps`/`newHooks` 交给 validator 子代理核对正文，返回最多 8 条建议性 findings 与正文引文校验；不写库 | 子代理调用 `state-check-parent-denied`；空 payload `empty-state`；缺正文 `chapter-not-written`；已定稿 `chapter-settled`；服务缺失/超时/无提交/正文改版分别返回错误，不返回干净结果 |
| `story_settle` | 结算：settler 从正文抽取 v2 操作，确定性预检 + 语义检查；成功只写状态草案（`state:draft`，不写事件、不定稿），对账退回时写未就绪草案并返回 `settled:false`、proposed 与 findings；`state-invalid` 不写库；总预算 8 分钟，超时返回 `state-settle-timeout` | 子代理调用 `subagent-cannot-land`；闸门同 `story_state`，另要求章已有正文（`chapter-not-written`）；服务缺失/无提交/正文改版分别返回 `state-settle-*`；超时不重试，不产生半成品 |
| `story_state` | 把作者 ops 合并进状态草案（可创建草案），不写事件、不定稿 | 作品或章不存在；未知 hookId `hook-not-found`；非法转移 `hook-transition-invalid`；无可失效 fact `fact-not-found`；空 payload `empty-state`；已定稿重复归档 `chapter-settled`；未修订完成或未清稿；无摘要 `summary-required`；摘要过期 `summary-stale` |
| `story_status` | 只读汇总进度、阶段、版本、未处理问题、未解伏笔；每章带 `hasSummary` / `summaryRevision` / `summaryStale` | 作品不存在；作品库升级失败 `schema-migration-failed` |
| `story_delegate` | 宿主侧跑一个角色（writer/reviewer/reviser/summarizer/architect/planner）：预检、装配上下文、启动子代理、消费 `story_submit`、落库，返回紧凑回执；启动临时故障最多重试 2 次，回执带 `retries` | 预检/阶段错误按原码返回；服务缺失 `delegation-unavailable`；启动重试耗尽 `delegation-transient-exhausted`；单章 token 上限 `chapter-budget-exceeded`；无合格提交 `delegation-no-submission`；当前版本已有摘要 `summary-exists` |
| `story_submit` | 仅子代理调用：提交结构化角色结果，宿主校验字数/mode，失败可重提 | 父代理/非委派 `submit-parent-denied`；超 3 次 `submit-attempts-exhausted` |
| `story_read` | 只读：按 `artifactId`/`revisionId` 读取当前章可读内容；`plan:<n>` 返回 memo JSON，可读旧 memo revision；越界返回 `artifact-not-readable` | 作品不存在；旧章/旧审稿版本 |
| `story_context` | 只读按角色装配上下文；回执带 token 预算 trace（默认 8000，可用 `budget` 覆盖），正文 ≥3 章时 trace 带合同形状的 `retrieval` | 缺章 `chapter-not-found`；缺章纲 `plan-not-found`；缺人物卡 `bible-missing` |
| `story_history` | 只读：正文与章纲版本、当前标记、章纲批准状态 | 作品/章节不存在 |
| `story_next` | 只读：下一步动作、章号、原因、缺什么、`blocked`；可委派时带 `delegate.role`（architect 带 `stage`） | 作品不存在 |
| `story_export` / `story_backup` | 见「作品操作与导出」 | 作品不存在 |

字数口径只有一套：`domain.countWords`（CJK 字符 + 拉丁词，不含标点）；`story_critique` 的 `words` 用同一函数，标点数量单独放在 `chars`。

返回值统一为 `{ ok: true, artifact: { workId, artifactId, revisionId, kind }, … }` 或 `{ ok: false, error: { code, message } }`；模型输出不含文件路径。作品库升级失败返回 `schema-migration-failed`（`work-busy` 可重试），未知版本返回 `schema-version-mismatch`。

## 工作台

侧栏入口「故事工坊」打开一个面板：

- 左侧：「作品 / 回收站」视图与类型筛选；作品列表显示标题、形态、已写/总章数、最新章号、最近更新时间、未处理问题数；底部显示工作区路径与会话状态。回收站可恢复或彻底删除，彻底删除不可撤销。
- 右侧：作品详情——顶部作品栏 + 七个标签「看板 / 章节 / 真值 / 写前上下文 / 素材 / 导出 / 备份」；章节点开后可在「正文 / 章纲 / 摘要 / 版本」间切换；章节列表倒序、20 章/页，可翻页，选中旧章自动跳页；章节行可「前移/后移」；看审稿 observation（id/评估/证据/修法）。看板内可展开「分析」查看审稿分布、角色/模型调用成本，并按章查看节奏；「自检」只读检查库完整性、检索索引、章节版本与状态草案；作品库打不开时仍可点开该作品在错误分支运行自检；「日志」按游标查看逐次调用与失败；「检索」统一查记忆、素材与技能参考，命中带来源/位置。
- 作品栏下方是「下一步」状态卡：每个状态只有一个主按钮（确认基础设定 / 确认全书计划 / 确认章纲 / 写正文 / 审稿 / 修订 / 摘要 / 定稿 / 补卷摘要），次按钮在被禁用时给出原因；导出、抽取文风、基础设定、字数范围等管理入口仍在同一栏。
- 「真值」：五张中文卡片（世界观/人物档案/文风基准/全书计划/作者意图），world/characters/style/intent 用右侧抽屉编辑保存，plan 只读；写前上下文是独立标签，选择目标章后装配。
- 「备份」：创建（DB + 素材 sidecar）、恢复、删除、保留最近 N 份；恢复前自动备份当前版本；列表显示素材份数/大小或“仅数据库/不完整”；恢复会同时还原素材原文件；「重建检索索引」从章节、摘要、事件与素材重建派生索引。导出仍是覆盖快照，备份是历史副本。

`style` 真值里的 `<!-- storycraft:style-samples:start -->` / `<!-- storycraft:style-samples:end -->` 是「抽取文风」的受管区块：重新抽取会替换整块，作者不要把保留标记写进正文；块外文字保留。若 style 编辑器里有未保存内容，重新抽取会覆盖它；先保存或取消。

页面读取作品内容；写操作只有作者直接触发的管理动作：章纲/全书计划确认（`POST /chapter/approve`、`POST /outline/approve`）、章节删除/上下移（`POST /chapter/delete|move`）、文风样例抽取（`POST /style/extract`）、真值编辑（`POST /bible/write`）、素材库的导入/重命名/删除（`POST /api/see-storycraft/materials/*`），面板导出（`POST /api/see-storycraft/export`），以及看板的伏笔标记（`POST /api/see-storycraft/hooks/transition`）。它们不改正文或只做章号重排，也不会自动发送写正文指令；确认后由作者点动作按钮，把指令填入输入框，补充信息后发送。指令按钮在被点击时才校验——没有会话、或当前会话不是故事工坊时只显示原因不投递；故事工坊预设装载失败时，页面顶部直接显示宿主给出的失败原因。

## 读取作用域

讨论/新建阶段不读历史作品由运行时守卫执行，不靠提示词：

- 无当前作品时，`works/` 下的任何路径都被拒绝；有当前作品时只能访问当前作品；
- `glob`/`grep` 省略 `path` 会被拒绝（默认会递归整个工作区），请把 `path` 限定到项目目录或当前作品；
- `.storycraft/`（目录库、作品库、`-wal`、`-shm`）对工具一律不可直接读，只能通过动作或导出访问；
- 项目文件（`AGENTS.md`、`docs/`、`storycraft/` 源码等）不受影响。

## 接口

宿主半边提供只读路由与少量作者写路由（仅本机、需浏览器同源 cookie；素材写路由还校验当前作品）：

| 路由 | 用途 |
| --- | --- |
| `POST /chapter/approve` | 作者确认本章章纲（写 `planApprovedAt`） |
| `POST /outline/approve` | 作者确认全书计划（写 `outline.approvedAt`） |
| `GET /api/see-storycraft/works?root=<工作区>` | 作品列表 |
| `GET /api/see-storycraft/work?root=&id=` | 一个作品的章节、状态、伏笔 |
| `GET /api/see-storycraft/chapter?root=&id=&chapter=&view=body\|plan&revision=` | 章正文或章纲 |
| `GET /api/see-storycraft/review?root=&id=&chapter=` | 最新章节的审稿条目与轮次 |
| `POST /api/see-storycraft/chapter/delete` | 删除章节并前移后续章号（需确认，自动备份） |
| `POST /api/see-storycraft/chapter/move` | 相邻章上移/下移并重排章号 |
| `POST /api/see-storycraft/style/extract` | 从当前正文抽取文风样例到 style 受管区块 |
| `POST /api/see-storycraft/bible/write` | 保存可编辑真值（world/characters/style/intent；plan 拒绝；64KB；可选 `expectedVersion`） |
| `GET /api/see-storycraft/state?root=&id=` | 一个作品的进度摘要 |
| `GET /api/see-storycraft/analysis?root=&id=` | 分析：最新审稿分布与角色/模型调用成本（只读，不含正文） |
| `GET /api/see-storycraft/self-check?root=&id=` | 自检：库完整性、检索索引、章节版本与状态草案（只读） |
| `GET /api/see-storycraft/logs?root=&id=&before=&limit=&failed=true` | 调用日志：逐次 role/outcome/error_code/耗时/token（只读，不含正文） |
| `GET /api/see-storycraft/search?root=&id=&q=` | 统一检索：记忆/素材/技能参考，返回来源、技能位置与片段（只读） |
| `GET /api/see-storycraft/bible?root=&id=&file=` | 真值文件与内容版本 |
| `GET /api/see-storycraft/brief?root=&id=&chapter=` | 写前上下文装配结果 |
| `GET /api/see-storycraft/materials?root=&workId=&purpose=` | 素材元数据列表（可按用途过滤） |
| `POST /api/see-storycraft/materials/import` | 上传 txt/md/epub/pdf 导入（JSON + base64；可选 purpose；epub/pdf 抽文本并保留原文件） |
| `POST /api/see-storycraft/materials/rename` | 重命名素材标题 |
| `POST /api/see-storycraft/materials/purpose` | 修改素材用途 |
| `POST /api/see-storycraft/materials/delete` | 删除素材库记录与索引（保留副本） |
| `POST /api/see-storycraft/export` | 面板直接导出（原子替换，返回目录与文件数） |
| `GET /api/see-storycraft/exports?root=&id=` | 作者导出目录状态（只读） |
| `GET /api/see-storycraft/backups?root=&id=` | 作者备份列表：DB/素材 sidecar 元数据（只读） |
| `POST /api/see-storycraft/chapter/history` | 作者读取章节正文/章纲版本与当前标记（只读） |
| `POST /api/see-storycraft/chapter/adopt` | 作者回滚到正文/章纲历史版本（需确认） |
| `POST /api/see-storycraft/recover/rebuild-index` | 作者触发：重建检索索引（需确认，不改正文） |
| `GET /api/see-storycraft/roster` | 预设名册（含装载失败原因） |
| `GET /api/see-storycraft/document?id=` | 某预设的完整声明 |

`root` 必须是宿主工作区注册表认识的工作区目录，否则返回 `unknown-workspace`；参数不合法或作品不存在都返回同一个失败信封 `{ ok:false, error:{ code, message } }`。

## 目录

```text
storycraft/
  package.json                 # bundle 清单：dsh.bundle.patch + dsh.client
  cordis.patch.yml             # 入口行 + 一条预设声明（故事工坊，技能行 mode: all）
  src/                         # 源码（TypeScript）：
    index.ts                   #   只读路由 + 作者确认/素材管理/面板导出
    tools.ts                   #   动作（注册在预设作用域）
    delegate.ts                #   宿主侧角色委派：预检、子代理、输出校验、落库、回执
    state-check.ts             #   story_state_check：只读语义对账、findings 与引文校验
    state-settle.ts            #   story_settle：settler 抽取、一次反馈重算、fold 或未解决回执
    facts.ts                   #   白名单唯一派生入口：只读已落库资料，正文与任务不参与
    context.ts                 #   角色上下文拼装：按角色分段、保护级别、预算裁剪、检索段、轨迹、白名单摘要
    role-input.ts              #   story_context 与 story_delegate 共用的角色输入读取
    landing.ts                 #   落库前白名单校验（checkDraft），consistency 保持纯比较
    consistency.ts             #   输出一致性：未登记人名/地名/尺寸告警，不阻断
    bible.ts                   #   真值、摘要与写前上下文
    proposals.ts               #   提案：讨论与立项之间的桥
    skills.ts                  #   按模式提供技能目录
    client.ts                  #   浏览器半边：侧栏入口 + 工作台（esbuild 编译成单文件）
    …                          #   其余数据层与存储层模块
  types/dsh.d.ts               # 本包实际使用的 DSH ctx/exec 面
  types/client.d.ts            # 浏览器加载器与 React 注入面
  lib/                         # 构建产物，不提交；prepack 构建（tsdown 出 Host 入口，esbuild 出 client.js）
  skills/<mode>/<skill>/…      # 技能正文与脚本
  icon.svg
```

## 验证入口

- 单元测试在 `storycraft/tests/*.test.mjs`：每个文件自带断言，成功时以 `ALL CHECKS PASSED` 结束。全部运行：

  ```powershell
  Get-ChildItem storycraft/tests -Filter *.test.mjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE) { exit 1 } }
  ```

- 页面 spec：`node storycraft/e2e/run.mjs`。它起一个临时 DSH 实例（独立 `DSH_HOME`、临时端口、预置 fixture 工作区），跑 48 条页面 spec——侧栏入口、加载契约（无 `pageerror`、`/api/see-storycraft/works` 200）、页面读数、作者确认、摘要徽标、素材导入/重命名/删除/PDF-EPUB、面板导出、章节倒序分页/前移后移、文风样例、看板分析/自检/日志/统一检索、真值抽屉、备份/素材恢复、指令门禁、预设声明与刷新。不调用模型，零额度；Playwright 是本包 devDependency（首次 `npm install && npx playwright install chromium`），`node storycraft/e2e/run.mjs --list` 可只看清单。
- `node storycraft/scripts/ci.mjs` 依次跑：Host 与 Client 类型检查（`tsc -p`，`--noEmit`）、全部单元文件（直接 import `src/*.ts`，靠 Node 类型擦除，不先构建）、`scripts/build.mjs`（tsdown 出 Host 入口 + esbuild 出 `client.js`）、pack-check，最后二选一：默认跑复制安装的页面 spec，`--smoke` 跑 tarball 安装 smoke（`npm pack` → `dsh plugin add <tgz>` → 冷启动 → 加载契约）。
- 端到端验收、评审与证据记录在 issue `dehuadong/dsh-nove#18`。

## 安装与打包

两种安装方式，生效方式不同，别混：

| 装法 | 命令 | 生效 |
| --- | --- | --- |
| 开发（`link:`） | `dsh plugin add link:<仓库路径>/storycraft` | 改完 `npm run build` 后重新加载窗口 |
| tarball / registry | `npm pack` 后 `dsh plugin add <tgz>`，或 `dsh plugin add see-storycraft@<版本>` | **重启 DeepSeek Harness**（渲染进程跑的是启动时那份客户端 bundle，正式构建没有「重新加载页面」菜单项） |

发布前用 tarball 走一遍真实验收，不要用 `link:`：

```powershell
cd storycraft
node scripts/ci.mjs --smoke
```

它等价于 `npm pack` → `dsh plugin add <tgz>` → `--dump-config` 断言层 → 冷启动 → 跑 `e2e/load.spec.cjs`。首次运行会在 `.tmp-smoke/` 建一个一次性 `DSH_HOME`，不碰你的 desktop profile；`DSH_SMOKE_KEEP=1` 可保留现场。

`npm pack` 的清单由 `package.json` 的 `files` 拥有，`pack-check.mjs` 检查实际 tarball：`lib/` 的四个入口（`index`、`tools`、`skills`、`client`）、`skills/`、`cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE` 必须在；`src/` 的逐模块产物、`tests/`、`e2e/`、根 `scripts/`、报告与临时目录必须不在。发布字段也在这一步校验：`private` 不能存在、`engines.dsh` 必须存在、`license` 要与 `LICENSE` 一致。断言逻辑在 `scripts/pack-manifest.mjs`（纯函数，负例由 `tests/packaging-manifest.test.mjs` 覆盖）。`npm publish` 会先跑 `prepublishOnly`（构建 + pack-check）再打包。

回滚时重新安装上一个 tarball；开发环境切回 `link:`。

## TypeScript 接入

Host 与 Client 都已迁到 TS 的 L0–L5 层：`scope`、叶子层、数据层、存储层、消费与 DSH 接缝（`bible`、`facts`、`landing`、`consistency`、`context`、`role-input`、`submission`、`proposals`、`state-check`、`state-settle`、`delegate`、`tools`、`index`）、技能入口 `skills`，以及浏览器入口 `client`。`src/store-rows.ts` 定义 SQLite 表行类型，`types/dsh.d.ts` 与本包的 `types/client.d.ts` 声明实际使用的宿主面。

- 源文件：`src/*.ts`；Host 由 tsdown 打成 `lib/{index,tools,skills}.js`，Client 由 esbuild 转译成 `lib/client.js`；`tsconfig.json` 只用 `tsc -p` 做类型检查（`noEmit`），`lib/` 由构建生成，不提交；
- 包入口：`exports` 的 `.`、`./tools`、`./skills`、`./client` 全部指向 `lib/`；
- 安装依赖：`npm install`（`tsdown`、`esbuild`、`typescript`、`@types/node`、`@types/react` 都是 devDependencies，不进安装包）；
- 编译：`npm run build` → `scripts/build.mjs`（先 tsdown 再 esbuild）；`prepack` 自动 build；
- Client 不是 ES module：`src/client.ts` 由 esbuild 单文件转译到 `lib/client.js`，保留 `window.__ModuleLoader__.load({ factory(require) })` 外壳，`require('react')` 原样交给宿主加载器；它不能进打包器，否则外壳与 `require` 会被改写；
- 模块之间 import 写同层 `'./<module>.ts'`：打包器与 Node 的类型擦除都按源码路径解析；每个入口被打包成一个文件，源码模块不逐个发布；
- 测试与 e2e fixture 直接 import `src/*.ts`，因此要求 Node ≥22.18（类型擦除）；打包后不再有一对一的 `lib/<module>.js`；
- 技能目录固定在包根 `skills/`，`lib/skills.js` 以自身位置为基准上跳一级解析（源码在 `src/` 被测试直接 import 时同样上跳一级）。

开发 `link:` 时先 build；改 `src/*.ts` 后重新 build，不手改 `lib/`。

## 改动与生效

包以 `link:` 装入 profile 时，改 `src/client.ts` 并重新 `npm run build` 后刷新窗口即可；改 `cordis.patch.yml` 或 Host 半边需要重启应用，或让 `plugin_manager` 把 bundle 关→开重载补丁。**tarball 与 registry 安装没有这个便利**：客户端 bundle 只在应用启动时拉取，装完必须重启 DeepSeek Harness。停用用 `set_bundle enabled:false`，卸载用 `remove_bundle`。

## 阶段上下文

| 阶段 | 给什么 | 不给什么 |
| --- | --- | --- |
| 讨论/提案 | 作者想法、形态、目标读者、字数范围 | 作品库内容 |
| 立项 | 已确认提案、标题、形态、字数范围 | 其他作品、旧正文 |
| 全书计划 | 作者意图、形态、字数、已有设定（`story_bible` / `story_read(outline)`） | 正文、文件路径 |
| 章纲 | 全书计划、卷、相关人物、前情摘要、本章目标 | 旧章全文 |
| 写正文 | 本章章纲、人物卡、未解伏笔、上一章结尾、文风、字数范围 | 其他章正文 |
| 审稿 | 当前章正文、章纲、人物卡、审稿标准 | 其他作品、其他章正文 |
| 修订 | 当前正文版本、未处理审稿条目、mode | 全库、旧版本正文 |
| 清稿 | 当前正文、零问题审稿结果 | 其他作品 |
| 摘要 | 当前章正文、`state`；摘要绑定当前正文版本 | 其他作品、旧摘要当当前 |
| 定稿 | 当前版本摘要、`state`；过期摘要先重写 | 其他作品 |

内容只通过动作读取；模型只拿 artifact ID，不拿文件路径。
