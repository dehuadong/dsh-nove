# Agent Note: 故事工坊：F5 备份与恢复（含素材原文件）

Status: implemented

工作项：当前任务 F5（不新建 GitHub issue）。现有作品级 DB 备份为基础；B1 暴露素材原文件不在备份内。

## Problem

现有备份只复制作品 SQLite：

- `.storycraft/materials` 里的 epub/pdf 原文件不在备份中；
- 恢复后抽取文本仍可检索，但导出 pdf/epub 报 `material-origin-missing`；
- 删除/移章触发的自动安全备份同样缺素材；
- 备份列表只显示 DB 大小，作者不知道这份备份能否还原素材。

F5 要求“作品级快照与恢复”；本轮把**素材原文件**纳入显式快照，并保持自动安全备份的 DB-only 语义。

## 对拍参考

- `inkos-master/packages/core/src/utils/atomic-file-set.ts` 与 `__tests__/atomic-file-set.test.ts:130-140` 用“临时事务 + 备份旧文件 + 替换/回滚”保证多文件变更不半写。
- 参考工程没有作品级 DB+附件备份可直接照搬；本项目现有 `backupWork`/`restoreBackup` 是权威实现。
- 本项目 `store-db.ts:4569` 只备份 DB；`materials` 表存 `origin/hash/bytes`，原文件在 `.storycraft/materials/<origin 的 basename>`。
- 现有 ZIP 能力来自 bundled `jszip`（B1），不新增依赖。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 原子文件集 + 回滚 | DB + 素材 sidecar；恢复先写素材、再换 DB | 避免 DB 指向未写入 origin | 等价适配 | 备份测试 |
| 无附件备份 | 显式备份带 `.materials.zip`；自动安全备份 DB-only | 不让删章/移章被大素材阻塞 | 偏差 | 单元 |
| 备份只记文件大小 | 记录素材数量/字节/hash | 面板可判断可还原 | 补强 | 面板 |

## Decision

### 快照格式

- 保持 `<workId>-<token>.db` 为主备份文件；
- 显式备份（面板/`story_backup`，带 `withWorkLock`）额外写 `<workId>-<token>.materials.zip`：
  - `manifest.json`：`{formatVersion:1, schemaVersion, workId, createdAt, materials:[{id,format,origin,hash,bytes}]}`；
  - `materials/<basename(origin)>`：原文件字节；
- 无素材时不写 sidecar；sidecar 先写 `.tmp`，校验后 rename；
- 自动安全备份（删章/移章、restore 前）**只用 DB**，不写 sidecar；失败不影响破坏性操作。

### 备份

`backupWork(root, work, options?)`：

- 默认 `materials:true`（显式/面板/`story_backup`）；自动路径传 `materials:false`；
- DB 备份完成后，查询 `materials` 的 `origin/hash/bytes`；显式备份逐个解析并校验 `^materials/[^/\\\\]+$` 的 origin、hash、size；
- 缺失/损坏报 `backup-material-missing`/`backup-material-corrupt`，删除本次 DB 备份与临时 sidecar，整次备份失败；
- sidecar 写入临时路径，完成后 rename；返回 `{file, materialsFile?, integrity, materials:{count,bytes}}`；
- `backupWork(destination)` 的 sidecar 为 `<destination>.materials.zip`；显式 destination 仍支持 DB-only（`materials:false`）。

### 列表/删除/保留

- `listBackups` 改为 async：按 token 配对 DB + sidecar；有 sidecar 时异步读 manifest 得 `materials:{count,bytes}`；`bytes` 是 DB+sidecar 总量；
- 无 sidecar 时以只读方式打开备份 DB，数 `materials` 行：>0 标 `incomplete:true`（DB 已写、sidecar 未完成），=0 标 `noMaterials:true`；有 sidecar 但 manifest 读不出/格式不符则标 `corrupt:true`，不与缺 sidecar 混用；
- `deleteBackup` 删除 DB + sidecar；`pruneBackups` 同时删除超限 token 的 sidecar；孤立 sidecar（无 DB）在 list/prune 时清理；
- 面板显示“含素材 N 份/字节”“仅数据库”“不完整：缺素材 sidecar”或“素材 sidecar 损坏”。

### 恢复

`restoreBackup`：

- 先把备份 DB 复制到 stage，按现有 schema/integrity 校验；失败时 DB 与素材都不动；
- 有 sidecar：先校验 manifest 的 `schemaVersion/workId`；只读取 manifest 明确列出的 `materials/<basename(origin)>` entry，**不用 `extractAllTo`**，拒绝未知 entry；逐项校验 hash；失败报 `backup-material-corrupt`，DB 不动；
- DB stage 与 sidecar 都校验通过后，把素材文件复制到 `.storycraft/materials`（content-addressed 名字；同名同 hash 幂等），**再**执行安全 DB 备份/换入；
- 素材写入失败时 DB 不动；DB 换入失败时残留的素材是额外内容，不影响旧 DB，下一次备份/恢复可继续；
- 无 sidecar 的备份按 DB-only 恢复，receipt `materialsRestored:0`；不自动补 sidecar；sidecar 与 stage DB 的 materials 行逐项匹配，错配按 `backup-material-corrupt` 拒绝；
- 安全备份只用 DB，避免递归 sidecar 与恢复清理问题；
- receipt 增加 `materialsRestored` 与 `hasMaterials`。

### Origin 校验

- 备份与恢复都要求 `origin` 形如 `materials/<filename>`，拒绝 `..`、斜杠和绝对路径；
- 同时备份 txt/md 与 epub/pdf 的受管副本，保持“保留来源”一致；material 行没有合法 origin 时显式备份报 `backup-material-origin-missing`，不跳过。

### 面板/工具

- 备份列表显示 bytes/time/materials/`noMaterials`；
- 恢复确认文案说明会同时恢复素材原文件；无 sidecar 显示“仅数据库”；
- `story_backup` 描述从“单个文件”改为“DB + 素材 sidecar”；不新增模型工具。

## Alternatives considered

**A. 只把素材文本塞回 DB。** 最强理由是单文件。否决原因：原文件是 B1 的来源与导出依据。

**B. 备份改成单 zip（DB+素材）。** 最强理由是单文件。否决原因：改变现有 `.db` 路径/列表/删除语义，旧备份兼容成本高；sidecar 保持主文件不变。

**C. 自动安全备份也带素材。** 最强理由是统一。否决原因：删章/移章会被大素材和缺失 origin 阻塞；显式备份负责附件。

**D. 旧备份自动迁移。** 最强理由是统一。否决原因：AGENTS 不做旧数据迁移；无 sidecar 按 DB-only 恢复并标 `noMaterials`。

## Testing

- `tests/backup-materials.test.mjs`：显式 sidecar、列表计数、恢复原文件、PDF 导出回归、损坏 sidecar、缺失/损坏 origin、未知 entry、路径穿越、孤立 sidecar 清理、自动 DB-only、noMaterials/incomplete、DB-only receipt、prune/delete 配对、显式 destination。
- `tests/export-backup.test.mjs`：无写权限仍报 `backup-failed`。
- `e2e/backup-materials.spec.cjs`：上传 PDF → 备份 → 移走原文件 → 恢复 → 导出 epub → 清理素材。
- 完整 CI：93 单元 + 48 E2E。

## Consequences

- sidecar 与 DB 不是单文件原子事务；临时文件 + rename + 失败删除 DB 备份，崩溃可能留下孤立 sidecar，list/prune 清理；DB 已写而 sidecar 未 rename 时，列表按 DB 的 materials 行标 `incomplete`；
- 恢复先写素材再换 DB：若 DB 换入失败，残留素材是额外文件，不损坏旧库；这是接受的崩溃窗口；
- 旧 `.db` 备份不含素材，作者需重新创建备份；
- 大素材备份 CPU/磁盘开销；显式备份失败即停，不静默降级。
