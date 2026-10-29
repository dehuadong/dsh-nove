# Agent Note: Agent Notes 迁移到 DSH 规范

Status: implemented

## 问题

仓库的 Agent Notes 原先用旧格式：YAML 头（`title` / `status` / `created` / `updated` / `verification` 或 `reason`）、`.agents/notes/config.json` 自定义分类（`pipeline` / `workspace` / `content-structure`）与自建检查器 `scripts/decisions/check.mjs`。DSH 规范（`write-agent-notes` Skill）要求固定 6 类、头块 `# Agent Note:` + `Status:`、`proposed/` `implemented/` `rejected/` 生命周期目录与 `npm run verify-notes` 校验入口。两套元数据与分类不兼容；保留双轨会让后来者不知道以哪套规则为准，机械校验也会分裂。

## 决定

73 篇既有记录（58 篇 implemented、12 篇 proposed、3 篇 rejected）迁移到 `{lifecycle}/{class}/`，文件名与日期不变；决定、备选与后果的正文不改写，只转换头块、状态行、相对链接与命令引用。分类按主决定判定：

- 数据模型、artifact 合同、迁移切片、角色与委派结构、存储与访问边界归 `architecture`；
- 用户或模型可见的能力、动作、导出、检索、面板与闸门行为归 `feature`；
- 技能正文与组织、打包发布、对拍清单、路线图归 `process`；
- 修实测缺陷或补对拍暴露的缺口归 `bug-fix`；
- 没有只删不增的记录，`simplification` 为空；没有测试基建记录，`testing` 为空。

配套改动：

- 旧 `README.md`、`config.json`、`templates/`、`scripts/decisions/` 经 `node scripts/trash.mjs` 移入 `.trash`，不保留兼容检查器或双格式规则。
- 根 `package.json` 增加 `verify-notes`：用 `node` 直跑 Skill 的三条校验脚本（`--root .agents/notes`）；根 `AGENTS.md` 增加“重要改动必须留笔记”；`.agents/notes/AGENTS.md` 改为单根说明。
- 笔记间链接与根 `AGENTS.md`、`docs/AGENTS.md`、`docs/agents/domain.md`、`storycraft/README.md`、两份对拍报告的引用改到新路径；2026-10-24 的历史核验报告保留旧目录名与旧命令，并加迁移说明。

## 备选方案

- **保留 `pipeline` / `workspace` 分类**：DSH 校验器把未知分类目录当结构错误，等于放弃机械校验与统一入口；否决。
- **按旧目录机械映射（`pipeline`→`feature`、`workspace`→`process`）**：会把 artifact 合同与迁移切片误归为 feature、把对拍清单与路线图误归为能力；否决。
- **归档旧 implemented 记录**：这些记录仍被现行代码与文档引用，归档会切断证据链，且 `archived/` 需要封印清单；否决。
- **保留旧检查器双跑**：两套元数据与分类冲突，新记录无法确定格式；否决。

## 后果

- 分类成为维护判断而非配置项，新增记录要按 6 类语义选择；旧分类目录不再存在。
- 迁移不改写决定、备选与后果，历史事实按原文保留；`updated` 时间字段由 git 承载。
- `archived/` 尚未使用，冻结归档规则留待首次归档时启用。
- 旧规则与检查器在 `.trash` 中可还原，也可从 git 历史取回；历史核验报告中的旧路径按历史证据保留。

## 验证

- `npm run verify-notes` 通过：全部记录的目录与相对链接、头块与节骨架校验通过，归档封印扫描 0 条。
- 迁移后除本篇对旧格式的说明外，`.agents/notes` 内不再有旧分类路径引用；仓库内仅 2026-10-24 的历史核验报告保留旧名并已标注。
- `git status` 显示 73 条 rename（保留历史），旧规则与检查器为删除，根 `package.json` 为新增。
