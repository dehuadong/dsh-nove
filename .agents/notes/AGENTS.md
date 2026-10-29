# Agent Notes

本仓库只有一个 Notes 根：`.agents/notes/`，从仓库管理根解析（单上下文，不设多根）。记录格式、生命周期、分类与归档规则由 `write-agent-notes` Skill 拥有；写入前加载该 Skill，按其指引检索同主题记录、落笔与迁移生命周期。

- 生命周期目录：`proposed/`、`implemented/`、`rejected/`；`archived/` 存放冻结的归档记录（首次归档时创建）。
- 分类目录固定 6 个：`feature/`、`bug-fix/`、`simplification/`、`architecture/`、`process/`、`testing/`。
- 记录路径：`{lifecycle}/{class}/YYYY-MM-DD-topic.md`；文件名日期是首次提出日，迁移生命周期不重命名。
- 校验：从仓库管理根运行 `npm run verify-notes`（目录、头块与正文骨架、归档封印）。

产品合同、工作状态与批准证据归工作项；本目录只记长期技术设计、真实备选、决定与后果。适用的文档归属与工作项约定按[项目文档入口](../../docs/AGENTS.md)读取。
