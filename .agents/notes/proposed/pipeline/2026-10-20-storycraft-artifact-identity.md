---
title: 故事工坊：模型可见的 artifact 身份与阶段上下文契约
status: proposed
created: 2026-10-20
updated: 2026-10-20
---

# Agent Note：故事工坊：模型可见的 artifact 身份与阶段上下文契约

## 问题

`artifact.path` 是 `works/<workId>/...` 形状。模型看到路径就尝试用 `read` 拼文件，例如：

```text
E:\dsh-nove\works\tang-ding\bible\characters.json
```

实际内容在 `.storycraft/works/<workId>.db`，没有这个文件。随后模型尝试 `grep`、导出，浪费多轮。

用 `story_init` 描述、persona、scope guard 反复补“不要 read/grep”，只能降低概率，不能消除错误 affordance：工具返回值本身提供了可当文件用的字段。

## 参考基线

参考工程 `inkos-master` 2.0.0（只读）。用户于 2026-10-20 明确授权功能对拍；本记录只归纳行为，不复制源文件、命令或代码。

参考目标把“标识”和“显示路径”分开：

- artifact 由 `workId` + `artifactId` + `revisionId` 标识；
- 读取由宿主动作完成，动作按 ID 读取校验后的内容；
- `inspect_work` 返回的 path 明确是 display reference，不是 identifier；
- 系统提示明确禁止从 artifact ID 拼路径；文件 path 只用于上传/未登记输入；
- 写入产生 revision，模型不接触原始磁盘路径。

所以它不是靠“再加一句提示词”，而是靠工具契约和宿主读取。

## 与既有记录

- #21 的 warning/清稿/委派实现保留；本项取代 #21 的虚拟路径缓解及其路径验收。
- `proposed/pipeline/2026-10-20-storycraft-production-parity.md` 的节点表路径项由本项接管；完成后更新其 owner。
- `implemented/pipeline/2026-10-19-storycraft-sqlite-store.md` 的 `artifact.path` 契约、`implemented/pipeline/2026-10-19-storycraft-role-input-contracts.md` 的 `story_context.sections[].source` 契约、`implemented/pipeline/2026-10-17-storycraft-bible-and-brief.md` 的章节真值说明由本项部分替代；交付时更新并互相链接。
- `proposed/pipeline/2026-10-20-storycraft-host-delegation.md` 的 `story_delegate` 回执增加 artifact ID；回执原本没有 path，只增加 ID 字段，不改变 1,500 字符预算。

## 提案

### 1. 模型可见的 artifact

```json
{
  "workId": "tang-ding",
  "artifactId": "chapter:1",
  "revisionId": "r2",
  "kind": "chapter"
}
```

- 不出现 `path`；
- `revisionId` 固定一次内容版本；
- `kind` 只用于展示；
- path 仅保留在 UI、导出、内部存储、日志与作者导出，不进入任何模型可见 schema。

### 1.1 artifact ID 语法

| 对象 | artifactId | revisionId | kind |
| --- | --- | --- | --- |
| 全书计划 | `outline` | 内容哈希（前 12 位） | `outline` |
| 章纲 | `plan:<n>` | 内容哈希（前 12 位） | `plan` |
| 正文 | `chapter:<n>` | `r1`、`r2` …（真实版本） | `chapter` |
| 审稿 | `review:<n>:<bodyRev>:<round>` | 审稿内容哈希 | `review` |
| 摘要 | `summary:<n>` | 内容哈希（前 12 位） | `summary` |
| 状态 | `state` | 事件序号 `seq:<n>` | `state` |
| 真值 | `bible:<file>` | 内容哈希（前 12 位） | `bible` |
| 卷 | `volume:<id>` | 内容哈希（前 12 位） | `volume` |
| 导出 | `export:<workId>` | 当前导出（覆盖式，无历史） | `export` |
| 备份 | `backup:<workId>:<timestamp>` | 生成时间戳 | `backup` |

- plan / summary / bible / outline / volume 是原地 upsert，**不能用固定 `r1`**，用当前内容哈希；本项不保留这些对象的历史，旧 revisionId 在 `story_read` 返回 `revision-not-found`，不伪造历史；
- review 的 ID 包含被审正文版本和轮次；审稿条目勾选会改变内容哈希，旧哈希不可再读；
- chapter 的 revision 用现有真实版本号；
- state 用 event seq，不能写“seq 或 r1”。

### 1.2 动作返回映射

| 动作 | 模型可见 artifact | 说明 |
| --- | --- | --- |
| `story_init` | 无 | 只返回 `workId` |
| `story_outline` | `outline` | 无路径 |
| `story_plan` | `plan:<n>` | 无 `.plan.md` |
| `story_write` / `story_revise` | `chapter:<n>` + revision | 无 `chapters/*.md` |
| `story_review` | `review:<n>:<bodyRev>:<round>` | 无 reviews 路径 |
| `story_summarize` | `summary:<n>` | 无 summaries 路径 |
| `story_state` | `state` + seq | 无 events 路径 |
| `story_bible_write` | `bible:<file>` | 无 bible 路径 |
| `story_bible_import` | `bible:<file>` 列表 | 不返回 design/from/to 路径 |
| `story_volume` | `volume:<id>` | 无 volumes 路径 |
| `story_export` | `export:<workId>` | 导出目录覆盖式；新增只读 `/exports/<workId>` 路由给作者；模型不拿路径 |
| `story_backup` | `backup:<workId>:<timestamp>` | 新增只读备份路由给作者取文件；模型不拿路径 |
| `story_reopen` / `story_delete` | 目标 `artifactId` / `workId` | 不返回 trash/path |
| `story_delegate` | 角色对应的 artifact ID | 不含 path |

`story_bible` 的 `files[].path` 改为 `files[].file` + `files[].artifactId`；不再返回路径。

### 2. 读取

- 新增只读 `story_read(work, artifactId, revisionId?)`：
  - 宿主校验 artifact 属于该作品、revision 存在；
  - 返回内容、artifactId、revisionId、kind；
  - 只解析当前存在的 revision；upsert 对象的历史版本不保留，旧 revisionId 返回 `revision-not-found`；
  - export/backup 不是 prose artifact，`story_read` 不读取它们，只由作者 UI 路由取用；
  - 不返回文件路径；
  - 超长内容按行分页（startLine/lineCount），与参考目标的 read 行为对齐。
- 写前上下文仍用 `story_brief(work, chapter)`；正文/审稿/修订上下文用 `story_context(work, chapter, role)`；真值用 `story_bible`。
- `story_read` 让 ID 可读、可测，不再是只写标识。
- 读取权限不是“同作品即可”：
  - 写正文时只读当前章 `plan:<n>`、`bible:*`、`outline`，不读其他章正文；
  - 审稿/修订只读当前章 `chapter:<n>` 与 `review:<n>:...`；
  - 摘要/定稿只读当前章与 `state`/`summary:<n>`；
  - 前情通过 `story_brief` 摘要，不通过 `story_read` 读旧章全文；
  - 越界返回 `artifact-not-readable` / `chapter-not-current`，不返回内容。
- 不提供“按路径读作品”的模型入口。

### 3. 阶段上下文表

| 阶段 | 模型需要知道 | 通过什么拿 | 不该看到 |
| --- | --- | --- | --- |
| 讨论/提案 | 作者想法、形态、目标读者、字数范围 | 作者对话 + `story_propose` | 任何作品库内容 |
| 立项 | 已确认方案、标题、形态、字数范围 | `story_propose` / `story_init` | 其他作品、旧正文 |
| 全书计划 | 作者意图、形态、字数、已有设定 | `story_brief` / `story_bible` | 正文、文件路径 |
| 章纲 | 全书计划、卷位置、相关人物、前情摘要、本章目标 | `story_next` + `story_brief` | 旧章全文、数据库路径 |
| 写正文 | 本章章纲、人物卡、未解伏笔、上一章结尾、文风、字数范围 | `story_brief` 分段；delegate 时由宿主装配 | 其他章正文、作品库路径 |
| 审稿 | 当前章正文、章纲、人物卡、审稿标准 | `story_context` + `story_read` | 其他作品、内部路径 |
| 修订 | 当前正文版本、未处理审稿条目、mode | `story_read` + `story_review` | 全库、文件路径 |
| 清稿 | 当前正文、零问题审稿结果 | `story_review`（空清单）+ `story_read` | 其他作品、路径 |
| 摘要/定稿 | 当前章正文、已有状态/伏笔 | `story_read` + `story_summarize` / `story_state` | 其他作品、路径 |
| 面板/导出 | 作者需要看的路径、版本、状态 | UI / `story_export`（作者侧） | 模型不参与 |

原则：

- 每个阶段只给该阶段必要段，不给全库；
- 模型只拿 ID，不拿 path；
- 内容只能通过动作读取；
- 作者看路径，模型看身份。

### 4. 工具输出与 schema

- `OUTPUT_PROPERTIES.artifact` 删除 `path`，改为：
  - `workId`、`artifactId`、`revisionId`、`kind`；
- `story_bible.files` 删除 path；
- `story_brief` / `story_context` 的 `sections[].source` 与 `trace.sections[].source` 改为 `sourceIds: string[]`；
  - artifact：`outline`、`plan:<n>`、`chapter:<n>`、`review:<n>:...`、`summary:<n>`、`state`、`bible:<file>`、`volume:<id>`；
  - 非 artifact：`context:<section>`（装配段）、`skill:<name>`（技能文本）、`manifest`（作品元数据）；
  - 不出现任何文件路径或路径拼接；
- `story_export` / `story_backup` 的模型回执只含 `exportId` / `backupId`；作者目录由 UI 路由返回，不进入工具输出；
- `story_reopen` / `story_delete` / `story_restore` 不返回 trash/file path；
- `story_bible_import` 不返回 from/to/skipped 路径；`skipped` 使用 `bible:<file>` ID，`files[].file` 使用 `world|characters|style|plan|intent` 归一键，不返回 `bible/*.md`；
- `story_bible_import` 不导入 `plan`/`outline`（旧 design 大纲只作为 `outline` 的候选，必须走 `story_outline` + 作者确认），导入报告标 `outline-import-blocked`；
- `story_init` 不返回 artifact path；
- `story_outline` 是全书计划唯一写入入口，返回 `outline`；`story_bible_write(file="plan")` 不再独立写 plan，改为拒绝并指向 `story_outline`，避免绕过作者确认；`bible:plan` 只是 `outline` 的只读别名，不是第二个写入口；`story_bible_import` 也不写 plan/outline。
- `story_delegate` 回执增加 artifact ID/revision；原本没有 path，不改变 1,500 字符预算。

### 5. 删除提示词补丁

- 删除 persona / `storycraft-studio-orchestration` / `story_init` 描述中的“不要 read/grep artifact.path”；
- 保留 scope guard 作为兜底；
- 工具 schema 不再提供 path，模型就没有可拼的路径。

## 迁移与兼容

- 内部 `virtualPath` 继续服务 UI、导出、日志与旧测试；不再进入模型 schema。
- 现有 UI 路由与面板布局保持现状；仅新增作者只读的 `/exports/<workId>` 与备份读取路由，并把 `story_bible_write(file="plan")` 改为拒绝。
- 现有 SQLite 数据不需要迁移；ID/revision 按当前内容哈希、章版本、event seq 生成。
- 导出是覆盖式：`export:<workId>` 指向当前 `.storycraft/exports/<workId>`，不保留历史；`/exports/<workId>` 只读校验目录存在。
- 备份文件带时间戳，`backup:<workId>:<timestamp>` 可定位；新增只读备份列表/下载路由，模型只拿 ID。
- 旧会话历史里的路径不会自动消失，验证必须用新会话。
- 测试分两层：内部 `virtualPath` 仍可用于存储断言；模型输出断言无 `path`、无 `works/`。
- UI 仍显示路径/目录；导出、备份的绝对路径只通过 UI 路由或作者文件管理器给出。

## 备选方案

- **继续补“不要读”提示词**：概率性，无法阻止路径 affordance；放弃。
- **只把 `works/` 改成 `.storycraft/works/`**：仍是路径，仍会诱导读 DB；放弃。
- **完全禁止模型读取任何作品内容**：无法写/审/改；放弃。
- **只删六条动作的 path**：bible/brief/export/backup/delete 仍泄漏路径；放弃。
- **复制参考的 artifact 系统**：超出本项，只做模型可见身份、读取与阶段上下文。

## 验收条件

本 Note 证明设计自洽；产品验收见 #22。

1. 所有模型可见工具输出都不含 `path`，也不含 `works/` 字符串；
2. artifact ID 语法、revision 语义和动作映射完整，覆盖全部写/读/导出/备份动作；
3. `story_read` 可按 artifactId/revisionId 读取并校验作品作用域；
4. 阶段上下文表覆盖所有生产阶段，包括清稿；
5. 删除提示词补丁后，模型路径误读回归通过；
6. 现有 UI/HTTP 路由和内部 `virtualPath` 不回归。

## 风险

- 内容哈希 revision 会让每次 upsert 都产生新 ID；需要固定显示/日志策略，避免 UI 抖动；
- 旧会话历史仍含路径，可能继续诱导；需要新会话验证；
- `story_read` 是第 29 个动作，需同步动作数、README、测试；
- 不引入 artifact 编辑/分支系统，复杂编辑仍由现有动作承担。









