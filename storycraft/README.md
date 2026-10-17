# 故事工坊（dsh-storycraft）

DSH 里的长篇创作编排：七个**动作**把立项、章纲、正文、审稿、修订、状态结算落到作品目录，一个**工作台**以只读方式看作品与章节，并按键把固定指令投给当前会话。预设只决定“哪个模式挂哪些动作、技能与人设”。

## 现状

| 模式 | 人设 | 技能 | 动作 | 工作台 |
| --- | --- | --- | --- | --- |
| 长篇小说 `storycraft-longform` | 有 | 有（含三个脚本） | **有**：`story_init` `story_plan` `story_write` `story_review` `story_revise` `story_state` `story_status` | 有 |
| 短篇小说 `storycraft-shortform` | 有 | 有 | 无（后续工作项） | 同一工作台只读展示作品；该模式暂无动作 |
| 短剧剧本 `storycraft-screenplay` | 有 | 有 | 无（后续工作项） | 同上 |

动作按预设作用域注册：只有长篇模式的会话能看到 `story_*`，其他模式与其他会话的工具面不变。

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

## 七个动作

| 动作 | 做什么 | 拒绝条件 |
| --- | --- | --- |
| `story_init` | 建作品骨架与进度清单 | 标题为空；同 id 已存在（拒绝，不覆盖；可换标题或显式给 `workId`） |
| `story_plan` | 写章纲 | 五项（视角/目标/阻力/代价/结尾变化）缺一 |
| `story_write` | 写正文并更新字数与版本 | 正文为空；已有正文且未声明 `rewrite` |
| `story_review` | 写问题清单（轮次按章独立编号） | 正文不存在；问题清单为空；**不改正文** |
| `story_revise` | 生成新版本正文并把条目改为已处理 | 没有审稿清单；未指定条目；条目不存在；正文与当前版本相同 |
| `story_state` | 追加人物事实与伏笔事件，刷新 `hooks.md`，返回新增/已用/已解/未解计数 | 作品或章不存在；伏笔状态非法；「已用」指向未埋的伏笔 |
| `story_status` | 只读汇总进度、版本、未处理问题、未解伏笔 | 作品不存在 |

返回值统一为 `{ ok: true, artifact: { path, revision? }, … }` 或 `{ ok: false, error: { code, message } }`。

## 工作台

侧栏入口「故事工坊」打开一个面板：

- 左侧：当前工作区的作品列表（标题、形态、已写/总章数、最新章号、最近更新时间、未处理问题数）；底部显示当前工作区路径与是否有可下发指令的会话。
- 右侧：作品详情——章节列表（状态、有无章纲、版本、字数、未处理问题）→ 章节点开后可切「正文 / 章纲」两视图、看审稿清单；「写第 N 章」「审稿」「按清单修订」「结算状态」把固定指令投递给当前会话。
页面只读，不写文件：写盘一律由模型调动作完成。指令按钮在被点击时才校验——没有会话、或当前会话不是长篇模式时只显示原因不投递；长篇预设装载失败时，页面顶部直接显示宿主给出的失败原因。

## 只读接口

宿主半边只注册只读路由（仅本机、需浏览器同源 cookie）：

| 路由 | 用途 |
| --- | --- |
| `GET /api/dsh-storycraft/works?root=<工作区>` | 作品列表 |
| `GET /api/dsh-storycraft/work?root=&id=` | 一个作品的章节、状态、伏笔 |
| `GET /api/dsh-storycraft/chapter?root=&id=&chapter=&view=body\|plan&revision=` | 章正文或章纲 |
| `GET /api/dsh-storycraft/review?root=&id=&chapter=` | 最新章节的审稿条目与轮次 |
| `GET /api/dsh-storycraft/state?root=&id=` | 一个作品的进度摘要 |
| `GET /api/dsh-storycraft/roster` | 预设名册（含装载失败原因） |
| `GET /api/dsh-storycraft/document?id=` | 某预设的完整声明 |

`root` 必须是宿主工作区注册表认识的工作区目录，否则返回 `unknown-workspace`；参数不合法或作品不存在都返回同一个失败信封 `{ ok:false, error:{ code, message } }`。

## 目录

```text
storycraft/
  package.json                 # bundle 清单：dsh.bundle.patch + dsh.client
  cordis.patch.yml             # 入口行 + 三条预设声明（长篇多挂一层动作行）
  index.js                     # Host 半边：只读路由
  storage.js                   # 作品存储：原子写、版本、审稿、状态、进度
  tools.js                     # 七个动作（注册在预设作用域）
  skills.js                    # 按模式提供技能目录
  client.js                    # 浏览器半边：侧栏入口 + 工作台
  skills/<mode>/<skill>/…      # 技能正文与脚本
  icon.svg
```

## 验证入口

- `node storycraft/tests/storage.test.mjs`：作品存储的原子性、版本、审稿、状态与失败路径。
- `node storycraft/tests/tools.test.mjs`：七个动作的注册、端到端行为与拒绝条件。
- 端到端验收、评审与证据记录在 issue `dehuadong/dsh-nove#1`。

## 改动与生效

包以 `link:` 装入 profile，改 `client.js` 后刷新窗口即可；改 `cordis.patch.yml` 或 Host 半边（`index.js`、`tools.js`、`storage.js`）需要重启应用，或让 `plugin_manager` 把 bundle 关→开重载补丁。停用用 `set_bundle enabled:false`，卸载用 `remove_bundle`。
