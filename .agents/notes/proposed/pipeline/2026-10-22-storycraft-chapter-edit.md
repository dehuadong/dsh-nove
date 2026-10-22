---
title: 故事工坊：章节删除与重排
status: proposed
created: 2026-10-22
updated: 2026-10-22
---

# Agent Note：故事工坊：章节删除与重排

## 问题

作品库以 `chapters.number` 为主键，正文版本、章纲、摘要、审稿、事件和搜索文档都引用章号。删除/移动章节必须一次性重排这些引用，且不能留下章号空洞或半成品。

现有库不保证章号从 1 连续：`writePlan` 在空作品上可以直接建第 3 章。所以映射必须按**现存章号的排序 rank** 重新编号，而不是简单 ±1。

## 提案

### 1. 操作与入口

- 删除任意章；上移/下移相邻章；
- 面板章节行提供「上移」「下移」「删除」；删除用原生 `confirm`；
- 只走宿主路由，不注册 `story_*` 动作：
  - `POST /chapter/delete` `{root,sessionId,workId,chapter,confirm}`；
  - `POST /chapter/move` `{root,sessionId,workId,from,to}`；`to` 必须是排序后相邻章的章号（允许 1,3 这种空洞），否则 `chapter-edit-target-invalid`；
- 当前作品校验，body ≤32KB；
- 参数：整数章号；`confirm !== true` 返回 `chapter-delete-unconfirmed`；越界 `chapter-not-found`；`from === to` 或边界上移/下移返回 `{changed:false}`，不写库。

### 2. 纯映射

导出 `chapterRemap(keys, operation) -> Map<old,new>`：

- 删除：从排序后的 keys 去掉 `chapter`，幸存者按 rank 赋 1..K；
- 移动：从排序后的 keys 取 `from`，插入到目标 rank，再按顺序赋 1..K；
- 结果唯一、连续；无操作时返回空 map；
- 纯函数，单测覆盖空洞、重排、首尾、唯一章。

### 3. 事务步骤（顺序固定）

1. **备份先行**：`backupTo` 写 `.storycraft/backups/<workId>-*.db`；备份失败则中止，不进入删除/移动。
2. `transaction()` 内 `PRAGMA defer_foreign_keys = ON`；`openWork` 可能触发 v4→v5 迁移，这是打开成本，不属于数据写入。
3. **删除先行**：删除 `chapters` 行（级联 versions/plans/summaries/reviews），删除该章 events、`chapter:<n>:*`、`summary:<n>` 与该章 `doc_id LIKE 'event:%'` 的搜索文档。重编号完成后，再补一条 `chapter-edit` 标记事件：`seq = 删除前 oldMax+1`、`chapter = K === 0 ? 0 : 1`、不进入映射、不建搜索文档；未知 kind 被 fold 忽略，防止下一事件复用 seq。
4. 按映射重编号：每张引用表先写 `-new`，再写回 `new`；`chapters`、`chapter_versions`、`chapter_plans`、`summaries`、`reviews`、`events.chapter`。
5. 搜索文档：chapter 文档按 `kind='chapter'`、summary 按 `kind='summary'`、event 文档按 `doc_id LIKE 'event:%'`（它们的 kind 是 entity/hook）；先把待改 `doc_id` 改成 `tmp:<rowid>`，再写新 id/source/chapter；event 只改 chapter、doc_id 不变；volume/card/material 不动；最后 `search_fts` rebuild。
6. `touchMeta` 更新 `updated_at`；提交后才返回。测试 seam：函数可选 `{ beforeCommit }`，在 commit 前调用，抛错即回滚；API 不传。
7. 任何一步失败整事务回滚；备份文件保留作为恢复点。

### 4. 事件与卷

- 事件 `seq` 对幸存事件不变；删除后补 marker 防止 seq 回退；`events.chapter` 按映射。
- 卷 `from_ch`/`to_ch` **不自动改**；结果返回 `staleVolumes: [id]`（端点不再存在或区间越界），面板提示作者用「卷」视图调整。`writeVolume` 的端点存在校验保持不变。
- 摘要 revision 绑定、审稿 revision、章纲 approval 时间随章号移动，内容不变。
- 重排会改变“最高章”与 `volumes.to_ch = last` 的判断：未定稿章可能被移到已定稿章之前，`nextStep`/卷摘要提示可能错位；面板提示作者检查后续流程与卷边界。

### 5. 面板

- 章节行加「上移」「下移」「删除」；边界禁用；
- 删除确认；操作后刷新并 `setSelected`：
  - 删除中间：选原号（下一章前移）；
  - 删除末章：选前一章；
  - 删除唯一章：清空选择；
  - 上移/下移：选移动后的章号；
  - 取消/失败：保持原选择；
- 显示 `staleVolumes` 提示；composer 不变；
- 0 章时仍可写第 1 章。

### 6. 边界

- 不做撤销/回收站/历史版本恢复；删除前自动备份是唯一恢复点。
- 不跨作品移动；不新增 schema 版本；不新增模型动作。
- 导出是快照，编辑后需重新导出；重新导出 manifest v6，章节号与作品库一致。
- 文档落点：README 接口表/页面写动作说明、#4 A2 行。
- 卷边界由作者调整，本项不自动推断。

## 错误码

| 码 | 触发 |
| --- | --- |
| `chapter-not-found` | 章号不存在 |
| `chapter-delete-unconfirmed` | 删除时 `confirm !== true` |
| `invalid-body` | 缺少 session/workId 或章号非整数 |
| `work-mismatch` | 会话当前作品不匹配 |
| `backup-failed` | 删除前备份失败，未改数据 |
| `chapter-edit-target-invalid` | 移动目标不是相邻章 |

`from === to` 或边界上移/下移返回 `{changed:false}`，不是错误。错误优先级：先查章号范围（`chapter-not-found`），再查是否相邻（`chapter-edit-target-invalid`）。

## 与既有记录

- **补充 A2** #4：章节删除/上下移；作品改名已交付。
- **补充 #18** [sqlite-store](../../implemented/pipeline/2026-10-19-storycraft-sqlite-store.md)：章号引用清理/事务重排。
- 更新 API/页面说明；导出/备份格式不变。

## 备选方案

- **只删末章**：无法清理中段废章；否决。
- **留空号**：读取/导出/搜索按连续号假设；否决。
- **简单 ±1 映射**：不处理空洞；否决。
- **自动推断卷边界**：不可靠；否决，返回 staleVolumes 让作者调整。
- **模型动作**：作者直接操作；否决。

## 验收条件

产品验收在 #34；本 Note 检查技术性质：

1. `chapterRemap` 对空洞/唯一章/首尾移动返回连续唯一映射；无操作返回空；非相邻移动返回 `chapter-edit-target-invalid`。
2. 删除中间/末/唯一章：章号连续；被删引用消失；幸存章的内容/revision/title/status/stage/words/planApprovedAt 不变；volume/card/material 文档保留。
3. 上下移（含 1,3 空洞）：`to` 取相邻章号；目标区间引用跟随；events/search 同步；volume/card/material 文档不变。
4. 删除前备份存在；`touchMeta` 更新；事务失败（`beforeCommit` 抛错）回滚全部表/索引/meta。
5. 搜索 doc_id/source/chapter 与 kind 一致；FTS 无旧章结果；seq 不回退。
6. 卷 stale 返回且面板提示；0 章导出 title-only TXT/EPUB，随后可写第 1 章。
7. 面板确认/边界禁用/选中规则/错误；E2E 用专用工作 fixture，不 pin 现有 2 章。
8. 重新导出后 manifest 章号与库一致；旧导出不自动变。
9. 真实验证在**临时克隆**上做：复制整个 `.storycraft` 工作区（含 catalog/works/backups）到临时目录，删除/移动后核对，不触碰作者库。

## 风险

- 大量章重排写多表；一次事务，失败回滚。
- 删除不可撤销，只有备份；作者需确认。
- 卷区间不自动调整，作者需手动对齐。
- 事件 seq 不变但章号改变，旧 trace 章号会变；重排的预期。
- 自动备份占用磁盘；保留策略沿用现有 backups。
