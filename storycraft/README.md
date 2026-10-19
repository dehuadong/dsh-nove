# 故事工坊（dsh-storycraft）

DSH 里的长篇创作编排：二十五个动作把立项、章纲、正文、审稿、修订、定稿归档落到作品目录，一个**工作台**以只读方式看作品与章节，并按键把固定指令投给当前会话。故事工坊是**一个工作模式**（一个 Agent 预设），以标准预设为基线再挂自己的动作、技能与人设。

## 现状

| 工作模式 | 人设 | 技能 | 动作 | 工作台 |
| --- | --- | --- | --- | --- |
| 故事工坊 `storycraft` | 有（主编 / 子代理两用） | 有（三套技能：长篇 / 短篇 / 剧本） | **有**：`story_init` `story_plan` `story_write` `story_review` `story_revise` `story_state` `story_status` `story_next`，以及真值四件 `story_bible` `story_bible_write` `story_bible_import` `story_summarize` 与写前上下文 `story_brief` | 有 |

动作按预设作用域注册：只有「故事工坊」会话能看到 `story_*`，其他模式与其他会话的工具面不变。形态（长篇 / 短篇 / 剧本）是作品数据（`manifest.form`），不是预设；同一会话里可以分别打开三种形态的作品。

## 角色与委派

写手、审稿、修订、规划**不是预设**，而是主编通过官方 `subagent` 工具派发的子代理：

- 派发省略 `agentPreset`，子代理加入故事工坊当前组合，继承同一套工具、技能与人设；角色由任务提示与对应技能（`storycraft-write-craft`、`storycraft-review`、`storycraft-revise-craft`、`storycraft-plan-craft`）决定；
- 子代理只返回文本。预设作用域的守卫拒绝它调用 `write`、`edit`、`pwsh`、`bash`，写动作（`story_write`、`story_review`、`story_revise` 等）在入口返回 `subagent-cannot-land`；落盘一律由主编完成；
- 委派深度固定为 1，子代理不能再派发。

## 立项与提纲

1. 作者用自然语言给出想法 → 模型只讨论，不写文件；
2. 方向成熟后 story_propose 落提案（works/.proposals/，不是作品），作者确认后 story_init（必须带 proposal）；
3. 立项只建骨架；接着 story_outline 写主线/卷划分/结局方向到 ible/plan.md；
4. 作者确认后用 story_outline(approve: true) 记录；未确认前 story_plan 被拒（outline-required）；
6. 单章章纲的确认按作品设置 `planApproval` 执行：默认 `required`（新章首次写正文前需作者在面板确认，否则 `plan-not-approved`），可设为 `off` 关闭逐章确认；
5. 确认后才写第 1 章章纲。

## 形态

| 形态 | `story_init` 的 form | 单位 | 技能 |
| --- | --- | --- | --- |
| 长篇 | `longform`（默认） | 章 | 单章写法：章纲 → 正文 → 审稿 → 修订 → 定稿 → 摘要 |
| 短篇 | `short` | 篇 | 短篇写法：一篇写到底，流程同上 |
| 剧本 | `script` | 集 | 竖屏短剧写法：按场次与台词组织，流程同上 |

形态是作品数据（`manifest.form`），决定用哪套技能与页面单位；动作与门禁完全一致。老作品没有 `form` 时按长篇读取。

## 作品目录契约

一个作品是工作区下的一个目录 `<工作区>/works/<workId>/`：

```text
works/<workId>/
  manifest.json          进度清单：version、workId、标题、形态、章列表（状态/当前版本/字数）、计数
  outline/ch-0001.plan.md 章纲：视角、目标、阻力、代价、结尾变化
  chapters/ch-0001.md     正文首版
  chapters/ch-0001.r2.md  修订版本（旧版不改写）
  reviews/ch-0001.r1.md   审稿清单：`- [ ] Q1 :: 位置 :: 问题 :: 建议`
  state/events.jsonl      状态事件（人物事实、伏笔变化，带章号）
  hooks.md                伏笔视图（由事件折叠生成）
```

写入都是先写临时文件再原子替换，进度清单最后写；提交失败时已写的产物会回滚：动作失败不会留下半个章节，也不会让进度与文件不一致。同一个作品同一时刻只允许一个写者（产出目录下的单写者锁 + `updatedAt` 乐观校验），并发写会被拒绝而不是互相覆盖。返回的路径一律相对工作区、用 `/` 分隔。

## 真值与写前上下文

每部作品有一套真值，由动作建立与校验（模型不直写）：

```text
bible/world.md          世界观：时代、地理、规则边界、已定事实
bible/characters.json   人物档案：[{ name, role, want, fear, limit, voice }]
bible/style.md          文风基准：人称、时态、句长节奏、禁用词与口头禅
bible/plan.md           写作计划与章序规划
bible/intent.md         作者意图与当前焦点
summaries/ch-0001.md    章节摘要（上限 400 字）
```

- `story_bible`：读真值（可指定一份），缺失时指出缺哪几份。
- `story_bible_write`：校验后写入并返回内容版本；人物档案缺字段或重名会被拒绝，文件保持不变。
- `story_bible_import`：把旧作品 `design/` 下的世界观与大纲收编进真值，并列出仍需作者补的项（不替作者编人物档案）。
- `story_summarize`：写章节摘要（超 400 字截断并报告）。
- `story_brief`：装配写某一章前的上下文——意图、本章章纲、涉及人物、未解伏笔、上一章结尾、文风、字数口径；默认 8 KB，超预算按优先级裁剪并报告裁掉的段；同一输入两次结果逐字节一致。

## 两阶段提交与投影

- 写动作先把产物写进 `works/<作品>/.staging/<动作>-<时间戳>/`，整体校验后一次提交，**进度清单最后写**（提交点）；
- 提交点（写清单）之前失败或中断：正式目录不变；提交之间的中断以清单为准；超过 24 小时的暂存由下次写动作清理并报告数量；
- `state/projection.json` 是派生视图（章阶段、字数合计、未处理审稿、伏笔计数、事件数），每次写清单时重算；删掉或过期时读取自动重建。

## 作品操作

| 动作 | 行为 |
| --- | --- |
| `story_rename` | 改标题或作品 id；改 id 时目录一起改，冲突拒绝 |
| `story_delete` | 移入 `works/.trash/<作品>-<时间戳>/`，不再出现在列表 |
| `story_restore` | 恢复回收站里最近一次的同名作品 |

## 阶段机

每章有一个阶段，只能沿 `已规划 → 已写 → 已审 → 已修订 → 已定稿` 前进；动作在入口校验，缺前置就拒绝并指出下一步：

- 没有章纲不能写正文（`plan-not-found`）；
- 没有审稿清单不能定稿（`review-required`）；
- 审稿条目没处理完不能定稿，错误里列出条目 id；
- 审稿只对「它记录的那个正文版本」有效：改过正文后要重新审稿才能再修订；定稿允许「审稿针对上一版、条目已全处理」；
- 已定稿章改章纲要先带 `reopen: true` 重写正文回退（`chapter-settled`）；
- `reopen` 会在事件日志里追加一条 `reopen`，该章旧的定稿不再计入状态折叠。

`story_next` 是只读查询：告诉模型下一步该调哪个动作、为什么、缺什么。

## 动作

| 动作 | 做什么 | 拒绝条件 |
| --- | --- | --- |
| `story_init` | 建作品骨架与进度清单 | 标题为空；同 id 已存在（拒绝，不覆盖；可换标题或显式给 `workId`） |
| `story_plan` | 写章纲 | 五项（视角/目标/阻力/代价/结尾变化）缺一 |
| `story_write` | 写正文并更新字数与版本 | 正文为空；已有正文且未声明 `rewrite` |
| `story_review` | 写问题清单（轮次按章独立编号） | 正文不存在；问题清单为空；**不改正文** |
| `story_revise` | 生成新版本正文并把条目改为已处理 | 没有审稿清单；未指定条目；条目不存在；正文与当前版本相同 |
| `story_state` | 追加人物事实与伏笔事件，刷新 `hooks.md`，返回新增/已用/已解/未解计数 | 作品或章不存在；伏笔状态非法；「已用」指向未埋的伏笔 |
| `story_status` | 只读汇总进度、阶段、版本、未处理问题、未解伏笔 | 作品不存在 |
| `story_next` | 只读：下一步动作、章号、原因、缺什么 | 作品不存在 |

返回值统一为 `{ ok: true, artifact: { path, revision? }, … }` 或 `{ ok: false, error: { code, message } }`。

## 工作台

侧栏入口「故事工坊」打开一个面板：

- 左侧：当前工作区的作品列表（标题、形态、已写/总章数、最新章号、最近更新时间、未处理问题数）；底部显示当前工作区路径与是否有可下发指令的会话。
- 右侧：作品详情——章节列表（状态、有无章纲、版本、字数、未处理问题）→ 章节点开后可切「正文 / 章纲」两视图、看审稿清单；「写第 N 章」「审稿」「按清单修订」「定稿」把固定指令投递给当前会话。
- 「真值」与「写前上下文」两个只读视图：真值列出五件的路径、版本与内容；写前上下文按章显示装配结果、字节占用、被裁项与草稿标记。
页面只读作品内容；唯一写操作是作者在章纲页点「确认章纲」（`POST /chapter/approve`），它记录 `planApprovedAt`，不碰正文。指令按钮在被点击时才校验——没有会话、或当前会话不是故事工坊时只显示原因不投递；故事工坊预设装载失败时，页面顶部直接显示宿主给出的失败原因。

## 只读接口

宿主半边除确认章纲外只注册只读路由（仅本机、需浏览器同源 cookie）：

| 路由 | 用途 |
| --- | --- |
| `POST /chapter/approve` | 作者确认本章章纲（写 `planApprovedAt`） |
| `GET /api/dsh-storycraft/works?root=<工作区>` | 作品列表 |
| `GET /api/dsh-storycraft/work?root=&id=` | 一个作品的章节、状态、伏笔 |
| `GET /api/dsh-storycraft/chapter?root=&id=&chapter=&view=body\|plan&revision=` | 章正文或章纲 |
| `GET /api/dsh-storycraft/review?root=&id=&chapter=` | 最新章节的审稿条目与轮次 |
| `GET /api/dsh-storycraft/state?root=&id=` | 一个作品的进度摘要 |
| `GET /api/dsh-storycraft/bible?root=&id=&file=` | 真值文件与内容版本 |
| `GET /api/dsh-storycraft/brief?root=&id=&chapter=` | 写前上下文装配结果 |
| `GET /api/dsh-storycraft/roster` | 预设名册（含装载失败原因） |
| `GET /api/dsh-storycraft/document?id=` | 某预设的完整声明 |

`root` 必须是宿主工作区注册表认识的工作区目录，否则返回 `unknown-workspace`；参数不合法或作品不存在都返回同一个失败信封 `{ ok:false, error:{ code, message } }`。

## 目录

```text
storycraft/
  package.json                 # bundle 清单：dsh.bundle.patch + dsh.client
  cordis.patch.yml             # 入口行 + 一条预设声明（故事工坊，技能行 mode: all）
  index.js                     # Host 半边：只读路由 + 确认章纲
  storage.js                   # 作品存储：原子写、版本、审稿、状态、进度
  facts.js                     # 白名单唯一派生入口：只读已落盘资料，正文与任务不参与
  context.js                   # 角色上下文拼装：七项分段、保护级别、预算裁剪、轨迹、白名单摘要
  consistency.js               # 输出一致性：自造人名拒收，地名与尺寸告警
  tools.js                     # 动作（注册在预设作用域）
  skills.js                    # 按模式提供技能目录
  client.js                    # 浏览器半边：侧栏入口 + 工作台
  skills/<mode>/<skill>/…      # 技能正文与脚本
  icon.svg
```

## 验证入口

- `node storycraft/tests/presets.test.mjs`：工作模式只有一个预设、组合与 DSH 标准预设逐行一致、委派与守卫配置。
- `node storycraft/tests/storage.test.mjs`：作品存储的原子性、版本、审稿、状态与失败路径。
- `node storycraft/tests/tools.test.mjs`：动作注册、schema 形状、端到端行为与拒绝条件。
- `node storycraft/tests/context.test.mjs`：角色上下文的分段、保护级别、预算裁剪、轨迹与白名单摘要。
- `node storycraft/tests/facts.test.mjs`：白名单来源、中文数字归一与摘要边界。
- `node storycraft/tests/consistency.test.mjs`：人名拒收、地名与尺寸告警、误报回归。
- `node storycraft/tests/bible.test.mjs`：真值校验、摘要截断、写前上下文顺序/预算/确定性、旧作品导入。
- `node storycraft/tests/stage.test.mjs`：阶段推进、五种拒绝、reopen 回退与旧定稿作废、`story_next` 判定。
- `node storycraft/tests/work-ops.test.mjs`：改名（标题/id）、删除到回收站、恢复、投影重建与列表过滤。
- `node storycraft/e2e/run.mjs`：起一个临时 DSH 实例（独立 `DSH_HOME`、临时端口、预置 fixture 工作区），跑三条页面 spec——侧栏入口、页面读数、非长篇会话的指令门禁。不调用模型，零额度；需要本机装有 Playwright（可用 `DSH_E2E_PLAYWRIGHT_ROOT` 指向已安装它的目录）。
- 端到端验收、评审与证据记录在 issue `dehuadong/dsh-nove#3`。

## 改动与生效

包以 `link:` 装入 profile，改 `client.js` 后刷新窗口即可；改 `cordis.patch.yml` 或 Host 半边（`index.js`、`tools.js`、`storage.js`）需要重启应用，或让 `plugin_manager` 把 bundle 关→开重载补丁。停用用 `set_bundle enabled:false`，卸载用 `remove_bundle`。
