# 故事工坊（dsh-storycraft）

DSH 里的长篇创作编排：三十二个动作把立项、章纲、正文、审稿、修订、定稿归档与导出备份落到**一作品一库**的 SQLite 存储，一个**工作台**以只读方式看作品与章节，并按键把固定指令投给当前会话。故事工坊是**一个工作模式**（一个 Agent 预设），以标准预设为基线再挂自己的动作、技能与人设。

## 现状

| 工作模式 | 人设 | 技能 | 动作 | 工作台 |
| --- | --- | --- | --- | --- |
| 故事工坊 `storycraft` | 有（主编 / 子代理两用） | 有（长篇 / 短篇 / 剧本形态技能 + 角色写法、审稿、修订、规划、状态结算与对账；长篇另有方法参考） | **有**：`story_init` `story_plan` `story_write` `story_review` `story_revise` `story_settle` `story_state` `story_state_check` `story_status` `story_next` `story_delegate` `story_submit`，以及真值四件 `story_bible` `story_bible_write` `story_bible_import` `story_summarize`、只读 `story_read` 与写前上下文 `story_brief`；常备能力 `story_export` `story_backup` | 有 |

动作按预设作用域注册：只有「故事工坊」会话能看到 `story_*`，其他模式与其他会话的工具面不变。形态（长篇 / 短篇 / 剧本）是作品数据（`catalog.db` 的 `works.form`），不是预设；同一会话里可以分别打开三种形态的作品。

## 角色与委派

写手、审稿、修订、摘要、规划**不是预设**，而是子代理；写手/审稿/修订/摘要默认由宿主动作 `story_delegate` 通过官方 `subagents` 服务启动，规划仍用手动 `subagent`：

- `story_delegate` 在宿主侧预检、装配上下文、启动子代理、校验并落库；主编只收紧凑回执，正文不进入主会话；
- 手动兜底仍用官方 `subagent`：省略 `agentPreset`，子代理加入故事工坊当前组合；角色由任务提示与对应技能（`storycraft-write-craft`、`storycraft-review`、`storycraft-revise-craft`、`storycraft-plan-craft`）决定；
- 写手按作品 `form` 追加形态技能：短篇加 `storycraft-short-story`，剧本加 `storycraft-short-drama`，提示按「章 / 篇 / 集」显示单位；
- 定稿前的状态对账由 `storycraft-state-check` 子代理完成（`story_state_check`），只读、只出建议；它不替代 `storycraft-review` 的正文审稿；
- 定稿本身优先由 `story_settle` 自动完成：`storycraft-state-settler` 从正文抽取 delta，再走 `story_state_check`；未解决时用 `story_state` 手动修正；
- 长篇任务里，规划、写作、审稿与定稿前的主编按各自技能正文的触发加载 `storycraft-longform-method` 的 references；方法技能只给判断依据，不产出提交内容，也不替代角色技能的输出契约；
- 委派子代理通过 `story_submit` 提交结构化结果；预设作用域的守卫拒绝它调用 `write`、`edit`、`pwsh`、`bash` 与写动作（`story_write`、`story_review`、`story_revise`、`story_delegate` 等），落库一律由宿主/主编完成；
- 委派深度固定为 1，子代理不能再派发。

## 立项与提纲

1. 作者用自然语言给出想法 → 模型只讨论，不写文件；
2. 方向成熟后 `story_propose` 把提案写进 `catalog.db`（不是作品），作者确认后 `story_init`（必须带 proposal）；
3. 立项只建库与真值骨架；接着 `story_outline` 写主线/卷划分/结局方向到真值 `plan`；
4. 作者在面板点「确认全书计划」后由宿主记录（`POST /outline/approve`）；模型不能代签，未确认前任何章的 `story_plan` 都被拒（`outline-required`）；
5. 单章章纲的确认按作品设置 `planApproval` 执行：默认 `required`（新章取写手上下文时即拒绝，`plan-not-approved`；落盘再校验一次），可设为 `off` 关闭逐章确认；
6. 确认后才能写任何章的章纲。

## 形态

| 形态 | `story_init` 的 form | 单位 | 技能 |
| --- | --- | --- | --- |
| 长篇 | `longform`（默认） | 章 | 单章写法：章纲 → 正文 → 审稿 → 修订/清稿 → 摘要 → 定稿 |
| 短篇 | `short` | 篇 | 短篇写法：一篇写到底，流程同上 |
| 剧本 | `script` | 集 | 竖屏短剧写法：按场次与台词组织，流程同上 |

形态是作品数据，决定用哪套技能与页面单位；动作与门禁完全一致。没有已知形态时按长篇读取。

## 长篇方法参考

`storycraft-longform-method` 是规划、写作、审稿与定稿前主编共用的长篇判断依据，不产出提交内容。三份 references 分别覆盖基础设计、读者承诺与推进、状态投影；各自技能正文点名什么时候读哪一份。方法技能只给判断标准，不替代角色输出契约。

## 作品库

工作区下只有一棵存储目录，作品内容不出工作区：

```text
<工作区>/.storycraft/
  catalog.db                 目录：works、proposals、session_current
  works/<workId>.db          单部作品的全部内容
  trash/<workId>.db          软删除的作品库
  materials/                 素材托管副本（模型不可读；删除素材时保留）
  exports/<workId>/          按需导出（作者在系统文件管理器里取用）
  backups/<workId>-<ts>.db   单作品备份
```

`catalog.db` 只存元数据，是 title/form/tags 的权威；作品库的 `meta` 行是导出副本。每部作品独立 `user_version`，升级一部不影响其他；v1–v4 首次打开自动迁移到 v5（摘要 revision + `materials` 表 + 素材用途 + 标题索引），迁移失败返回 `schema-migration-failed`，目录会把该作品标为降级而不是静默跳过。表结构、连接策略、改名/删除/恢复顺序与启动对账的完整设计见 [作品入库 Note](../.agents/notes/implemented/pipeline/2026-10-19-storycraft-sqlite-store.md)。

动作与路由返回的模型可见 artifact 只有 `artifactId` / `revisionId` / `kind`，不含文件路径；正文/章纲/审稿/摘要等内容按 ID 用 `story_read` 或上下文动作读取。UI 与作者导出仍显示路径；实际内容在作品库内。宿主启动及首次读取一个工作区时对账目录与文件：缺失的作品在列表跳过并记入宿主诊断，孤儿文件与回收站文件保留待人工恢复。

## 真值与写前上下文

每部作品有一套真值，由动作建立与校验（模型不直写）：

```text
bible/world       世界观：时代、地理、规则边界、已定事实
bible/characters  人物档案：[{ name, role, want, fear, limit, voice }]
bible/style       文风基准：人称、时态、句长节奏、禁用词与口头禅
bible/plan        写作计划与章序规划
bible/intent      作者意图与当前焦点
summaries         章节摘要（上限 400 字；revision 绑定正文版本）
materials         作者素材（txt/md；用途 setting/character/scene/style/reference；FTS5 索引；元数据表格 + .storycraft/materials 副本）
```

- `story_bible`：读真值（可指定一份），缺失时指出缺哪几份。
- `story_bible_write`：校验后写入并返回内容版本；人物档案缺字段或重名会被拒绝，原内容不变。
- `story_bible_import`：把旧文件作品的世界观收编进真值，并列出仍需作者补的项（不替作者编人物档案）；不导入大纲，大纲只走 `story_outline` + 作者确认。
- `story_summarize`：手动写章节摘要（超 400 字截断并报告；写入时绑定当前正文版本）；正常链路先由 `story_next` 给出 `summarizer` 委派，子代理通过 `story_submit` 提交摘要，主编不读整章。摘要过期时 `story_next` 会重新要求摘要，`story_state` 返回 `summary-stale`。
- `story_brief`：装配写某一章前的上下文——意图、本章章纲、涉及人物、未解伏笔、卷摘要、最近摘要、上一章结尾、文风、字数口径；已写 ≥3 章时追加「相关素材」段（只取 setting/character/scene；最多 3 条、`select.chars ≤1200`），素材段在最后、预算不足时最先被裁。默认 8 KB，超预算按优先级裁剪并报告裁掉的段；同一输入两次结果逐字节一致。
- `story_context` 的检索段：作品内正文 ≥3 章时，按本章任务从作品库 FTS5 召回 current 摘要、未解/已用伏笔、卷摘要与素材（标题前缀 + ≤400 片段）；最多 5 条 / 1200 字，每类最多 2 条，`recent` 已发的摘要去重。过期摘要、已解伏笔、reopen 前事件与目标章之后的材料不进入。`trace.retrieval` 记录 `enabled / query / candidateCount / hits[{id, kind, sourceIds, score, sent}]` 与可选 `error`；hits 最多 15 条（前 10 ∪ sent），整段被预算裁掉时 `sent` 全为 false。素材标题与正文都参与 FTS 命中，标题仍显示在片段前缀。

## 素材库

面板“素材”区由宿主直接管理，不经过 LLM：文件选择器导入 `.txt` / `.md`，列表、重命名、删除；单文件 ≤512 KB、UTF-8。素材写入作品库 `materials` 表并同步 FTS5，副本放 `.storycraft/materials/`（模型不可读）；每份素材有用途（设定/人物/场景/文风/参考，默认参考），导入时可选、列表可改、可按用途筛选。删除只移除库与索引，保留副本。B2 起素材正文进入 `story_context` 检索段（标题前缀 + ≤400 片段）；B3 起 `story_brief` 只取设定/人物/场景，文风/参考仍可被 `story_context` 命中；标题与正文都参与 FTS。

## 作品操作与导出

| 动作 | 行为 |
| --- | --- |
| `story_rename` | 改标题或作品 id；改 id 时库文件一起移，冲突拒绝 |
| `story_delete` | 移入 `.storycraft/trash/`，不再出现在列表 |
| `story_restore` | 恢复回收站里最近一次的同名作品 |
| `story_export` | 导出为 `export:<workId>`；作者从只读 `/exports` 路由取目录，内容含 manifest v6、`book.txt` 与 `book.epub`、各版正文、章纲、摘要、各轮审稿、真值、卷、事件、提案与 `materials/<id>.<format>` |
| `story_backup` | 用 SQLite 备份 API 生成单作品文件，返回 `integrity_check` |

导出是给作者在系统文件管理器里取用的，不是让模型读库；`.storycraft` 仍整体拒绝工具直接访问。

## 阶段机

每章有一个阶段，只能沿 `已规划 → 已写 → 已审 → 已修订/清稿 → 已定稿` 前进；摘要不是独立阶段，当前正文版本的摘要写好后才能定稿。动作在入口校验，缺前置就拒绝并指出下一步：

- 没有章纲不能写正文（`plan-not-found`）；
- 没有审稿清单不能定稿（`review-required`）；没有摘要返回 `summary-required`，摘要过期返回 `summary-stale`；`story_state` 在写库前做确定性预检：重复事实只 warning，重复/倒退伏笔与二次归档直接拒绝；
- 定稿优先用 `story_settle` 自动结算：settler 抽取 delta，确定性预检 + `story_state_check`，major/确定性差异带反馈重算一次；仍不一致返回 `settled:false`，不写库；首次空 delta 可定稿，但被 major 拒绝后的第二次空 delta 仍视为未解决；
- 手动修正仍用 `story_state`；`story_state_check` 可在写前只读核对 delta，findings 只作建议，不阻断 `story_state`；
- 审稿条目没处理完不能定稿，错误里列出条目 id；
- 审稿只对「它记录的那个正文版本」有效：改过正文后要重新审稿才能再修订；清稿审稿必须针对当前版本；定稿允许「有问题的审稿针对上一版、条目已全处理」；
- 已定稿章改章纲要先带 `reopen: true` 重写正文回退（`chapter-settled`）；
- `reopen` 会在事件表里追加一条 `reopen`，该章旧的定稿不再计入状态折叠。

`story_next` 是只读查询：告诉模型下一步该调哪个动作、为什么、缺什么；可委派时返回 `delegate.role`（writer/reviewer/reviser/summarizer），主编据此调用 `story_delegate`，`action` 保留给手动路径。

## 动作

| 动作 | 做什么 | 拒绝条件 |
| --- | --- | --- |
| `story_init` | 建作品库、真值与检索表；无当前作品时设为当前 | 标题为空；同 id 已存在；会话已有其他当前作品（`work-mismatch`，请新建会话） |
| `story_plan` | 写章纲 | 五项（视角/目标/阻力/代价/结尾变化）缺一；已定稿 |
| `story_write` | 写正文并更新字数与版本 | 正文为空；已有正文且未声明 `rewrite`；已定稿且未 `reopen` |
| `story_review` | 写问题清单（轮次按章独立编号；空清单表示清稿） | 正文不存在；已定稿；**不改正文** |
| `story_revise` | 生成新版本正文并把条目改为已处理 | 没有审稿清单；未指定条目；条目不存在；正文与当前版本相同；模式与改动幅度不符 |
| `story_state_check` | 只读语义对账：把拟写入的 delta 交给 validator 子代理核对正文，返回最多 8 条建议性 findings 与正文引文校验；不写库 | 子代理调用 `state-check-parent-denied`；空 delta `empty-state`；缺正文 `chapter-not-written`；已定稿 `chapter-settled`；服务缺失/超时/无提交/正文改版分别返回错误，不返回干净结果 |
| `story_settle` | 自动结算：settler 从正文抽取 delta，确定性预检 + 语义检查；major/确定性差异带反馈重算一次；成功 fold 并定稿，未解决返回 `settled:false`、proposed 与 findings，不写库 | 子代理调用 `subagent-cannot-land`；闸门同 `story_state`，另要求章已有正文（`chapter-not-written`）；服务缺失/超时/无提交/正文改版分别返回 `state-settle-*`，不产生半成品 |
| `story_state` | 手动追加人物事实与伏笔事件，返回新增/已用/已解/未解计数与 `warnings` | 作品或章不存在；伏笔状态非法；「已用」指向未解伏笔；「已解」指向不存在的伏笔；重复/倒退伏笔 `duplicate-hook`；已定稿重复归档 `chapter-settled`；未修订完成或未清稿；无摘要 `summary-required`；摘要过期 `summary-stale` |
| `story_status` | 只读汇总进度、阶段、版本、未处理问题、未解伏笔；每章带 `hasSummary` / `summaryRevision` / `summaryStale` | 作品不存在；作品库升级失败 `schema-migration-failed` |
| `story_delegate` | 宿主侧跑一个角色（writer/reviewer/reviser/summarizer）：预检、装配上下文、启动子代理、消费 `story_submit`、落库，返回紧凑回执 | 预检/阶段错误按原码返回；服务缺失 `delegation-unavailable`；无合格提交 `delegation-no-submission`；当前版本已有摘要 `summary-exists` |
| `story_submit` | 仅子代理调用：提交结构化角色结果，宿主校验字数/mode，失败可重提 | 父代理/非委派 `submit-parent-denied`；超 3 次 `submit-attempts-exhausted` |
| `story_read` | 只读：按 `artifactId`/`revisionId` 读取当前章可读内容；越界返回 `artifact-not-readable` | 作品不存在；旧章/旧审稿版本 |
| `story_context` | 只读按角色装配上下文；正文 ≥3 章时带 FTS5 检索段与 `trace.retrieval` | 缺章 `chapter-not-found`；缺章纲 `plan-not-found`；缺人物卡 `bible-missing` |
| `story_next` | 只读：下一步动作、章号、原因、缺什么；可委派时带 `delegate.role` | 作品不存在 |
| `story_export` / `story_backup` | 见「作品操作与导出」 | 作品不存在 |

字数口径只有一套：`domain.countWords`（CJK 字符 + 拉丁词，不含标点）；`story_critique` 的 `words` 用同一函数，标点数量单独放在 `chars`。

返回值统一为 `{ ok: true, artifact: { workId, artifactId, revisionId, kind }, … }` 或 `{ ok: false, error: { code, message } }`；模型输出不含文件路径。作品库升级失败返回 `schema-migration-failed`（`work-busy` 可重试），未知版本返回 `schema-version-mismatch`。

## 工作台

侧栏入口「故事工坊」打开一个面板：

- 左侧：「作品 / 回收站」视图与类型筛选；作品列表显示标题、形态、已写/总章数、最新章号、最近更新时间、未处理问题数；底部显示工作区路径与会话状态。回收站可恢复或彻底删除，彻底删除不可撤销。
- 右侧：作品详情——顶部作品栏 + 六个标签「章节 / 真值 / 写前上下文 / 素材 / 导出 / 备份」；章节列表倒序、20 章/页，可翻页，选中旧章自动跳页；章节行可「前移/后移」；章节点开后可切「正文 / 章纲」两视图、看审稿清单。
- 「真值」：五张中文卡片（世界观/人物档案/文风基准/全书计划/作者意图），world/characters/style/intent 用右侧抽屉编辑保存，plan 只读；写前上下文是独立标签，选择目标章后装配。
- 「备份」：创建、恢复、删除、保留最近 N 份；恢复前自动备份当前版本；导出仍是覆盖快照，备份是历史副本。

`style` 真值里的 `<!-- storycraft:style-samples:start -->` / `<!-- storycraft:style-samples:end -->` 是「抽取文风」的受管区块：重新抽取会替换整块，作者不要把保留标记写进正文；块外文字保留。若 style 编辑器里有未保存内容，重新抽取会覆盖它；先保存或取消。

页面读取作品内容；写操作只有作者直接触发的管理动作：章纲/全书计划确认（`POST /chapter/approve`、`POST /outline/approve`）、章节删除/上下移（`POST /chapter/delete|move`）、文风样例抽取（`POST /style/extract`）、真值编辑（`POST /bible/write`）、素材库的导入/重命名/删除（`POST /api/dsh-storycraft/materials/*`），以及面板导出（`POST /api/dsh-storycraft/export`）。它们不改正文或只做章号重排，也不会自动发送写正文指令；确认后由作者点动作按钮，把指令填入输入框，补充信息后发送。指令按钮在被点击时才校验——没有会话、或当前会话不是故事工坊时只显示原因不投递；故事工坊预设装载失败时，页面顶部直接显示宿主给出的失败原因。

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
| `GET /api/dsh-storycraft/works?root=<工作区>` | 作品列表 |
| `GET /api/dsh-storycraft/work?root=&id=` | 一个作品的章节、状态、伏笔 |
| `GET /api/dsh-storycraft/chapter?root=&id=&chapter=&view=body\|plan&revision=` | 章正文或章纲 |
| `GET /api/dsh-storycraft/review?root=&id=&chapter=` | 最新章节的审稿条目与轮次 |
| `POST /api/dsh-storycraft/chapter/delete` | 删除章节并前移后续章号（需确认，自动备份） |
| `POST /api/dsh-storycraft/chapter/move` | 相邻章上移/下移并重排章号 |
| `POST /api/dsh-storycraft/style/extract` | 从当前正文抽取文风样例到 style 受管区块 |
| `POST /api/dsh-storycraft/bible/write` | 保存可编辑真值（world/characters/style/intent；plan 拒绝；64KB；可选 `expectedVersion`） |
| `GET /api/dsh-storycraft/state?root=&id=` | 一个作品的进度摘要 |
| `GET /api/dsh-storycraft/bible?root=&id=&file=` | 真值文件与内容版本 |
| `GET /api/dsh-storycraft/brief?root=&id=&chapter=` | 写前上下文装配结果 |
| `GET /api/dsh-storycraft/materials?root=&workId=&purpose=` | 素材元数据列表（可按用途过滤） |
| `POST /api/dsh-storycraft/materials/import` | 上传 txt/md 导入（JSON + base64；可选 purpose） |
| `POST /api/dsh-storycraft/materials/rename` | 重命名素材标题 |
| `POST /api/dsh-storycraft/materials/purpose` | 修改素材用途 |
| `POST /api/dsh-storycraft/materials/delete` | 删除素材库记录与索引（保留副本） |
| `POST /api/dsh-storycraft/export` | 面板直接导出（原子替换，返回目录与文件数） |
| `GET /api/dsh-storycraft/exports?root=&id=` | 作者导出目录状态（只读） |
| `GET /api/dsh-storycraft/backups?root=&id=` | 作者备份文件列表（只读） |
| `GET /api/dsh-storycraft/roster` | 预设名册（含装载失败原因） |
| `GET /api/dsh-storycraft/document?id=` | 某预设的完整声明 |

`root` 必须是宿主工作区注册表认识的工作区目录，否则返回 `unknown-workspace`；参数不合法或作品不存在都返回同一个失败信封 `{ ok:false, error:{ code, message } }`。

## 目录

```text
storycraft/
  package.json                 # bundle 清单：dsh.bundle.patch + dsh.client
  cordis.patch.yml             # 入口行 + 一条预设声明（故事工坊，技能行 mode: all）
  index.js                     # Host 半边：只读路由 + 作者确认/素材管理/面板导出
  db.js                        # SQLite 目录库 / 作品库 schema、连接、检查点与备份
  store-db.js                  # 全部读写：作品、章节、真值、卷、素材、检索、生命周期、导出备份
  state-validation.js          # story_state 的确定性预检：重复事实、伏笔状态机、二次归档
  state-check.js               # story_state_check：只读语义对账、findings 与引文校验
  state-settle.js              # story_settle：settler 抽取、一次反馈重算、fold 或未解决回执
  materials.js                 # 素材上传字节校验、文件名、哈希与元数据
  search-text.js               # FTS 分词与素材标题/正文索引文本
  storage.js                   # 稳定门面：动作与路由从这里取领域函数与存储函数
  domain.js                    # 共享词汇：错误码、id、阶段、审稿文本、事件折叠
  facts.js                     # 白名单唯一派生入口：只读已落库资料，正文与任务不参与
  context.js                   # 角色上下文拼装：按角色分段、保护级别、预算裁剪、检索段、轨迹、白名单摘要
  retrieval.js                 # 检索查询与整条选择（纯函数，无 I/O）
  role-input.js                # story_context 与 story_delegate 共用的角色输入读取
  landing.js                   # 落库前白名单校验（checkDraft），consistency.js 保持纯比较
  delegate.js                  # 宿主侧角色委派：预检、子代理、输出校验、落库、回执
  consistency.js               # 输出一致性：未登记人名/地名/尺寸告警，不阻断
  bible.js                     # 真值、摘要与写前上下文
  proposals.js                 # 提案：讨论与立项之间的桥
  volumes.js                   # 卷
  tools.js                     # 动作（注册在预设作用域）
  skills.js                    # 按模式提供技能目录
  client.js                    # 浏览器半边：侧栏入口 + 工作台
  skills/<mode>/<skill>/…      # 技能正文与脚本
  icon.svg
```

## 验证入口

- 单元测试在 `storycraft/tests/*.test.mjs`：每个文件自带断言，成功时以 `ALL CHECKS PASSED` 结束。全部运行：

  ```powershell
  Get-ChildItem storycraft/tests -Filter *.test.mjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE) { exit 1 } }
  ```

- 页面 spec：`node storycraft/e2e/run.mjs`。它起一个临时 DSH 实例（独立 `DSH_HOME`、临时端口、预置 fixture 工作区），跑 19 条页面 spec（工作台 17 + 预设 2）——侧栏入口、页面读数、作者确认、摘要徽标、素材导入/重命名/删除、面板导出、章节倒序分页/前移后移、文风样例、真值抽屉、备份恢复、指令门禁、预设声明与刷新。不调用模型，零额度；需要本机装有 Playwright（可用 `DSH_E2E_PLAYWRIGHT_ROOT` 指向已安装它的目录）。
- 端到端验收、评审与证据记录在 issue `dehuadong/dsh-nove#18`。

## 改动与生效

包以 `link:` 装入 profile，改 `client.js` 后刷新窗口即可；改 `cordis.patch.yml` 或 Host 半边（`index.js`、`tools.js`、`delegate.js`、`db.js`、`store-db.js`）需要重启应用，或让 `plugin_manager` 把 bundle 关→开重载补丁。停用用 `set_bundle enabled:false`，卸载用 `remove_bundle`。

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
