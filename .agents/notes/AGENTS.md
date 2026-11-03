# Agent Notes

本仓库只有一个 Notes 根：`.agents/notes/`，从仓库管理根解析（单上下文，不设多根）。记录格式、生命周期、分类与归档规则由 `write-agent-notes` Skill 拥有；写入前加载该 Skill，按其指引检索同主题记录、落笔与迁移生命周期。

- 生命周期目录：`proposed/`、`implemented/`、`rejected/`；`archived/` 存放冻结的归档记录（首次归档时创建）。
- 分类目录固定 6 个：`feature/`、`bug-fix/`、`simplification/`、`architecture/`、`process/`、`testing/`。
- 记录路径：`{lifecycle}/{class}/YYYY-MM-DD-topic.md`；文件名日期是首次提出日，迁移生命周期不重命名。
- 校验：从仓库管理根运行 `npm run verify-notes`（目录、头块与正文骨架、归档封印）。

产品合同、工作状态与批准证据归工作项；本目录只记长期技术设计、真实备选、决定与后果。适用的文档归属与工作项约定按[项目文档入口](../../docs/AGENTS.md)读取。

## 状态与证据

- **当前状态的唯一证据**是当前代码的自动测试/CI 与真实链路会话证据（日期、commit、session id、回执/trace）。Note 的 lifecycle 只表示记录是否落地；`implemented` 不等于能力当前可用。
- `## Testing` 只记录当时执行的命令、日期与结果，不是当前状态；需要当前结论时重新运行命令。
- **禁止第二套状态表**：不再新建或维护 `delivery-status-*`、`parity-matrix` 式手写“已实现/待重验/已完成”表；对拍记录只写参考证据、落点与偏差，不写完成状态。
- 工作项验收必须包含消费者与真实链路证据；文件存在、Note 落地或单测通过都不等于完成。
- 旧状态文档已冻结在 `rejected/` / `archived/`，只能作历史证据引用；当前状态查询走 CI 与真实会话。规则见 [状态与证据的唯一来源](implemented/process/2026-11-03-storycraft-status-evidence-ownership.md)。

