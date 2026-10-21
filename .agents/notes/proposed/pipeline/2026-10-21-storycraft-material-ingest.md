---
title: 故事工坊：素材入库（txt/md）
status: proposed
created: 2026-10-21
updated: 2026-10-21
---

# Agent Note：故事工坊：素材入库（txt/md）

## 问题

#16 已把故事记忆（摘要/伏笔/卷）的 FTS5 检索接入 `story_context`；作品库还没有“作者素材”这一类语料。B1 需要先把 txt/md 从工作区 `materials/` 收件箱导入作品库、同步检索索引，并随导出取回；B2 才能把素材并入统一检索。

epub/pdf 需要额外解析、分页与依赖，不应和 txt/md 的首版绑在一起。

## 提案

### 1. 存储：作品库 `materials`

作品库 schema 从 v2 升到 v3，新增（`MATERIALS_SCHEMA` 常量，`WORK_SCHEMA` 与迁移共用）：

```sql
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  origin TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_hash ON materials(hash);
```

- `id = mat-<sha256 前 16 位>`；`hash` 存完整 SHA-256（对**原始文件字节**计算，含 BOM/CRLF）；
- `bytes` 是原始文件字节数；`format` 是 `txt` / `md`；
- `origin` 是收件箱相对路径 `materials/<相对路径>`（只内部使用，不返回模型）；
- `content` 是解码后的 UTF-8 文本，直接存库。

### 2. 迁移

- `WORK_SCHEMA_VERSION = 3`；新库直接建 `materials`；
- `openWork` 对 `version === 1 || version === 2` 进入迁移，其他非 3 版本仍 `schema-version-mismatch`；
- `migrateWorkSchema` 用 step 表：事务内重读 `user_version`；`<2` 做摘要 revision（v1→v2），`<3` 建 `materials`（v2→v3），最后写 3；v1 在同一事务里连续走两步；
- 建表前检查 `PRAGMA table_info(materials)`：不存在则建；列清单直接从共享的 `MATERIALS_SCHEMA` 列定义派生，存在但列不匹配则抛 `schema-migration-failed`，不静默复用坏表；
- 失败整体回滚到进入时版本；`work-busy` 保留；成功后 best-effort 同步 `catalog.works.schema_version`；
- 目录降级沿用现有 `listWorks` 的 `degraded` / `migrationError`，不新增列。

### 3. 文件边界与 `materials.js`

新建 `materials.js`（加入 `package.json.files`），把文件策略从 SQL store 拆出：

1. `path` 必须是相对路径，只接受 `materials/` 前缀；拒绝绝对路径、盘符、任何 `..` 段、空路径；
2. `realpathSync(root)` 与 `realpathSync(target)` 比较，目标必须仍在 `materials/` 内；拒绝目录、非普通文件、symlink/junction 跳出；`materials/` 或目标不存在时 `realpathSync` 的 ENOENT 映射为 `material-not-found`，不是 path-invalid；
3. 只接受 `.txt` / `.md`（大小写不敏感）；`stat.size ≤ 512 KB`，读入后再按 Buffer.length 复核；
4. 读原始 Buffer 计算 SHA-256 与 `bytes`；`TextDecoder('utf-8', { fatal: true })` 解码；
5. 拒绝 NUL 字节、UTF-16 BOM、解码后 `content.trim() === ''` 为空的文件（`material-empty`）；
6. 标题默认 `basename` 去扩展名；显式 title 覆盖，≤200 code point。

路径包含判断复用 `scope.js` 导出的 `within(root, target)`（保留 Windows 大小写折叠），不在 `store-db` 重写；前缀按 `materials` 路径段判断，`\` 先归一，Windows 折叠大小写，拒绝 `.` 段。

### 4. 导入事务

`store-db.importMaterial(root, work, input)`：

1. 调 `materials.readMaterialSource` 得到 `{content, hash, bytes, format, origin, title}`；
2. `transaction(db)` 内先查 `SELECT * FROM materials WHERE hash = ?`：
   - 命中：返回已有 material + `duplicate:true`，不写；
   - 未命中：插入 `materials`，同步 `syncSearchDoc(db, 'material:<id>', 'material', 'materials/<id>', 0, content)`；
3. 唯一索引冲突兜底：捕获 `UNIQUE`，回查并返回已有；主键 `mat-<hash16>` 冲突（不同 hash 同 id）返回 `material-id-conflict`；
4. 事务失败两处都不留。

`origin`、正文、绝对路径都不进入模型输出；结果固定为：

```json
{ "ok": true, "material": { "id": "...", "title": "...", "format": "md", "bytes": 123, "hashPrefix": "abcd1234", "createdAt": "..." }, "duplicate": false }
```

`story_materials(work)` 返回 `ok:true` + `materials` 数组，字段同上，按 `created_at`、`id` 排序。

### 5. 检索与导出

- material 文档：`kind='material'`、`doc_id='material:<id>'`、`search_docs.source='materials/<id>'`、`chapter=0`；
- 现有 `search()` 可命中；`searchMemory` 仍只取 `summary/hook/volume`，B1 不改变 `story_context`；
- `story_export` manifest 升到 3，新增 `materials: [{id,title,format,bytes,hash,origin}]`，并写 `materials/<id>.<format>` 文件；`origin` 是 workspace 相对路径，绝不是绝对路径，也不经过 `sanitizeOutput` 的 `source` 改写；备份仍包含整库；
- #18 的 Note 加部分修订指针，说明 manifest v2→v3 与 `materials` 表；#25 的 Note 也加指针，说明 v3 = v2 字段 + 素材。

### 6. 动作

- `story_material_import(work, path, title?)`：写；返回固定形状；不返回 content/origin；
- `story_materials(work)`：只读列表；
- 两个动作都注册输出 schema；新键放 `OUTPUT_PROPERTIES`，不把 `source` 键交给模型（`sanitizeOutput` 会把任何 `source` 改成 `sourceIds`）；
- `material:<id>` 是素材文档身份，不由 `story_read` 解析；在 #22 的记录里注明，不新增 `story_read` 分支。

### 7. 错误码

| 错误码 | 触发 |
| --- | --- |
| `material-path-invalid` | 绝对路径、盘符、`..`、不在 `materials/`、目录、非普通文件、symlink 跳出 |
| `material-not-found` | 文件不存在 |
| `material-format-unsupported` | 非 txt/md |
| `material-too-large` | >512 KB |
| `material-encoding-invalid` | 非 UTF-8、NUL、UTF-16 BOM |
| `material-empty` | 解码后为空 |
| `material-title-too-long` | 标题 >200 code point |
| `material-id-conflict` | 不同 hash 撞同一 `mat-*` 主键 |

失败不写 `materials`、不写 `search_docs`；重复导入不是错误。

## 备选方案

- **把素材写进 `bible` 表**：复用现成表，但 `bible` 是“每份真值一行”且会被所有角色读入；素材体积大、种类多，否决。
- **只写 `search_docs` 不建 `materials`**：能检索但无法列出/去重/溯源，否决。
- **素材放工作区文件，索引派生**：可 diff，但作品库已是唯一真源，且会引入文件与库同步问题；否决。
- **一次支持 epub/pdf**：解析、分页、编码复杂，拖大 B1；否决，后置。
- **导入时立即接入 `story_context`**：B2 的范围，先验证入库与检索；否决提前耦合。
- **不导出素材**：作者导出会静默丢失导入内容；否决，纳入 v3 manifest。

## 验收条件

产品验收在 #26；本 Note 检查技术性质：

1. v2→v3 只加 `materials`，不改已有表；v1 链式迁移后 `user_version=3`；失败回滚并保留原版本；坏表形状失败。
2. 导入事务同时写 `materials` 与 `search_docs`；失败两处都不留；同 hash 并发只留一行。
3. 路径策略复用 `scope.js` 的 `within(root,target)` + realpath；`..`、盘符、目录、symlink 跳出、非 txt/md、512 KB、UTF-16/NUL/空文件都有测试。
4. `search()` 命中 material；`searchMemory` 不返回 material；作品隔离。
5. 输出只含元数据，不含 content/origin；`story_materials` 同样。
6. 导出 manifest v3 含素材元数据与文件；备份恢复后素材仍在。
7. 新动作/字段进入 `OUTPUT_PROPERTIES`，模型输出 schema 校验通过；README 动作表、`export-backup.test` 的 schemaVersion 3、`db.test` 表清单、`migration.test` 的 v2 fixture（drop materials）同步。

## 风险

- 512 KB CJK 仍可能产生大量 bigram/单字 token，`search_docs.tokens` 与 `materials.content` 会重复存；B1 接受，B2 若素材量增长再评估分片/上限。
- UTF-8 之外编码（GBK、UTF-16）被拒绝，作者需另存为 UTF-8。
- 素材全文入库，库体积随素材增长；导出与备份体积变大。
- `mat-<hash16>` 理论碰撞极低；碰撞返回 `material-id-conflict`，不覆盖。
- 素材暂不参与 `story_context`，作者会感觉“导入了但写作时用不上”；B2 紧接着做。
