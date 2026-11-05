# 产品范围

产品目标：在 DSH 上高保真复刻源工程 `inkos-master/` 的长篇写作行为。作者从会话进入一部作品，按源工程的阶段推进到第 1 章定稿，并能导出与备份。

## 术语

- **源工程**：`inkos-master/`，是行为规格；不存在与之对等的另一个“参考实现”。
- **复刻**：本仓库，只回答“复刻到什么程度”。
- **偏差**：只允许两种合法来源——DSH 机制无法等价实现、源行为不可观测；必须按“源工程做法 → 复刻做法 → 原因 → 验证”登记。
- **保真债**：缺字段、缺产物、缺消费者、放宽校验等；登记不等于合理，必须指出偿还路径或阻塞证据。

保真判断规则由 [`AGENTS.md` 的「保真原则」](../AGENTS.md) 拥有，本文件不重复。

## v1 范围

只做一条纵向链路，端到端复刻：

源工程的「提案 → 立项与初始化 → 基础设定 → 角色权威 → 第 1 章 write / review / revise / summary / settle / finalize → 导出与备份」链路中，v1 覆盖到第 1 章定稿与导出。

链路中每一步都是 `capabilities.yaml` 的一行；交付是否成立以该行的证据为准，不以完成度描述为准。

### 运行形态

- 从 DSH 会话进入，面板与对话、轨迹并列，界面用 React 渲染，接入 `client` 插件与 slots。
- 角色由子代理承担；模型选择由预设／配置提供，代码不绑定 Provider。
- 作品数据由 DSH storage/session 或既有 SQLite 承载；不新建独立存储服务，不维护第二套存储。
- 会话与调用证据留在 DSH session。
- 长任务用 jobs／schedule 调度，不建队列；`story_*` 工具按阶段注册独立 tool schema。

## 阶段节点

### 源工程阶段（行为顺序）

提案 → 立项与初始化 → 基础设定（outline / details / cast_index / cards）→ 全书计划 → 章纲 → 正文 → 审稿 → 修订/清稿 → 摘要 → 结算/定稿 → 导出/备份。

每个节点的产物、顺序、错误与拒绝行为以源工程为准；v1 覆盖到第 1 章定稿与导出。

### 复刻交付节点

按能力纵向交付，顺序如下；每一步以对应能力行的证据为准，不以文字进度为准。

- **P0**：`runtime.load` —— 最小 bundle/preset/tool/skill/client 骨架，CI 通过，真实加载一次。
- **P1**：`foundation.architect` + `cast.single-authority` + `foundation.approval` —— 第一条真实链路（立项 → 基础设定 → 角色进入 brief）。
- **P2**：`plan.outline` + `plan.chapter` + `context.brief`。
- **P3**：`chapter.write` + `chapter.review` + `chapter.revise`。
- **P4**：`chapter.summary` + `chapter.settle` + `chapter.finalize`。
- **P5**：`export.work` + `backup.restore` + `materials.import` + `search.unified` + `panel.*`。
- **P6**：短篇流水线（独立）。
- **P7**：剧本流水线（独立）。

交付节点只决定切片顺序，不重新定义源工程阶段；不得用 P 节点替代源阶段的行为。

每个阶段结束时只允许 `check-capabilities --write` 更新状态；不写进度文档。

## 非目标（v1）

- **短篇与剧本流水线**：v1 之后独立推进；账本中已登记，不占 v1 交付。
- **兼容层**：不提供双格式读写，不保留旧版接口别名。
- **旧作品迁移**：不导入既有作品库，不做历史数据清洗。
- **横向重构**：不做跨模块统一抽象，按能力纵向交付。
- **第二套状态表**：能力状态只由 `capabilities.yaml` 承载，不另建进度表、交付盘点或验收清单。

## 边界

交付范围与验收归工作项；能力状态只由 `check-capabilities` 依据证据生成。保真规则见 [`AGENTS.md` 的「保真原则」](../AGENTS.md)，文档属主见 [`docs/AGENTS.md`](AGENTS.md)。
