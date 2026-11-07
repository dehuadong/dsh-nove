# DSH 机制映射

记录每项机制在 DSH 上的等价实现与偏差：**源工程做法 / 复刻做法 / 原因 / 验证**。本文件记录映射设计与偏差，不记录完成状态。

## 偏差登记前提

- 只有两类偏差合法：DSH 机制无法等价实现；源行为不可观测（读不到、跑不起、无证据）。
- 缺字段、缺产物、缺消费者、放宽校验不是偏差，是保真债；必须指出偿还路径或阻塞证据，不能因为写进本文件就视为合理。
- 未登记的差异视为越界；原因写“成本高”“没排期”“先这样”一律无效。

## 映射表

| 机制 | 源工程做法 | 复刻做法 | 原因 | 验证 |
| --- | --- | --- | --- | --- |
| Provider／模型调用 | 自带 provider 与模型路由 | DSH `llm` 服务 | 不重复实现模型接入；模型由预设／配置提供 | 一次角色委派能取得模型回执 |
| Agent 循环 | 自定义 runner 驱动角色 | DSH agent loop + `subagents` | 角色即子代理，循环与上下文由运行时负责 | 一个阶段能派发子代理并收敛结果 |
| CLI | 独立 CLI 进程 | DSH command / headless | 不维护第二套入口与参数解析 | `init`、`export` 各有可执行入口 |
| 会话／事件 | 自建会话与事件存储 | DSH session log | 对话与调用证据留在 session，作品内容另存 | 一次流水线可在 session 中追溯 |
| 会话绑定 | `sessionKind` 决定 profile，`bookId` 决定 workId | 按 sessionId 记录当前 workId；profile 由 preset 决定 | DSH 没有 InkOS 的 sessionKind/profile 枚举 | 面板进入、重启 hydrate、跨会话隔离 |
| 作品存储 | 自建独立存储服务 | DSH storage/session 或既有 SQLite（不新建独立存储服务） | 复用 DSH 文件状态与既有 SQLite，不引入额外存储组件 | 作品数据可读回；两部作品互不串数据 |
| 调度 | 队列 + worker | DSH jobs／schedule | 长任务用子代理异步执行，不建队列 | 长任务可断点续跑 |
| 技能 | 自有技能目录与加载器 | DSH `skills` 服务 + 文件系统 | SKILL.md + references 由运行时加载 | 技能能按角色／动作激活 |
| 方法注入 | 自建 prompt 拼装 | `systemPrompt.context()` | 不在实现里复制方法正文，只注入受预算约束的片段 | 注入片段可在 trace 中定位 |
| 章节重开 | 作者编辑动作直接替换/局部编辑已定稿章节，归档旧版、清 runtime，不删后续章 | reopen 解锁 + revise/rewrite | 机制等价：DSH 把“解锁”和“改写”拆成显式两步；不删后续章 | `reopen-target.test.mjs` + 真实回执 |
| 状态对账时机 | 结算后比较 old/new state+hooks，不一致进入 recovery | 草案前对拟写入 payload 做语义对账，回执带 consistent/reconciliationRequired | 机制等价：DSH 把待写入草案作为校验单元，不自动改稿 | `state-check.test.mjs` + 真实回执 |
| 工具 | 自有工具总线 | `tools.register` | `story_*` 工具按阶段注册独立 schema | 每阶段工具集不同且可校验 |
| 面板 | 独立前端服务 | `client` 插件 + slots | 从会话进入，与对话、轨迹并列；UI 用 React | 面板挂载到指定 slot |

## 偏差登记

每项偏差按四段记录：源工程做法 / 复刻做法 / 原因 / 验证。行为等价不登记，避免把映射表写第二遍；缺字段、缺产物或放宽校验登记为保真债，不登记为偏差。

当前没有已确认的合法偏差；但以下差异尚未完成源行为核对，按**保真债**处理，不得写成“已等价”：

| 差异 | 源工程做法（待核对） | 复刻现状 | 偿还路径 |
| --- | --- | --- | --- |
| 作品存储 | 作品内容作为文件落盘 | 作品内容进 SQLite | 改为文件落盘，或证明读取/导出行为与源工程等价 |
| 方法注入 | 宿主激活技能并注入方法 | 模型自行加载 skill；architect 只注入单份参考 | 用 `systemPrompt.context()` 对所有角色统一注入 |
| 阶段工具 | 每个 phase 独立 tool schema | 单一 `story_submit` + phase | 每 phase 独立 schema，或证明拒绝/校验行为等价 |
| 作者确认 | 面板确认与回执 | 部分验收走会话 `story_approve` | 用面板确认覆盖同一闸门并留回执 |

首次复刻行为与源工程不一致时在此追加合法偏差；保真债不得混入偏差表。
