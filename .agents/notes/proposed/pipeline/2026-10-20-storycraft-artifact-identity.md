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

## 参考目标的做法

参考目标把“标识”和“显示路径”分开：

- artifact 由 `workId` + `artifactId` + `revisionId` 标识；
- 读取由宿主动作完成，动作按 ID 读取校验后的 bytes；
- `inspect_work` 返回的 path 明确是 display reference，不是 identifier；
- 系统提示明确禁止从 artifact ID 拼路径；文件 path 只用于上传/未登记输入；
- 写入产生 revision，模型不接触原始磁盘路径。

所以它不是靠“再加一句提示词”，而是靠工具契约和宿主读取。

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
- `revisionId` 用于固定版本；
- `kind` 只用于展示（chapter / outline / plan / review / summary / state / bible）；
- path 仅保留在 UI、导出、内部存储与调试日志。

### 2. 读取

- 写前上下文：`story_brief(work, chapter)`；
- 正文/审稿/修订上下文：`story_context(work, chapter, role)`；
- 真值：`story_bible(work, file)`；
- 摘要/状态：现有只读动作；
- 不增加“按路径读”的模型入口；
- 若未来需要按 artifact 取全文，新增 `story_read(work, artifactId, revisionId?)`，由宿主校验后返回内容，绝不返回文件路径。

### 3. 阶段上下文表

| 阶段 | 模型需要知道 | 通过什么拿 | 不该看到 |
| --- | --- | --- | --- |
| 讨论/提案 | 作者想法、形态、目标读者、字数范围 | 作者对话 + `story_propose` | 任何作品库内容 |
| 立项 | 已确认方案、标题、形态、字数范围 | `story_propose` / `story_init` | 其他作品、旧正文 |
| 全书计划 | 作者意图、形态、字数、已有设定 | `story_brief` / `story_bible` | 正文、文件路径 |
| 章纲 | 全书计划、卷位置、相关人物、前情摘要、本章目标 | `story_next` + `story_brief` | 旧章全文、数据库路径 |
| 写正文 | 本章章纲、人物卡、未解伏笔、上一章结尾、文风、字数范围 | `story_brief` 分段 | 其他章正文、作品库路径 |
| 审稿 | 当前章正文、章纲、人物卡、审稿标准 | `story_context` + artifact 引用 | 其他作品、内部路径 |
| 修订 | 当前正文版本、未处理审稿条目、mode | `story_review` + artifact 引用 | 全库、文件路径 |
| 摘要/定稿 | 当前章正文、已有状态/伏笔 | `story_summarize` / `story_state` | 其他作品、路径 |
| 面板/导出 | 作者需要看的路径、版本、状态 | UI / `story_export` | 模型不参与 |

原则：

- 每个阶段只给该阶段必要段，不给全库；
- 模型只拿 ID，不拿 path；
- 内容只能通过动作读取；
- 作者看路径，模型看身份。

### 4. 工具输出改造

- `story_init`：`{ workId }`，不再 `artifact.path`；
- `story_plan` / `story_write` / `story_review` / `story_summarize` / `story_state`：返回 `artifactId`、`revisionId`、`kind`，不返回 path；
- `artifact` schema 删除 `path`；
- `story_context` / `story_brief` 的 section `source` 从 path 改为 sourceId（例如 `chapter:1`、`plan:1`、`characters`）；
- `story_export` 仍返回作者可见的导出路径；模型回执只给 exportId，不把路径用于读取。

### 5. 删除提示词补丁

- 删除 persona / `storycraft-studio-orchestration` / `story_init` 描述中的“不要 read/grep artifact.path”；
- 保留 scope guard 作为兜底；
- 工具 schema 不再提供 path，模型就没有可拼的路径。

## 备选方案

- **继续补“不要读”提示词**：概率性，无法阻止路径 affordance；放弃。
- **只把 `works/` 改成 `.storycraft/works/`**：仍是路径，仍会诱导读 DB；放弃。
- **完全禁止模型读取任何作品内容**：无法写/审/改；放弃。
- **复制参考的 artifact 系统**：超出本项，只做模型可见身份与读取契约。

## 验收条件

本 Note 证明设计自洽；产品验收见 #22。

1. 模型可见 artifact 无 path，只有 ID/revision/kind；
2. 阶段上下文表覆盖所有生产阶段；
3. 读取动作不依赖文件路径；
4. 删除提示词补丁后路径误读回归通过；
5. 工具 schema 与 README/技能同步。

## 风险

- 现有 UI/导出/测试依赖 `artifact.path`，需要分阶段迁移；
- 旧会话历史仍含路径，可能继续诱导；需要新会话验证；
- 不引入 artifact 编辑/分支系统，复杂编辑仍由现有动作承担。
