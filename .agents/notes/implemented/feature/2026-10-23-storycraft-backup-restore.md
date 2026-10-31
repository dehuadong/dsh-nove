# Agent Note: 故事工坊：备份恢复、删除与保留策略

Status: implemented

> 2026-10-31 F5 扩展：显式备份增加 `.materials.zip` sidecar；恢复先校验 DB/素材，再写素材、换 DB；自动安全备份仍 DB-only。


## 问题

`backupWork` 只负责写备份；面板只能看列表和新建。备份会无限增长，恢复只能手工拷文件。导出是覆盖快照，备份是历史副本，两者行为必须在页面上区分。

## 决定

### 1. 备份标签

主标签增加 `备份`，顺序：

```text
章节 | 真值 | 写前上下文 | 素材 | 导出 | 备份
```

- 备份页：`立即备份` + 保留策略下拉 + 列表；
- 列表只显示 `^<workId>-(\d+)\.db$`（workId 正则转义），避免工作 `a` 显示 `a-1` 的备份；按新到旧，行首 `01/02/03`（`String(index+1).padStart(2,'0')`）；排序键统一用**文件名时间戳降序**；
- 六标签；tab order 收敛成一个常量，`client.js` 两处数组和 E2E 的 `toHaveCount` 一起改；
- 每行：文件、大小、时间、`恢复`、`删除`；
- 导出页只保留导出目录/状态，不再显示备份。

### 2. 创建与保留

`POST /backups/create` 增加可选 `keep`：

```json
{"root":"...","sessionId":"...","workId":"...","keep":10}
```

- `keep` 允许 0（不清理）、5、10、20；其他值拒绝；
- 创建/恢复/删除统一走 catalog-only `targetWork(root,sessionId,workId)`（`listWorks` + `getCurrent`，不打开当前 work DB）；
- 创建成功后 `pruneBackups(root, workId, keep)`：
  - 只列当前作品 `^<workId>-(\d+)\.db$`（workId 做正则转义）；不能只做前缀匹配，避免工作 `a1` 匹配到 `a1-2-1730.db`；
  - 按文件名时间戳从新到旧（与列表同一键）；
  - 超过 `keep` 的旧文件删除；
  - 删除失败不影响已创建的新备份，返回 `pruned`/`failed` 计数；
- 保留策略存 `localStorage`（`storycraft.backup.keep`），默认 10；服务端不新增 schema；`keep` 省略按 10，非 0/5/10/20 → `backup-keep-invalid`；
- 恢复前的自动备份**不参与本次清理**；章节删除/`story_backup` 的自动备份也不在面板保留策略内（接受此缺口，后续统一）。

### 3. 恢复

`POST /backups/restore` `{root,sessionId,workId,backupId,confirm}`：

1. **不调用 `writeWorkTarget`**（它会 `readManifest`→`openWork`，损坏的当前库会在恢复前失败）；改用 catalog-only `targetWork(root,sessionId,workId)`：`listWorks` 确认 active 行 + `getCurrent` 会话指针；`confirm !== true` → `backup-restore-unconfirmed`；
2. **先取 per-work 锁**（与 export 共用一个 `workLocks`，不另建一套）；锁内完成 3–9；
3. 解析 `backupId`：
   - 只接受 `backup:<workId>:<token>`；
   - `token` 只允许**纯数字**（`/^\d+$/`），必须是 `<workId>-<token>.db`；
   - 路径 resolve 后仍在 `backupsDir`；其他作品的文件名（如工作 `a1` 的 `a1-2-1730.db`）token 含连字符，直接拒绝；
   - 缺失 → `backup-not-found`；
4. 校验备份：`openDatabase(file, readOnly)` → `integrityCheck` → `meta.work_id === workId`；F5 起再校验可选素材 sidecar 与 stage DB 的 materials 行；读/坏/不匹配统一 `backup-invalid`；
5. **准备 stage 并迁移**：复制备份到 works 的临时 `.<workId>-restore-<random>.db`，打开 stage 执行现有 `migrateWorkSchema` 到当前版本；迁移/校验失败清 stage，当前库不动；
6. **自动备份当前版本**：`backupWork(root, work, {materials:false})`（F5 起安全备份 DB-only）；
   - 普通失败 → `backup-failed`，中止；
   - `db-corrupt`：不移动当前库，标记 `corrupt=true`；跳过 `openWork`/checkpoint，直接进入交换；这是唯一允许无完整安全副本的路径；
7. 非 corrupt：`openWork` + `checkpoint` 后关闭；关闭失败 `work-busy`，中止；
8. 替换：
   - 非 corrupt：`moveDatabaseFiles(current, safety)`；失败清 stage，中止；
   - corrupt：`moveDatabaseFiles(current, hiddenCorrupt)`，`hiddenCorrupt` 用 `.corrupt-<workId>-<时间戳>.db`，**不以 `<workId>-` 开头**，不进入列表/清理；
   - `moveDatabaseFiles(stage, current)`；失败把 safety/hiddenCorrupt 移回 current，清 stage；回滚也失败 → `backup-rollback-failed`，保留 safety 并说明路径；
9. **交换后先校验**：`openWork(current)` + `integrityCheck === ok`；失败把 safety/hiddenCorrupt 移回 current，返回 `backup-invalid`；成功才删除 safety（自动备份已在 backups），corrupt 的 hidden 副本保留供诊断；
10. `touchCatalogUpdatedAt`；catalog 标题/形态不变；返回 `{workId, restoredBackup, safetyBackup, corrupt}`。

边界：

- 恢复是覆盖式，当前正文/摘要/审稿以备份为准；
- 备份文件本身保留；
- 恢复期间不并发导出/编辑；`workLocks` 同时覆盖 export/create/prune/restore；
- 恢复失败保留当前库（corrupt 路径也把 hidden 副本移回；交换后校验失败同样回滚）；
- 恢复会更新 `updated_at`，但不改 catalog title/form；meta 内的字数范围/计划确认随备份回滚。

### 4. 删除

`POST /backups/delete` `{root,sessionId,workId,backupId,confirm}`：

- `targetWork` catalog-only 校验 session 当前作品；

- 同样校验 `backupId` 路径；
- `confirm` 必需；
- 只 `unlink` 目标文件；不存在 → `backup-not-found`；
- 不删除当前作品库、不删除 `.tmp/.bak` 导出目录。

### 5. UI

- `BackupTab`：
  - 创建按钮；保留策略 select（5/10/20/不清理，默认 10，localStorage）；
  - 列表序号、文件、大小、时间；恢复/删除按钮；
  - 恢复确认：`恢复会用备份覆盖当前作品库；恢复前会自动备份当前版本。继续？`
  - 删除确认；
  - 操作中禁用；失败保留列表并提示。
- 恢复成功后 `onReload` 刷新作品详情（章节/真值/摘要都可能变）。
- 六标签：`章节 / 真值 / 写前上下文 / 素材 / 导出 / 备份`；E2E tab 计数同步；
- 不新增 composer 消息，不注册 `story_*` 动作。

### 6. 测试

- 单元 `backup-restore.test.mjs`：
  - 创建 12 份，keep 10 删除 2 最旧；keep 5/20/0；keep 非法；
  - 两个作品 `a1`/`a1-2` 的备份互不匹配；
  - 修改正文后恢复备份，正文回到备份版本；恢复前自动新增备份；
  - 坏文件/缺失备份/错误 workId/错误 session/路径穿越拒绝，当前库哈希不变；
  - 当前库损坏时走 hidden `.corrupt-*` 恢复；交换后校验失败回滚；
  - 删除备份后文件消失，重复删除 `backup-not-found`。
- E2E：备份标签、序号、创建+保留、恢复确认、删除确认、取消不请求；沿用临时工作区。
- 真实：临时克隆 `.storycraft` 恢复并核对，作者库不动。

## 与既有记录

- **补充 #37 面板**：增加备份标签；导出页移除备份列表。
- **补充 #36 导出**：导出覆盖快照，备份历史副本，两者文档分清。
- **补充 #18 存储**：备份已存在，本项加恢复/删除/保留。
- 更新 README/API/#4 E20。

## 备选方案

- **备份覆盖同名文件**：丢历史；否决。
- **恢复直接覆盖不自动备份**：失败无退路；否决。
- **把保留策略存 DB**：要 schema 迁移；本项先客户端。
- **恢复时回滚 catalog 标题**：备份是作品内容快照，标题由当前 catalog 拥有；否决，文档说明。

## 后果

1. 备份标签、序号、列表、创建、恢复、删除可用；导出页不混备份。
2. 创建按 keep 清理最旧；keep=0 不清理；失败不丢新备份。
3. 正常恢复替换内容并自动备份当前版本；恢复前备份存在；交换后完整性校验通过。
4. 坏备份/缺失备份/错误 session/错误路径/未确认不改变当前库；交换后校验失败回滚；回滚失败保留 safety。
4b. 当前库损坏：不生成完整安全备份，把损坏 DB/WAL/SHM 移到隐藏 `.corrupt-*` 后恢复；失败把 hidden 移回；列表不显示该 hidden 文件。
5. 删除只删目标备份；重复删除报错；路径穿越拒绝。
6. 单元/ E2E/真实临时工作区通过；README/API/#4 E20 同步。

## 验证

- `trash-backup.test.mjs`：33 单测；备份创建/保留 10/删除/恢复/损坏恢复/同名前缀隔离通过。
- E2E 受本机 DSH 登录弹窗阻塞，未执行；需要恢复测试环境后补。

- 交付证据：33 单测；备份创建/保留/删除/恢复/损坏恢复通过；E2E 受登录弹窗阻塞

## 风险

- 恢复是覆盖式；确认文案与自动备份是唯一护栏。
- 恢复大文件时复制耗时；per-work 锁会阻塞同作品导出/备份，期间面板应禁用。
- 保留策略在客户端，换设备/清缓存会回默认 10。
- 旧备份 schema 可能低于当前；恢复后 `openWork` 会迁移，需测试 v4→v5。
