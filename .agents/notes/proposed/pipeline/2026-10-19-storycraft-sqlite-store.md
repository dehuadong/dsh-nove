---
title: 故事工坊：作品入库与导出（SQLite）
status: proposed
created: 2026-10-19
updated: 2026-10-19
---

# Agent Note：故事工坊：作品入库与导出（SQLite）

## 问题

作品以文件存储，带来检索语料重复、跨作品隔离只能靠路径守卫、版本/审稿/事件分散、原子性靠暂存目录模拟。作者不依赖文件 diff，手动改在发布平台或未来工作台完成，因此「文件优先」的收益下降。

## 提案

### 库与表

库：`<工作区>/.storycraft/works.db`；`journal_mode=WAL`、`busy_timeout=5000`、`foreign_keys=ON`；启动时 `PRAGMA user_version` 校验 schema 版本。

| 表 | 关键列 |
| --- | --- |
| `works` | `work_id PK`、`title`、`form`、`plan_approval`、`word_min`、`word_max`、`outline_written_at`、`outline_approved_at`、`created_at`、`updated_at` |
| `volumes` | `work_id`、`id`、`title`、`from_ch`、`to_ch`、`summary` |
| `chapters` | `work_id`、`number`、`title`、`stage`、`current_revision`、`words`、`plan_approved_at`、`updated_at` |
| `chapter_versions` | `work_id`、`number`、`revision`、`body`、`words`、`created_at` |
| `chapter_plans` | `work_id`、`number`、`text`、`written_at` |
| `summaries` | `work_id`、`number`、`text`、`written_at` |
| `reviews` | `work_id`、`number`、`round`、`text`、`revision`、`created_at` |
| `events` | `work_id`、`seq`、`at`、`chapter`、`kind`、`payload`（JSON） |
| `bible` | `work_id`、`name`、`content`、`version`、`updated_at` |
| `proposals` | `id`、`title`、`form`、`premise`、`created_at`、`used_at` |

主键与外键约束保证作品隔离；所有查询以 `work_id` 为第一条件。

### 事务取代暂存

写入在单事务内完成；失败回滚。不再需要 `.staging` 与 manifest-last 语义；`work lock` 保留用于同进程串行。

### 导出（常备能力，非交付门槛）

`story_export(work)` 按需产出目录（可选 zip），作者可随时用于测试、查看或发布前取稿：

```
manifest.json
chapters/ch-0007.md         当前版
chapters/ch-0007.r2.md      历史版
bible/{intent,characters,style,plan}.md|json
outline/ch-0007.plan.md
summaries/ch-0007.md
reviews/ch-0007.r1.md
state/events.jsonl
```

顺序与换行固定，两次导出内容一致。

### 备份与完整性

`story_backup` 复制库文件，执行 `PRAGMA integrity_check` 并返回结果；检查失败时给出「用导出恢复」的建议。schema 版本不符时拒绝打开并提示。备份与导出都不作为交付门槛。

### 与 #17 / #16 的关系

- #17 守卫增加库文件：无当前作品时拒绝直接读写 `.storycraft/works.db`；
- #16 在本项表上建 FTS5（`chapters` 正文、`summaries`、`events`），不再需要 corpus 收集；#16 需在本项交付后重规划。

## 备选方案

- **保持文件**：检索与隔离成本持续；否决（产品路径已确认不需要文件 diff）。
- **文件 + 索引（参考做法）**：可行但不解决一致性与隔离；否决。
- **文件为准 + 元数据库（C）**：两处存储一致性问题；否决。
- **保留旧文件作品迁移**：测试数据可弃；不做。

## 验收条件

产品行为与验收由 #18 拥有。本设计证明：

1. schema 版本、外键与 `work_id` 隔离由 `db.test` 覆盖；
2. 事务回滚（模拟写入失败）后库内状态不变；
3. 导出目录逐文件对比 golden，两次导出一致（质量保障，不是交付门槛）；
4. `integrity_check` 与损坏库路径有测试；
5. 200 章 fixture 的加载/追加耗时满足 #18 性能门槛。

## 风险

- `storage.js` 重写与测试重写是本轮最大工作量；
- SQLite 实验性 API 需要在启动时探测；
- 二进制库排障依赖导出；
- 与 #16 的接口需要一次重规划。
