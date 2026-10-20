---
title: 故事工坊：作品入库与导出（SQLite，一作品一库）
status: proposed
created: 2026-10-19
updated: 2026-10-20
---

# Agent Note：故事工坊：作品入库与导出（SQLite，一作品一库）

## 问题

作品以文件存储：检索语料重复、跨作品隔离只能靠路径守卫、版本/审稿/事件分散、原子性靠暂存目录模拟。作者不依赖文件 diff，手动改在发布平台或未来工作台完成，「文件优先」的收益下降。

单库（一工作区一库）在规模上不成立：一部 100 万字作品含版本约 10–15MB，几十部就是数百 MB；损坏、备份、锁竞争都以整库为单位。

## 提案

### 布局

```
<工作区>/.storycraft/
  catalog.db                作品列表、提案、会话当前作品
  works/<workId>.db         单部作品的全部内容
  exports/<workId>/         按需导出
  backups/<workId>-<ts>.db  单作品备份
```

- `catalog.db` 只存元数据，保持很小；**catalog 是 title/form/tags 的权威**，`meta` 是导出副本，写操作同步两者；
- 每部作品独立 schema 版本（`PRAGMA user_version`），并记入 `catalog.works.schema_version`，对账不必逐个打开库；
- 备份/导出/删除/迁移都以**单文件**为单位；
- 不同作品的 WAL 与写锁互不影响。

### catalog.db

| 表 | 关键列 |
| --- | --- |
| `works` | `work_id PK`、`title`、`form`、`tags`、`schema_version`、`created_at`、`updated_at`、`trashed_at` |
| `proposals` | `id`、`title`、`form`、`premise`、`characters`、`conflict`、`notes`、`created_at`、`used_at`、`used_work_id` |
| `session_current` | `session_id PK`、`work_id`、`updated_at` |

### work db

| 表 | 关键列 |
| --- | --- |
| `meta` | 单行：`work_id`、`title`、`form`、`tags`、`plan_approval`、`word_min`、`word_max`、`outline_written_at`、`outline_approved_at` |
| `chapters` | `number PK`、`title`、`status`、`stage`、`current_revision`、`words`、`plan_approved_at`、`updated_at` |
| `chapter_versions` | `number`、`revision`、`body`、`words`、`created_at`；PK(`number`,`revision`) |
| `chapter_plans` | `number PK`、`text`、`written_at` |
| `summaries` | `number PK`、`text`、`written_at` |
| `reviews` | `number`、`round`、`text`、`revision`、`created_at` |
| `events` | `seq PK`、`at`、`chapter`、`kind`、`payload` |
| `volumes` | `id PK`、`title`、`from_ch`、`to_ch`、`summary` |
| `bible` | `name PK`、`content`、`version`、`updated_at` |
| `search_docs` | `doc_id PK`、`kind`、`source`、`chapter`、`body`、`tokens` |
| `search_fts` | FTS5 external-content，行号对应 `search_docs` |

没有 `work_id` 列：作品身份由**文件**承载，跨库查询不可能发生。

### 生命周期

所有跨库操作先做 catalog 写、再做文件移动（或反之），失败按下面的顺序回滚；移动前 `wal_checkpoint(TRUNCATE)`，并一并处理 `-wal`/`-shm`。

- 立项：先建 `works/<id>.db` 并初始化，再插 catalog；catalog 失败则删文件；
- 改名：移动文件 → 更新作品库 `meta` → 更新 catalog；catalog 失败时回滚 `meta` 并把文件移回；
- 删除：移动文件到 `.storycraft/trash/` → 记 `trashed_at`；写目录失败则移回；
- 恢复：检查 `works/` 无同名 → 移回 → 清 `trashed_at`；写目录失败则移回 trash；
- 启动对账：catalog 有行无文件 → 标记 `missing` 并在列表跳过；有文件无行 → 忽略并记录诊断；trash 有文件无行 → 保留待人工恢复；
- 备份/导出：用 `backup()`（或 `VACUUM INTO`）与单作品读取，复制/打包单文件。

### 连接、锁与错误码

- 每次操作打开目标库，`journal_mode=WAL`、`busy_timeout=5000`、`foreign_keys=ON`；`openStore`（实现命名 `openWork`，目录用 `openCatalog`）只打开已存在作品库、不自动建库，未立项 id 返回 `work-not-found`；
- 写事务 `BEGIN IMMEDIATE`；`SQLITE_BUSY` → `work-busy`；
- 错误码：`sqlite-unavailable`、`db-corrupt`、`schema-version-mismatch`、`backup-failed`、`work-not-found`、`work-exists`；
- 启动探测 `node:sqlite`；缺失时所有动作返回 `sqlite-unavailable`，无文件回退。

### 虚拟路径与导出

- 动作与路由返回的 `artifact.path`：`works/<workId>/chapters/ch-0007.md`（虚拟，不对应磁盘文件）；
- `story_export(work)` 产出：`manifest.json`（schemaVersion、title/form/tags/wordRange/planApproval、outline 时间、章节状态）、`chapters/ch-0007.md`=r1、`ch-0007.rN.md`=第 N 版、`outline/*.plan.md`、`summaries/*.md`、`reviews/*.rN.md`（全部轮次）、`bible/{intent,characters.json,style,plan,world}`、`volumes.json`、`proposals/<id>.json`（仅 `used_work_id` 指向该作品的提案）、`state/events.jsonl`；顺序与 mtime 固定；
- `story_backup(work)` 用 `backup()`/`VACUUM INTO`，返回 `integrity_check`。

### 与 #17 / #16 的关系

- #17 守卫仍整体拒绝 `.storycraft`（库文件不可读），语义从「一个大库」变为「每作品一个文件」，不改变拒绝规则；导出的取用方式是「作者在系统文件管理器中打开」，不是让模型读；
- #16 检索：每部作品一个 `search_docs`/`search_fts`，查询天然只在本作品内，不再需要 `work_id` 过滤。

## 与既有记录的关系

- 部分替代 `implemented/pipeline/2026-10-17-storycraft-two-phase-commit.md`：staging/manifest-last 由事务取代，`work-busy` 保留；
- 取代 `proposed/pipeline/2026-10-19-storycraft-retrieval.md` 的语料与索引部分（FTS5 按作品建）；#16 重写排序与段；
- #12 的 `trace.sections[].source` 改为虚拟路径，实现时同步；

## 备选方案

- **单库（一工作区一库）**：规模与爆炸半径不可接受；否决。
- **保持文件**：检索与隔离成本持续；否决。
- **文件 + 索引**：一致性问题仍在；否决。
- **每作品一个目录 + 多文件 DB（SQLite ATTACH）**：复杂度高，收益不明显；否决。

## 验收条件

产品行为与验收由 #18 拥有。本设计证明：

1. `catalog.db` 只含元数据；作品内容全部在 `works/<id>.db`；
2. 每作品 schema 版本独立，升级一个作品不影响其他；
3. 改名/删除/恢复按上述顺序执行，失败回滚；启动对账覆盖孤儿行/文件/trash；
4. 备份/导出以单作品文件为单位（`backup()`/`VACUUM INTO`，非文件复制）；
5. 200 章 fixture 的加载/追加仍满足 #18 性能门槛；
6. `work-busy`、`db-corrupt`、`schema-version-mismatch`、`backup-failed` 有测试；
7. 检索投影在单作品库内同步（正文/摘要/状态/卷/人物卡）。

## 风险

- 多文件生命周期（改名/删除/恢复）需要仔细的错误处理；
- catalog 与作品文件可能不同步（文件在、目录无），需要启动时对账；
- 二进制库排障依赖备份；
