# 故事工坊（dsh-storycraft）

DSH 里的长篇创作编排：三十个动作把立项、章纲、正文、审稿、修订、定稿归档与导出备份落到**一作品一库**的 SQLite 存储，一个**工作台**以只读方式看作品与章节，并按键把固定指令投给当前会话。故事工坊是**一个工作模式**（一个 Agent 预设），以标准预设为基线再挂自己的动作、技能与人设。

## 现状

| 工作模式 | 人设 | 技能 | 动作 | 工作台 |
| --- | --- | --- | --- | --- |
| 故事工坊 `storycraft` | 有（主编 / 子代理两用） | 有（三套技能：长篇 / 短篇 / 剧本） | **有**：`story_init` `story_plan` `story_write` `story_review` `story_revise` `story_state` `story_status` `story_next` `story_delegate` `story_submit`，以及真值四件 `story_bible` `story_bible_write` `story_bible_import` `story_summarize`、只读 `story_read` 与写前上下文 `story_brief`；常备能力 `story_export` `story_backup` | 有 |

动作按预设作用域注册：只有「故事工坊」会话能看到 `story_*`，其他模式与其他会话的工具面不变。形态（长篇 / 短篇 / 剧本）是作品数据（`catalog.db` 的 `works.form`），不是预设；同一会话里可以分别打开三种形态的作品。

## 角色与委派

写手、审稿、修订、规划**不是预设**，而是子代理；写手/审稿/修订默认由宿主动作 `story_delegate` 通过官方 `subagents` 服务启动，规划仍用手动 `subagent`：

- `story_delegate` 在宿主侧预检、装配上下文、启动子代理、校验并落库；主编只收紧凑回执，正文不进入主会话；
- 手动兜底仍用官方 `subagent`：省略 `agentPreset`，子代理加入故事工坊当前组合；角色由任务提示与对应技能（`storycraft-write-craft`、`storycraft-review`、`storycraft-revise-craft`、`storycraft-plan-craft`）决定；
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

## 作品库

工作区下只有一棵存储目录，作品内容不出工作区：

```text
<工作区>/.storycraft/
  catalog.db                 目录：works、proposals、session_current
  works/<workId>.db          单部作品的全部内容
  trash/<workId>.db          软删除的作品库
  exports/<workId>/          按需导出（作者在系统文件管理器里取用）
  backups/<workId>-<ts>.db   单作品备份
```

`catalog.db` 只存元数据，是 title/form/tags 的权威；作品库的 `meta` 行是导出副本。每部作品独立 `user_version`，升级一部不影响其他。表结构、连接策略、改名/删除/恢复顺序与启动对账的完整设计见 [作品入库 Note](../.agents/notes/implemented/pipeline/2026-10-19-storycraft-sqlite-store.md)。

动作与路由返回的模型可见 artifact 只有 `artifactId` / `revisionId` / `kind`，不含文件路径；正文/章纲/审稿/摘要等内容按 ID 用 `story_read` 或上下文动作读取。UI 与作者导出仍显示路径；实际内容在作品库内。宿主启动及首次读取一个工作区时对账目录与文件：缺失的作品在列表跳过并记入宿主诊断，孤儿文件与回收站文件保留待人工恢复。

## 真值与写前上下文

每部作品有一套真值，由动作建立与校验（模型不直写）：

```text
bible/world       世界观：时代、地理、规则边界、已定事实
bible/characters  人物档案：[{ name, role, want, fear, limit, voice }]
bible/style       文风基准：人称、时态、句长节奏、禁用词与口头禅
bible/plan        写作计划与章序规划
bible/intent      作者意图与当前焦点
summaries         章节摘要（上限 400 字）
```

- `story_bible`：读真值（可指定一份），缺失时指出缺哪几份。
- `story_bible_write`：校验后写入并返回内容版本；人物档案缺字段或重名会被拒绝，原内容不变。
- `story_bible_import`：把旧文件作品的世界观收编进真值，并列出仍需作者补的项（不替作者编人物档案）；不导入大纲，大纲只走 `story_outline` + 作者确认。
- `story_summarize`：写章节摘要（超 400 字截断并报告）。
- `story_brief`：装配写某一章前的上下文——意图、本章章纲、涉及人物、未解伏笔、上一章结尾、文风、字数口径；默认 8 KB，超预算按优先级裁剪并报告裁掉的段；同一输入两次结果逐字节一致。

## 作品操作与导出

| 动作 | 行为 |
| --- | --- |
| `story_rename` | 改标题或作品 id；改 id 时库文件一起移，冲突拒绝 |
| `story_delete` | 移入 `.storycraft/trash/`，不再出现在列表 |
| `story_restore` | 恢复回收站里最近一次的同名作品 |
| `story_export` | 导出为 `export:<workId>`；作者从只读 `/exports` 路由取目录，内容含 manifest、各版正文、章纲、摘要、各轮审稿、真值、卷、事件与提案 |
| `story_backup` | 用 SQLite 备份 API 生成单作品文件，返回 `integrity_check` |

导出是给作者在系统文件管理器里取用的，不是让模型读库；`.storycraft` 仍整体拒绝工具直接访问。

## 阶段机

每章有一个阶段，只能沿 `已规划 → 已写 → 已审 → 已修订/清稿 → 已定稿` 前进；摘要不是独立阶段，写摘要后才允许定稿。动作在入口校验，缺前置就拒绝并指出下一步：

- 没有章纲不能写正文（`plan-not-found`）；
- 没有审稿清单不能定稿（`review-required`）；
- 审稿条目没处理完不能定稿，错误里列出条目 id；
- 审稿只对「它记录的那个正文版本」有效：改过正文后要重新审稿才能再修订；清稿审稿必须针对当前版本；定稿允许「有问题的审稿针对上一版、条目已全处理」；
- 已定稿章改章纲要先带 `reopen: true` 重写正文回退（`chapter-settled`）；
- `reopen` 会在事件表里追加一条 `reopen`，该章旧的定稿不再计入状态折叠。

`story_next` 是只读查询：告诉模型下一步该调哪个动作、为什么、缺什么；可委派时返回 `delegate.role`（writer/reviewer/reviser），主编据此调用 `story_delegate`，`action` 保留给手动路径。

## 动作

| 动作 | 做什么 | 拒绝条件 |
| --- | --- | --- |
| `story_init` | 建作品库、真值与检索表；无当前作品时设为当前 | 标题为空；同 id 已存在；会话已有其他当前作品（`work-mismatch`，请新建会话） |
| `story_plan` | 写章纲 | 五项（视角/目标/阻力/代价/结尾变化）缺一；已定稿 |
| `story_write` | 写正文并更新字数与版本 | 正文为空；已有正文且未声明 `rewrite`；已定稿且未 `reopen` |
| `story_review` | 写问题清单（轮次按章独立编号；空清单表示清稿） | 正文不存在；已定稿；**不改正文** |
| `story_revise` | 生成新版本正文并把条目改为已处理 | 没有审稿清单；未指定条目；条目不存在；正文与当前版本相同；模式与改动幅度不符 |
| `story_state` | 追加人物事实与伏笔事件，返回新增/已用/已解/未解计数 | 作品或章不存在；伏笔状态非法；「已用」指向未埋的伏笔；未修订完成或未清稿 |
| `story_status` | 只读汇总进度、阶段、版本、未处理问题、未解伏笔 | 作品不存在 |
| `story_delegate` | 宿主侧跑一个角色：预检、装配上下文、启动子代理、消费 `story_submit`、落库，返回紧凑回执 | 预检/阶段错误按原码返回；服务缺失 `delegation-unavailable`；无合格提交 `delegation-no-submission` |
| `story_submit` | 仅子代理调用：提交结构化角色结果，宿主校验字数/mode，失败可重提 | 父代理/非委派 `submit-parent-denied`；超 3 次 `submit-attempts-exhausted` |
| `story_read` | 只读：按 `artifactId`/`revisionId` 读取当前章可读内容；越界返回 `artifact-not-readable` | 作品不存在；旧章/旧审稿版本 |
| `story_next` | 只读：下一步动作、章号、原因、缺什么；可委派时带 `delegate.role` | 作品不存在 |
| `story_export` / `story_backup` | 见「作品操作与导出」 | 作品不存在 |

字数口径只有一套：`domain.countWords`（CJK 字符 + 拉丁词，不含标点）；`story_critique` 的 `words` 用同一函数，标点数量单独放在 `chars`。

返回值统一为 `{ ok: true, artifact: { workId, artifactId, revisionId, kind }, … }` 或 `{ ok: false, error: { code, message } }`；模型输出不含文件路径。

## 工作台

侧栏入口「故事工坊」打开一个面板：

- 左侧：当前工作区的作品列表（标题、形态、已写/总章数、最新章号、最近更新时间、未处理问题数）；底部显示当前工作区路径与是否有可下发指令的会话。
- 右侧：作品详情——章节列表（状态、有无章纲、版本、字数、未处理问题）→ 章节点开后可切「正文 / 章纲」两视图、看审稿清单；「写第 N 章」「审稿」「按清单修订」「定稿」把固定指令投递给当前会话。
- 「真值」与「写前上下文」两个只读视图：真值列出五件的路径、版本与内容；写前上下文按章显示装配结果、字节占用、被裁项与草稿标记。

页面只读作品内容；写操作只有两个作者确认：章纲页「确认章纲」（`POST /chapter/approve`）与全书计划「确认全书计划」（`POST /outline/approve`），都不碰正文，也不会自动发送写正文指令；确认后由作者点动作按钮，把指令填入输入框，补充信息后发送。指令按钮在被点击时才校验——没有会话、或当前会话不是故事工坊时只显示原因不投递；故事工坊预设装载失败时，页面顶部直接显示宿主给出的失败原因。

## 读取作用域

讨论/新建阶段不读历史作品由运行时守卫执行，不靠提示词：

- 无当前作品时，`works/` 下的任何路径都被拒绝；有当前作品时只能访问当前作品；
- `glob`/`grep` 省略 `path` 会被拒绝（默认会递归整个工作区），请把 `path` 限定到项目目录或当前作品；
- `.storycraft/`（目录库、作品库、`-wal`、`-shm`）对工具一律不可直接读，只能通过动作或导出访问；
- 项目文件（`AGENTS.md`、`docs/`、`storycraft/` 源码等）不受影响。

## 只读接口

宿主半边除确认章纲外只注册只读路由（仅本机、需浏览器同源 cookie）：

| 路由 | 用途 |
| --- | --- |
| `POST /chapter/approve` | 作者确认本章章纲（写 `planApprovedAt`） |
| `POST /outline/approve` | 作者确认全书计划（写 `outline.approvedAt`） |
| `GET /api/dsh-storycraft/works?root=<工作区>` | 作品列表 |
| `GET /api/dsh-storycraft/work?root=&id=` | 一个作品的章节、状态、伏笔 |
| `GET /api/dsh-storycraft/chapter?root=&id=&chapter=&view=body\|plan&revision=` | 章正文或章纲 |
| `GET /api/dsh-storycraft/review?root=&id=&chapter=` | 最新章节的审稿条目与轮次 |
| `GET /api/dsh-storycraft/state?root=&id=` | 一个作品的进度摘要 |
| `GET /api/dsh-storycraft/bible?root=&id=&file=` | 真值文件与内容版本 |
| `GET /api/dsh-storycraft/brief?root=&id=&chapter=` | 写前上下文装配结果 |`r`n| `GET /api/dsh-storycraft/exports?root=&id=` | 作者导出目录状态（只读） |`r`n| `GET /api/dsh-storycraft/backups?root=&id=` | 作者备份文件列表（只读） |
| `GET /api/dsh-storycraft/roster` | 预设名册（含装载失败原因） |
| `GET /api/dsh-storycraft/document?id=` | 某预设的完整声明 |

`root` 必须是宿主工作区注册表认识的工作区目录，否则返回 `unknown-workspace`；参数不合法或作品不存在都返回同一个失败信封 `{ ok:false, error:{ code, message } }`。

## 目录

```text
storycraft/
  package.json                 # bundle 清单：dsh.bundle.patch + dsh.client
  cordis.patch.yml             # 入口行 + 一条预设声明（故事工坊，技能行 mode: all）
  index.js                     # Host 半边：只读路由 + 作者确认
  db.js                        # SQLite 目录库 / 作品库 schema、连接、检查点与备份
  store-db.js                  # 全部读写：作品、章节、真值、卷、检索、生命周期、导出备份
  storage.js                   # 稳定门面：动作与路由从这里取领域函数与存储函数
  domain.js                    # 共享词汇：错误码、id、阶段、审稿文本、事件折叠
  facts.js                     # 白名单唯一派生入口：只读已落库资料，正文与任务不参与
  context.js                   # 角色上下文拼装：七项分段、保护级别、预算裁剪、轨迹、白名单摘要
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

- 页面 spec：`node storycraft/e2e/run.mjs`。它起一个临时 DSH 实例（独立 `DSH_HOME`、临时端口、预置 fixture 工作区），跑九条页面 spec——侧栏入口、页面读数、两个作者确认、指令门禁、预设声明与两条刷新。不调用模型，零额度；需要本机装有 Playwright（可用 `DSH_E2E_PLAYWRIGHT_ROOT` 指向已安装它的目录）。
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
| 摘要/定稿 | 当前章正文、`state`、摘要 | 其他作品 |

内容只通过动作读取；模型只拿 artifact ID，不拿文件路径。
