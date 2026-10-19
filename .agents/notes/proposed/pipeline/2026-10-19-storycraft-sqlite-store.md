---
title: 故事工坊：作品入库与导出（SQLite）
status: proposed
created: 2026-10-19
updated: 2026-10-19
---

# Agent Note：故事工坊：作品入库与导出（SQLite）

## 问题

作品以文件存储：检索语料重复、跨作品隔离只能靠路径守卫、版本/审稿/事件分散、原子性靠暂存目录模拟。作者不依赖文件 diff，手动改在发布平台或未来工作台完成，「文件优先」的收益下降。

## 提案

### 库、连接与锁

- 库：`<工作区>/.storycraft/works.db`；`journal_mode=WAL`、`busy_timeout=5000`、`foreign_keys=ON`；`PRAGMA user_version` 存 schema 版本；
- 启动探测 `node:sqlite`：不可用则动作返回 `sqlite-unavailable`（无文件回退）；
- 每次操作独立连接（打开→事务→关闭），不跨 `await` 共享连接；写操作一律 `BEGIN IMMEDIATE`；
- 并发：`BEGIN IMMEDIATE` + 比较 `works.updated_at`（乐观校验）代替跨进程文件锁；冲突返回 `work-busy`；
- WAL 的 `-wal`/`-shm` 与主库同属受保护路径。

### 表

| 表 | 关键列 |
| --- | --- |
| `works` | `work_id PK`、`title`、`form`、`tags`、`plan_approval`、`word_min`、`word_max`、`outline_written_at`、`outline_approved_at`、`trashed_at`、`created_at`、`updated_at` |
| `chapters` | `work_id`、`number`、`title`、`status`、`stage`、`current_revision`、`words`、`plan_approved_at`、`updated_at`；PK(`work_id`,`number`) |
| `chapter_versions` | `work_id`、`number`、`revision`、`body`、`words`、`created_at`；PK 加 revision |
| `chapter_plans` | `work_id`、`number`、`text`、`written_at` |
| `summaries` | `work_id`、`number`、`text`、`written_at` |
| `reviews` | `work_id`、`number`、`round`、`text`、`revision`、`created_at` |
| `events` | `work_id`、`seq`、`at`、`chapter`、`kind`、`payload` |
| `volumes` | `work_id`、`id`、`title`、`from_ch`、`to_ch`、`summary` |
| `bible` | `work_id`、`name`、`content`、`version`、`updated_at` |
| `proposals` | `id`、`title`、`form`、`premise`、`characters`、`conflict`、`notes`、`created_at`、`used_at`、`used_work_id`（全局，不属于某作品） |
| `session_current` | `session_id PK`、`work_id`、`updated_at` |

- 全部外键 `ON UPDATE CASCADE ON DELETE CASCADE`；重命名作品即更新 `works.work_id` 并级联；
- 删除为软删除（`trashed_at`），恢复清空；`listWorks` 只列未删除。

### 检索表（本项只建与同步，不排序）

- `search_docs(work_id, doc_id, kind, source, chapter, body, tokens)`；`kind` 覆盖 `chapter`、`summary`、`entity`、`hook`、`volume`、`card`；
- `search_fts`：FTS5 external-content，`tokens` 存预切分中文二元 + 一元 + 拉丁词；
- **同步范围**：`writeChapter`/`reviseChapter`（chapter）、`writeSummary`、`foldState`（entity/hook）、`writeVolume`、人物卡写入；全部在同一事务内完成；
- 排序、段与 trace 由 #16 决定。

### 动作兼容

- 25 个 `story_*` 动作与全部宿主路由保持名称、参数与业务错误码；
- `artifact.path` 等路径字段改为**虚拟路径**（`works/<work>/chapters/ch-0007.md`），供 UI 展示与导出定位；
- staging 专属结果/错误码（`cleaned`、`invalid-path`、`stage-incomplete`、`invalid-artifact`）随暂存机制删除；`work-busy`、`plan-not-found`、`outline-required` 等业务码保留；
- `.current.json` 迁入 `session_current`，`works/` 目录可以完全不存在；
- `story_export`、`story_backup` 为新增动作。

### 导出（常备能力，非交付门槛）

`story_export(work, destination?)` 产出：

```
manifest.json         schemaVersion / title / form / tags / wordRange / planApproval /
                      outline.writtenAt|approvedAt /
                      chapters[{number,title,status,stage,currentRevision,words,planApprovedAt}]
chapters/ch-0007.md            r1（旧约定：首版不加后缀）
chapters/ch-0007.r2.md…rN.md   第 2…N 版（当前版由 manifest 的 currentRevision 指向）
outline/ch-0007.plan.md
bible/{intent,characters,style,plan,world}.md|json
summaries/ch-0007.md
reviews/ch-0007.r1.md…rN.md    全部轮次
volumes.json
proposals/<id>.json            全部提案
state/events.jsonl
```

- 文件顺序固定、换行固定、zip 内 mtime 固定为同一时间，两次导出逐字节一致；
- 目标缺省为 `<工作区>/.storycraft/exports/<work>-<timestamp>/`（在 #17 的保护根内，无当前作品的会话读不到）；作者传外部目标时由作者负责。

### 备份与完整性

- `story_backup(destination?)` 使用 SQLite `backup()` API（不复制 WAL 状态），返回 `integrity_check` 结果；缺省目标 `<工作区>/.storycraft/backups/works-<timestamp>.db`；
- 错误码：`sqlite-unavailable`、`db-corrupt`、`schema-version-mismatch`、`backup-failed`；
- schema 版本不符拒绝打开；损坏时提示从备份恢复（导出无法替代库内修复）。

### 与 #17 的关系

#17 的守卫增加第二个根 `<工作区>/.storycraft`；数据库、`-wal`、`-shm` **一律拒绝**（单文件无法按作品隔离）；`glob`/`grep` 默认拒绝覆盖该目录。

## 与既有记录的关系

- **部分替代** `implemented/pipeline/2026-10-17-storycraft-two-phase-commit.md`：`.staging`、manifest-last、`cleaned` 与 staging 错误码失效；其并发语义以 `BEGIN IMMEDIATE` + `works.updated_at` 乐观校验保留（`work-busy` 仍存在）；该记录的「不做 SQLite」结论由本记录取代。
- **部分取代** `proposed/pipeline/2026-10-19-storycraft-retrieval.md` 的语料与索引部分：`corpus.js` 与「拒绝 FTS5」作废；#16 在本项表上重写，排序与段设计继续有效。
- **#12** 的 `trace.sections[].source` 从文件路径改为虚拟路径，实现时同步其记录。
- **#17** 需扩到 `.storycraft` 根，见上。

## 备选方案

- **保持文件**：检索与隔离成本持续；否决。
- **文件 + 索引**：一致性问题仍在；否决。
- **文件为准 + 元数据库**：两处存储；否决。
- **共享连接 + 长事务**：`node:sqlite` 同步会阻塞其余请求；否决。
- **保留 staging/manifest-last**：事务已覆盖；否决。

## 验收条件

产品行为与验收由 #18 拥有。本设计证明：

1. schema 版本、外键级联、`work_id` 隔离、软删除由 `db.test` 覆盖；
2. 事务回滚、`BEGIN IMMEDIATE` 冲突（`work-busy`）有测试；
3. 25 个动作的现有契约测试迁移后仍通过（staging 专属断言删除）；
4. 导出目录 golden 对比（`.md`=r1、`.rN.md`=第 N 版），两次导出逐字节一致；
5. `backup()`、`integrity_check`、缺省目标与四种错误码有测试；
6. `search_docs`/`search_fts` 在正文、摘要、状态、卷、人物卡写入后都同步，由测试覆盖；
6. 200 章 fixture 的加载/追加耗时满足 #18 的性能门槛。

## 风险

- `storage.js` 与测试重写是本轮最大工作量；
- SQLite 实验性 API：已实测 DSH 运行时可用（Electron 44.7 / Node 24.21），仍需启动探测；
- 二进制库排障依赖备份；
- `artifact.path` 从真实路径变虚拟路径，文档与 UI 文案需同步。
