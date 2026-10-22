---
title: 故事工坊：素材库（导入 / 列表 / 重命名 / 删除）
status: implemented
created: 2026-10-21
updated: 2026-10-22
verification: 51625bc；29 个单测 + 13 条 E2E；真实雪线邮路导入/删除后面板列表为空，materials/search_docs/search_fts 均无行，.storycraft/materials 副本保留
---

# Agent Note：故事工坊：素材库（导入 / 列表 / 重命名 / 删除）

> 2026-10-22 部分修订（#30 B3）：作品库升 v4，materials 增加 purpose（默认 reference），导出 manifest 升 v5（TXT 单文件）；B1 的导入/管理/托管副本边界不变；#31 再升 v5（标题索引）。

> 2026-10-22 已修订（#28 B2）：`searchMemory` 已纳入 material，素材正文进入 `story_context`（标题前缀 + ≤400 片段）；本文 §6/AC5 的排除断言已反转。

## 问题

#16 已把故事记忆（摘要/伏笔/卷）的 FTS5 检索接入 `story_context`；作品库还没有“作者素材”这一类语料。素材导入与整理是确定性的管理操作，不应让模型执行、也不该占模型上下文；B1 需要一个面板闭环，同时为 B2 的统一检索准备语料。

epub/pdf 需要额外解析、分页与依赖，不应和 txt/md 的首版绑在一起。

## 决定

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
- `origin` 是 work-relative 的 `materials/<hash8>-<安全文件名>`（只内部使用，不返回模型）；实际文件在 `.storycraft/materials/`，与 workId 无关，重命名作品不需改 origin；
- `content` 是解码后的 UTF-8 文本。

### 2. 迁移

- `WORK_SCHEMA_VERSION = 3`；新库直接建 `materials`；
- `openWork` 对 `version === 1 || version === 2` 进入迁移，其他非 3 版本仍 `schema-version-mismatch`；
- `migrateWorkSchema` 用 step 表：事务内重读 `user_version`；`<2` 做摘要 revision（v1→v2），`<3` 建 `materials`（v2→v3），最后写 3；v1 在同一事务里连续走两步；
- 建表前检查 `PRAGMA table_info(materials)`：不存在则建；列清单从共享 `MATERIALS_SCHEMA` 的列定义派生，存在但列不匹配则抛 `schema-migration-failed`；
- 失败整体回滚到进入时版本；`work-busy` 保留；成功后 best-effort 同步 `catalog.works.schema_version`；
- 目录降级沿用现有 `listWorks` 的 `degraded` / `migrationError`，不新增列。

### 3. 文件校验与 `materials.js`

新建 `materials.js`（加入 `package.json.files`），只处理字节与文件，不碰 SQL：

1. 输入是浏览器传来的 `name` + `contentBase64`，不是工作区路径；
2. `Buffer.from(contentBase64,'base64')`；`bytes ≤ 512 KB`（编码前、Buffer 双重检查）；
3. `TextDecoder('utf-8', { fatal: true })` 解码；拒绝 NUL、UTF-16 BOM、`content.trim() === ''`；
4. 文件名只取 basename，拒绝路径分隔符、`..`、空名、超长名；格式只接受 `.txt` / `.md`；
5. 计算原始 Buffer 的 SHA-256；标题默认文件名去扩展名，显式 title ≤200 code point；
6. `materials.js` 只做准备（解码、校验、标题、哈希、候选文件名），不写文件、不碰 SQL；写文件由 `store-db` 在同一事务内调用 `writeManagedCopy`，只删除本次新建的副本，绝不删除复用文件；文件名/目录与 workId 无关，`story_rename` 不需要迁移素材目录。

### 4. 导入事务

`store-db.importMaterial(root, work, input)`：

1. `materials.prepareMaterial(input)` 返回 `{content, hash, bytes, format, title, fileName}`（不写文件）；
2. `transaction(db)` 内先查 `SELECT * FROM materials WHERE hash = ?`（文件尚未写）：
   - 命中：返回已有 material + `duplicate:true`，不写文件、不写库；
   - 未命中：`mkdirSync(.storycraft/materials, {recursive:true})`；用 `openSync(path, 'wx')` 写 `<hash8>-<安全文件名>`，冲突追加序号；已存在且内容相同则复用（不删）；插入 `materials`，同步 `syncSearchDoc(db, 'material:<id>', 'material', 'materials/<id>', 0, content)`；
3. 唯一索引冲突兜底：回查 hash，返回已有；主键 `mat-<hash16>` 冲突（不同 hash 同 id）返回 `material-id-conflict`；
4. 事务失败两处都不留；只删除本次新建的副本，复用文件不删；进程在写文件后、提交前崩溃会留孤儿文件（B1 接受，后续清理）。

结果固定为：

```json
{ "ok": true, "material": { "id": "...", "title": "...", "format": "md", "bytes": 123, "hashPrefix": "abcd1234", "createdAt": "..." }, "duplicate": false }
```

### 5. 宿主 API 与面板

只使用 loopback `postRoute` / `readRoute`，不注册 `story_material_*` 模型动作。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/dsh-storycraft/materials?root=&workId=` | 列出素材元数据 |
| POST | `/api/dsh-storycraft/materials/import` | `{root, sessionId, workId, name, contentBase64, title?}`；校验当前作品后导入 |
| POST | `/api/dsh-storycraft/materials/rename` | `{root, sessionId, workId, id, title}` |
| POST | `/api/dsh-storycraft/materials/delete` | `{root, sessionId, workId, id}`；只删库与索引，保留文件 |

- 导入/重命名/删除都先从 `body.root` 经 `rootOf` 解析工作区，再校验 `sessionId` 的当前作品等于 `workId`；`getCurrent` 为空时先 hydrate `/current`，不通过则 `work-mismatch`；
- 三个 POST 要求 `Content-Type: application/json`，读取时累计字节 ≤1 MB（不信任 Content-Length），拒绝 data URL/非 canonical base64；malformed JSON 返回 `invalid-body` 而不是 500；postRoute 增加可选 maxBytes/requireJson，现有路由默认不变。
- 面板“素材”区：导入按钮（`<input type=file accept=".txt,.md">`）、列表、行内重命名、删除二次确认；
- 文件读成 ArrayBuffer 后转 base64 POST；**不发起会话消息**，不经过模型；
- 导入/重命名/删除后刷新列表；错误显示 `error.code` / `error.message`；
- `origin`、正文、绝对路径不进入任何模型可见输出；副本在 `.storycraft/` 下，`scope.js` 已拒绝模型读写 `.storycraft`，模型无法直接读素材文件；目录与 workId 无关，作品改名/删除不改素材 origin。
- 重复导入返回已有素材；已有 title/origin 优先，本次显式 title 被忽略。

### 6. 检索与导出

- material 文档：`kind='material'`、`doc_id='material:<id>'`、`search_docs.source='materials/<id>'`、`chapter=0`；
- 现有 `search()` 可命中；B2 起 `searchMemory` 也纳入 material，素材正文进入 `story_context`；#31 后标题也进入 FTS，标题仍只在前缀；
- `story_export` manifest 升到 3，新增 `materials: [{id,title,format,bytes,hash,origin}]`，并写 `materials/<id>.<format>`；`origin` 是 bucket-relative 的 `materials/<hash8>-<name>`，实际路径 `.storycraft/materials/<origin>`，不经过 `sanitizeOutput` 的 `source` 改写；备份仍包含整库；
- #18/#25 的 Note 加 pending 指针，说明 v3 = v2 字段 + 素材。

### 7. 删除与重命名

- 重命名更新 `materials.title` 并重建该素材的搜索文档（#31 标题索引）；body/哈希不变；
- 删除：`DELETE FROM materials` + `dropSearchDoc('material:<id>')`，同一事务；`materials/` 文件保留；
- 重复导入已删除内容：hash 查询不到，复用现有文件（若同名）或新写副本，重新入库。

### 8. 错误码

| 错误码 | 触发 |
| --- | --- |
| `material-format-unsupported` | 非 txt/md |
| `material-too-large` | >512 KB |
| `material-encoding-invalid` | 非 UTF-8、NUL、UTF-16 BOM |
| `material-empty` | 解码后为空 |
| `material-name-invalid` | 文件名含路径/空/超长/危险字符 |
| `material-title-too-long` | 标题 >200 code point |
| `material-id-conflict` | 不同 hash 撞同一 `mat-*` 主键 |
| `material-write-failed` | 托管副本写入失败（ENOSPC/EACCES 等） |
| `material-not-found` | 删除/重命名不存在的 id |
| `work-mismatch` | session 当前作品与 workId 不一致 |

失败不写 `materials`、不写 `search_docs`、不写文件；重复导入不是错误。

## 备选方案

- **模型动作导入/列表**：会让素材管理占用模型上下文，且导入是确定性操作；否决。
- **只接受工作区 `materials/` 收件箱**：作者需要知道目录；否决为主入口，保留为高级/脚本方式。
- **把素材写进 `bible` 表**：`bible` 是“每份真值一行”且会被所有角色读入；否决。
- **只写 `search_docs` 不建 `materials`**：无法列表/去重/溯源；否决。
- **素材放工作区文件，索引派生**：会引入文件与库同步问题；B1 副本由宿主管理，库仍是真源。
- **一次支持 epub/pdf**：解析、分页、编码复杂，拖大 B1；否决，后置。
- **删除时连文件一起删**：误删风险高；否决，只删库与索引。

## 后果

产品验收在 #26；本 Note 检查技术性质：

1. v2→v3 只加 `materials`；v1 链式迁移后 `user_version=3`；失败回滚；坏表形状失败。
2. 导入文件、materials 行、search_docs 三者一致；失败回滚文件与库。
3. 同 hash 并发只留一行；重复导入不新增文件。
4. 文件名安全、512 KB、UTF-8/NUL/UTF-16/空文件、格式都有测试。
5. `search()` 与 `searchMemory` 都能命中 material；`searchMemory` 返回 ≤400 的标题+片段；作品隔离。
6. API 校验 session 当前作品；面板不发起模型消息；E2E 覆盖导入/重命名/删除/重复导入。
7. 删除保留文件；重命名不改内容/哈希；导出 manifest v3 带 hash/origin；作品改名后列表/`search` 仍命中（origin 与 workId 无关）。
8. 新路由/客户端字段不经过 `sanitizeOutput` 的路径改写；模型输出无 path/origin/content。

## 风险

- 512 KB CJK 仍可能产生大量 bigram/单字 token；B1 接受，B2 若素材量增长再评估分片/上限。
- UTF-8 之外编码被拒绝，作者需另存为 UTF-8。
- 素材全文入库，库体积随素材增长；导出与备份体积变大。
- 删除保留文件，`materials/` 会积累孤儿文件；B1 接受，后续可加清理。
- `mat-<hash16>` 理论碰撞极低；碰撞返回 `material-id-conflict`，不覆盖。
- 素材暂不参与 `story_context`，作者会感觉“导入了但写作时用不上”；B2 紧接着做。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- `material.test`：导入/去重/列表/重命名/删除/隔离/作品改名/错误矩阵/BOM/写失败清理。
- 迁移：v1→v2→v3、v2→v3、坏表拒绝、失败回滚。
- E2E：面板导入、重复导入、重命名、删除、非法格式错误。
- 真实 `雪线邮路`：导入后在面板删除；库中 `materials`/`search_docs`/`search_fts` 均为空，`.storycraft/materials/2bf06491-雪线邮路.md` 副本保留。
