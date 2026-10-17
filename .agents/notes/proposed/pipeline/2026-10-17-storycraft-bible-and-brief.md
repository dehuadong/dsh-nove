---
title: 故事工坊：真值文件与写前上下文的技术设计
status: proposed
created: 2026-10-17
updated: 2026-10-17
---

# Agent Note：故事工坊：真值文件与写前上下文的技术设计

## 问题

长篇写到几十章后，模型对「设定是什么、上一章结尾在哪、哪条伏笔还没收」的把握完全依赖它自己翻文件：读多少不可控，读到哪些条目不可复现，作者改动设定后也没有任何一处生效点。当前作品目录只有进度清单、章纲、正文、审稿与状态事件；设定散落在会话里随手写的 `design/*.md`，契约外、无校验、不参与写前装配。

本设计固定两件事的落法：每部作品一套**可校验的真值文件**，以及写某一章前的**上下文装配**。产品行为与验收由工作项拥有，不在这里。

约束：真值由动作写入，模型不得绕过动作直写；装配必须是预算内、可复现的纯读取；现有动作、目录契约与工作台不得回归。

## 提案

### 真值文件与结构版本

`bible/` 五件，由 `story_init` 建立，由 `story_bible_write` 校验后写入：

| 文件 | 结构 | 写入校验 |
| --- | --- | --- |
| `bible/world.md` | Markdown | 文件存在且非空（标题算内容；空正文在装配里标为草稿） |
| `bible/characters.json` | `[{ name, role, want, fear, limit, voice }]` | 数组；每项六字段均为非空字符串；`name` 不重复 |
| `bible/style.md` | Markdown | 同上 |
| `bible/plan.md` | Markdown | 同上 |
| `bible/intent.md` | Markdown | 允许只有标题 |

内容版本 = 文件内容的 SHA-256 前 12 位十六进制。写入返回新版本；读取同时返回版本，工作台用它做显示与并发判断，不替代 `manifest.updatedAt` 的作品级校验。

写入沿用作品级单写者锁与原子写：与正文动作共用 `withWorkLock` 与 `writeAtomic`，失败不留下半份文件。

### 动作

| 动作 | 输入 | 输出 | 失败 |
| --- | --- | --- | --- |
| `story_bible` | 作品 id、文件名（`world`/`characters`/`style`/`plan`/`intent`，可省略以读全部） | `files[]`（name、path、version、content、draft 标记） | 文件缺失返回 `bible-missing` 并列出缺失项 |
| `story_bible_write` | 作品 id、文件名、内容 | `artifact { path }`、`version` | 结构不合法返回 `bible-invalid`（附失败的字段），文件与版本不变 |
| `story_bible_import` | 作品 id | `imported[]`（来源→目标、version）、`pending[]`（仍需作者补的结构化项）、`names[]`（从 `design/cast.md` 抽出的人名） | 作品不存在、或 `design/` 无可用内容时返回 `nothing-to-import` |
| `story_brief` | 作品 id、章号 | `sections[]`、`budget`、`missing[]`、`dropped[]` | 真值缺失返回 `bible-missing`；章不存在返回 `chapter-not-found` |
| `story_summarize` | 作品 id、章号（正文可选由动作读取） | `artifact { path }`、`words` | 正文不存在返回 `body-not-found` |

`story_summarize` 读当前版本的正文，写 `summaries/ch-0001.md`，长度上限 400 字（超出截断并在结果中报告 `truncated: true`），不修改正文与 manifest 的章状态。

### 写前上下文装配

纯函数 `assembleBrief(work, chapter)`，输入全部来自磁盘，无副作用：

1. **取料**：`bible/intent.md`、目标章章纲、`bible/characters.json`、`state/events.jsonl` 折叠出的未解伏笔、上一章摘要与结尾、`bible/style.md`、字数口径常量。
2. **选人物**：按章纲全文做名字匹配（`name` 出现在章纲里即入选）；章纲一个都没命中时退化为「档案全部入选」并在 `sections` 标注 `fallback: true`。
3. **分段排序**（高→低）：意图与焦点 → 章纲 → 入选人物档案 → 未解伏笔 → 上一章结尾（末尾 800 字节，按行边界截）→ 文风要点 → 字数口径。
   - 第一章或上一章不存在：该段记为 `absent`，不算失败。
   - 上一章有摘要时用摘要；摘要缺失时回退为正文末尾 800 字节，并在该段标注 `source: body`。
4. **预算**：上限 8192 字节。逐段整段纳入；剩余不足时从最低优先级段开始整段丢弃，记入 `dropped[]`（名称、字节数、原因 `budget`）；高优先级段即使超预算也保留，并记 `overBudget: true`。
5. **确定性**：所有集合按稳定键排序（人物按章纲出现顺序、伏笔按埋设章与序号、段落顺序固定）；同一输入两次装配结果逐字节一致。
6. **草稿标记**：某段来源只有一个标题时标 `draft: true`，不当作已定事实。

### 页面

两个只读路由，复用装配函数，不另写一套逻辑：

- `GET /api/dsh-storycraft/bible?root=&id=` → `{ files: [...], missing: [...] }`
- `GET /api/dsh-storycraft/brief?root=&id=&chapter=` → `assembleBrief` 的结果

工作台作品详情加两个视图：「真值」（五件列表、内容、版本、缺失项）与「写前上下文」（选章显示装配结果、预算占用、被裁项、草稿标记）。

### 兼容与迁移

- `story_init` 在建立作品时创建 `bible/` 五件（Markdown 只写标题，`characters.json` 写 `[]`）；`story_bible_write` 允许补建缺失文件，`story_bible` 只读、不补建。
- 既有作品（issue #1 验证时创建的那部）没有 `bible/`：`story_bible` 返回 `bible-missing`；`story_bible_write` 允许落盘补建；`story_bible_import` 一次性收编 `design/world.md` → `bible/world.md`、`design/outline.md` → `bible/plan.md`，并从 `design/cast.md` 的二级标题抽人名，其余结构化项列为 `pending`，不猜字段。
- 装配函数同时供动作与路由使用，避免两处实现漂移。

## 备选方案

- **把设定塞进人设提示词**：改一次设定就要重启会话，且无法按章裁剪；放弃。
- **把真值放进 manifest（结构化 JSON 单文件）**：作者无法直接读改，MD 与 JSON 混在一个文件里，版本粒度也退化；放弃。
- **让模型每次自己读全部设定**：无预算、不可复现，长书直接爆上下文；放弃。
- **用检索（FTS）代替装配**：中文分词与切块成本高，且写前需要的恰好是固定几类事实，硬装配更可控；检索留待材料库（后续阶段）。
- **摘要写进 manifest**：会让进度清单承担内容，页面与 git 都不好读；放弃。

## 验收条件

- `characters.json` 校验：缺字段、重复人名、非数组都被拒绝且版本不变；合法写入后版本变化、旧内容不再可读。
- 装配：字段齐备的输入产出七段；章纲无人物命中时走 fallback；超预算时按低优先级丢弃并报告；两次调用逐字节一致。
- 摘要：超 400 字截断并报告；正文缺失时拒绝；摘要落盘后装配使用的是摘要而非正文。
- 导入：对《开国工程队》产出 world/plan 两份目标文件与 `pending`（人物结构化、文风、意图），不写入半成品 characters。
- 路由：`/bible`、`/brief` 与动作返回同一份装配结果；`root` 仍受工作区校验；缺失/不存在返回结构化错误而不是 500。
- 回归：既有的 storage/tools/presets 三套断言全过；一次真实会话的端到端流程不受影响。

## 风险

- **真值越长越像第二份正文**：靠预算与段边界控制；超出预算的部分不参与装配，需作者主动精简。
- **人物档案与正文漂移**：装配只用档案、不推断正文；漂移由审稿动作暴露，本设计不自动同步。
- **导入靠标题启发式**：`design/cast.md` 的结构不保证，抽不到人名时 `names[]` 为空并在 `pending` 说明，不猜。
- **摘要质量由模型决定**：摘要截断与来源路径可查，但摘要是否抓住了本章事实不在机械校验范围内。
- **确定性依赖文件顺序**：排序键若加入时间戳会破坏可复现性，实现时禁止。
