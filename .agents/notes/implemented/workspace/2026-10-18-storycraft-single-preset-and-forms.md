---
title: 故事工坊：单预设、形态数据化与会话当前工作项
status: implemented
created: 2026-10-18
updated: 2026-10-20
verification: 交付于 #9：单预设、形态数据化、面板两级；当前作品持久化由 #18 落地并记录于 implemented/pipeline/2026-10-19-storycraft-sqlite-store.md；presets/skills/e2e 覆盖。
---

# Agent Note：故事工坊：单预设、形态数据化与会话当前工作项

## 问题

三个预设（长篇小说 / 短篇小说 / 短剧）把**形态**当成会话能力，导致：配置重复三份、工作区不能混形态、门禁写死预设 id。工作台也只有“作品列表 + 单页详情”，没有类型层级，没有“进入作品会话就记住”的机制，于是每条指令都要重复作品 id。

产品行为与验收由提案工作项拥有，不在这里。

## 决定

### 形态是作品数据

`manifest.json` 增加 `form: 'longform' | 'short' | 'script'`；`story_init` 接受 `form`，缺省 `longform`；老作品读不到时按 `longform` 处理，不在读取时改写文件。

形态只影响三处：

1. **技能**：`skills/<form>/<form>-*` 仍是独立文件，`whenToUse` 写明适用形态。工作室预设用 `mode: all` 一次挂载三套目录——**形态决定读哪一份技能，而不是哪一份可见**；模型按作品的 `form` 与 `whenToUse` 选择。
2. **步骤脚本**：`story_next` 返回的 `action` 序列按形态给出（长篇：章纲→正文→审稿→修订→定稿→摘要；剧本：分集大纲→场次稿→审→修→定稿）。
3. **页面标签**：章 / 集 / 场；其余交互一致。

### 单预设

`cordis.patch.yml` 只保留一个预设行（`preset-storycraft`，名称「故事工坊」），persona 描述工作室；**不保留旧 id 的别名**——三个形态预设直接删除，旧会话需要重建（预设是会话级绑定，别名会在选择器里重新出现三种形态，与“一个预设”相悖）。

工作台门禁：会话预设 id 以 `storycraft` 开头即可下发指令。这既能接受合并后的 `storycraft`，也让合并前建立的会话（`storycraft-longform` 等）继续可用，不必改会话数据；不引入 `/health` 之类的额外探测。

### 会话当前工作项

宿主维护 `Map<sessionId, workId>`：

- 页面进入作品时 `POST /current {sessionId, workId}`；
- 动作的 `work` 参数可选：缺省时按 `exec.sessionId` 解析；
- 解析不到时报 `work-not-selected`，消息给出「先在面板进入一个作品，或在调用里带上 work」；
- `story_current` 动作只读；页面进入作品时由 `POST /current` 设置；
- 指针持久化到 `catalog.db` 的 `session_current`，页面重进或主机重启后从持久化行 hydrate；


### 面板两级

- 首页：左栏类型（长篇 / 短篇 / 剧本 + 数量），右栏该类型的作品卡片，点「进入」设当前工作项；
- 项目子页：左栏章节列表，点一行展开该章按钮（审稿 / 修订 / 质检 / 定稿 / 撤回定稿 / 摘要 / 卷摘要）；右栏标签页（正文 / 章纲 / 审稿清单 / 摘要 / 状态）；顶部面包屑与两个流程入口。

## 备选方案

- **按形态保留三个预设**：重复配置、不能混形态；否决。
- **当前工作项持久化到 profile**：与 `catalog.db` 的 `session_current` 重复；否决。
- **当前工作项写进作品 manifest**：那是作品数据，不该记“哪个会话在看它”；否决。

## 验证

- 新建作品带 `form`；老作品读取按 longform；
- 合并前建立的会话（旧 id）与新建的 `storycraft` 会话都能下发指令；
- 进入作品后省略 `work` 的 `story_next` / `story_brief` / `story_status` 落到当前作品；未进入时报错可行动；
- 首页按类型筛选，进入作品设置当前工作项；
- 项目子页左侧章节可展开按钮、右侧五个标签；
- 既有八套断言与三条页面 spec 不回归。

## 后果

- 预设别名与门禁切换期可能双写配置；一个版本内收敛；
- 当前工作项持久化在 `session_current`；
- 面板重排与形态包分开做，避免同时改布局与数据。


