---
title: 故事工坊：作品入库与导出（SQLite，一作品一库）
status: implemented
created: 2026-10-19
updated: 2026-10-22
verification: 交付时 20 个单元测试文件与 7 条页面 spec 全绿；200 章加载 2.35ms、追加 16ms；交付提交 1fa449e；当前 29/13 由 #26/#27 扩展，v1→v3 迁移由 #25/#26 覆盖
---

# Agent Note：故事工坊：作品入库与导出（SQLite，一作品一库）

> 2026-10-22 补充（#30 B3）：作品库升 v4（素材 purpose），导出 manifest 升 v4；v3 导出/备份仍有效，恢复时走迁移。

> 2026-10-21 部分修订：`db.js:331` 的“任何非当前 `user_version` 都拒绝打开”改为 v1→v2→v3 受控自动迁移；v3 新增 `materials` 表，导出 manifest 升到 3 并带素材文件。迁移失败新增 `schema-migration-failed`，`work-busy` 仍可重试。迁移细节见 [摘要 revision 绑定](2026-10-21-storycraft-summary-revision-binding.md) 与 [素材库](2026-10-21-storycraft-material-ingest.md)。

## 问题

作品以文件存储：检索语料重复、跨作品隔离只能靠路径守卫、版本/审稿/事件分散、原子性靠暂存目录模拟。作者不依赖文件 diff，手动改在发布平台或未来工作台完成，「文件优先」的收益下降。

单库（一工作区一库）在规模上不成立：一部 100 万字作品含版本约 10–15MB，几十部就是数百 MB；损坏、备份、锁竞争都以整库为单位。

## 决定

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
| `works` | `work_id PK`、`title`、`form`、`tags`、`schema_version`、`created_at`、`updated_at`、`trashed_at`、`missing_at` |
| `proposals` | `id`、`title`、`form`、`premise`、`characters`、`conflict`、`notes`、`created_at`、`used_at`、`used_work_id` |
| `session_current` | `session_id PK`、`work_id`、`updated_at` |

`missing_at` 是对账标记，不在原始设计的最小列集合里；它让「有行无文件」不必逐个打开作品库就能被列表跳过。

### work db

| 表 | 关键列 |
| --- | --- |
| `meta` | 单行：`work_id`、`title`、`form`、`tags`、`plan_approval`、`word_min`、`word_max`、`outline_written_at`、`outline_approved_at`、`created_at`、`updated_at` |
| `chapters` | `number PK`、`title`、`status`、`stage`、`current_revision`、`words`、`plan_approved_at`、`last_revise_mode`、`updated_at` |
| `chapter_versions` | `number`、`revision`、`body`、`words`、`created_at`；PK(`number`,`revision`) |
| `chapter_plans` | `number PK`、`text`、`written_at` |
| `summaries` | `number PK`、`text`、`revision`、`written_at` |
| `materials` | `id PK`、`title`、`format`、`origin`、`bytes`、`hash`、`created_at`、`content`；`hash` 唯一 |
| `reviews` | `number`、`round`、`text`、`revision`、`created_at` |
| `events` | `seq PK`、`at`、`chapter`、`kind`、`payload` |
| `volumes` | `id PK`、`title`、`from_ch`、`to_ch`、`summary` |
| `bible` | `name PK`、`content`、`version`、`updated_at` |
| `search_docs` | `doc_id PK`、`kind`、`source`、`chapter`、`body`、`tokens` |
| `search_fts` | FTS5 external-content，行号对应 `search_docs` |

没有 `work_id` 列：作品身份由**文件**承载，跨库查询不可能发生。`meta.updated_at` 承担列表排序的活动时间，`catalog.updated_at` 只随目录操作更新。

### 生命周期

所有跨库操作先做 catalog 写、再做文件移动（或反之），失败按下面的顺序回滚；移动前 `wal_checkpoint(TRUNCATE)`，并一并处理 `-wal`/`-shm`。

- 立项：先建 `works/<id>.db` 并初始化，再插 catalog；catalog 失败则删文件；
- 改名：移动文件 → 更新作品库 `meta` → 在同一 catalog 事务里更新 `works`、`session_current.work_id` 与 `proposals.used_work_id`；catalog 失败时回滚 `meta` 并把文件移回；
- 删除：移动文件到 `.storycraft/trash/` → 记 `trashed_at`；写目录失败则移回；目标位置已有孤儿回收站文件时先改名保留，不覆盖；
- 恢复：检查 `works/` 无同名 → 移回 → 清 `trashed_at`；写目录失败则移回 trash；
- 启动对账：宿主启动时对已知工作区、首次读取时对其余工作区做一次对账（目录锁定时下次读取重试）；catalog 有行无文件 → 标记 `missing_at` 并在列表跳过；有文件无行 → 忽略并记录诊断；trash 有文件无行 → 保留待人工恢复；
- 备份/导出：用 `backup()`（或 `VACUUM INTO`）与单作品读取，复制/打包单文件。

### 连接、锁与错误码

- 每次操作打开目标库，`journal_mode=WAL`、`busy_timeout=5000`、`foreign_keys=ON`；写事务 `BEGIN IMMEDIATE`；`SQLITE_BUSY` → `work-busy`；
- 对账与诊断连接用 `busy_timeout=0`，锁定时立即降级，不拖慢列表或宿主启动；
- v1→v3：`openWork` 对 v1/v2 在事务内按 step 表迁移；v1→v2 给 `summaries` 加 `revision` 并回填，v2→v3 建 `materials`；成功后 best-effort 更新 `catalog.works.schema_version`；未知版本仍 `schema-version-mismatch`，迁移失败返回 `schema-migration-failed`，库保持进入时版本；
- 错误码：`sqlite-unavailable`、`db-corrupt`、`schema-version-mismatch`、`schema-migration-failed`、`backup-failed`、`work-not-found`、`work-exists`；素材错误码见 [素材库](2026-10-21-storycraft-material-ingest.md)；
- 启动探测 `node:sqlite`；缺失时所有动作返回 `sqlite-unavailable`，无文件回退。

### 虚拟路径与导出

- 动作与路由返回的 `artifact.path`：`works/<workId>/chapters/ch-0007.md`（虚拟，不对应磁盘文件）；
- `story_export(work)` 产出：`manifest.json`（schemaVersion 3、title/form/tags/wordRange/planApproval、outline 时间、章节状态、素材元数据）、`chapters/ch-0007.md`=r1、`ch-0007.rN.md`=第 N 版、`outline/*.plan.md`、`summaries/*.md`、`reviews/*.rN.md`（全部轮次）、`bible/{intent,characters.json,style,plan,world}`、`volumes.json`、`proposals/<id>.json`（仅 `used_work_id` 指向该作品的提案）、`state/events.jsonl`、`materials/<id>.<format>`；顺序与 mtime 固定；
- `story_backup(work)` 用 `backup()`/`VACUUM INTO`，返回 `integrity_check`；
- 面板「导出」走 `exportWorkAtomic`：临时目录 → 旧目标备份 → rename 提交，失败保留旧导出；`story_export` 的默认/显式目标行为不变。

### 与 #17 / #16 的关系

- #17 守卫仍整体拒绝 `.storycraft`（库文件不可读），语义从「一个大库」变为「每作品一个文件」，不改变拒绝规则；导出的取用方式是「作者在系统文件管理器中打开」，不是让模型读；
- #16 检索：每部作品一个 `search_docs`/`search_fts`，查询天然只在本作品内，不再需要 `work_id` 过滤。

## 与既有记录的关系

- 部分替代 `implemented/pipeline/2026-10-17-storycraft-two-phase-commit.md`：staging/manifest-last 由事务取代，`work-busy` 保留；
- 取代 `proposed/pipeline/2026-10-19-storycraft-retrieval.md` 的语料与索引部分（FTS5 按作品建）；#16 重写排序与段；
- #12 的 `trace.sections[].source` 已改为虚拟路径。

## 备选方案

- **单库（一工作区一库）**：规模与爆炸半径不可接受；否决。
- **保持文件**：检索与隔离成本持续；否决。
- **文件 + 索引**：一致性问题仍在；否决。
- **每作品一个目录 + 多文件 DB（SQLite ATTACH）**：复杂度高，收益不明显；否决。

## 后果

- 作品内容离开文件系统：模型与作者都不能直接读库，排障依赖 `story_export` 与 `story_backup`；导出由作者在系统文件管理器中取用。
- 多文件生命周期（改名/删除/恢复）需要仔细的错误处理：实现按上述顺序回滚，并在启动/首次读取时对账、把诊断写进宿主日志。
- catalog 与作品文件可能不同步：缺失作品在列表跳过，孤儿文件与孤儿回收站文件保留，等待人工恢复。
- SQLite 成为运行时依赖：缺失时全部动作返回 `sqlite-unavailable`，没有文件回退。
- 每作品独立文件放弃了跨作品查询；检索限定在单作品内，正好符合隔离要求。

## 验证

- 20 个单元测试文件（`storycraft/tests/*.test.mjs`）与 7 条页面 spec（`node storycraft/e2e/run.mjs`）全绿。
- 验收 1–4 由 `db.test`、`catalog.test`、`store-db.test`、`store-chapter.test`、`store-search.test`、`work-ops.test`、`storage.test`、`tools.test`、`export-backup.test` 覆盖；`work-busy`、`db-corrupt`、`schema-version-mismatch`、`backup-failed` 各有断言。
- 200 章 fixture：加载 2.35ms、追加一章 16ms（门槛 100ms / 50ms，`store-perf.test`）。
- 交付提交 `1fa449e`（基线 `5148eb9`）；工作项 `dehuadong/dsh-nove#18`。
