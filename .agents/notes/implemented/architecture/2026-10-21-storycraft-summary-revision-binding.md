# Agent Note: 故事工坊：摘要绑定正文 revision 与过期识别

Status: implemented


> 2026-10-24 部分替代：摘要的存储位置从 `summaries.revision` 迁到 `summary:<n>` 的 `content.bodyRevision`，由 [L-R10a S2 ChapterSummary 迁移](2026-10-24-storycraft-summary-migration.md) 拥有；本 Note 的 stale 语义、manifest 的 `summaryRevision`/`summaryStale` 口径与 v1→v2 迁移结论继续适用。

> 2026-10-22 补充（#30 B3）：恢复 v3 备份时走 v3→v4 迁移；摘要绑定边界不变。

> 2026-10-21 导出边界已修订：`manifest.schemaVersion = 3`，在 v2 字段基础上增加 `materials` 元数据；本文其余 v2 字段不变。#26 交付后 `export-backup.test` 已改。

## 问题

`summaries` 只有 `number` / `text` / `written_at`，没有记录摘要依据的正文版本。摘要在 `revised` 或清稿审稿后写入，此后 `story_revise` 或 `story_write(rewrite)` 可能再改正文，但摘要仍被当作当前：

- `story_next` 只判断摘要文本是否存在（`store-db.js` 的 `summaryOf`），过期摘要会直接进入 `story_state`；
- `story_state` 只要求摘要文本非空，不检查版本（`tools.js`）；
- `story_brief` 的 `recentSummaries` / `previous` 与 `story_context` 的 `recent` 会把过期摘要当作当前前情；
- `readWork.hasSummary` 只看行是否存在；`status()` 目前完全没有摘要字段，面板看不出摘要已过期；
- #24 已把 revision 绑定、`WORK_SCHEMA_VERSION` 升级与旧作品回填明确留给后续；`reopen` 不作废正文，不列入本问题。

## 与既有记录

- **部分替代** `implemented/architecture/2026-10-21-storycraft-summary-transport.md`：该 Note 的“已有非空摘要 → `summary-exists`”、`ifAbsent` 语义、“`nextStep` / `hasSummary` 保持不变”以及面板固定指令中的“摘要已存在”由本项改写；角色、payload、400 字上限、尝试次数与回执形状继续适用。
- 部分修订 `db.js:331` 的“任何非当前 `user_version` 都拒绝打开”行为：v1→v2 改为受控自动迁移；`schema-version-mismatch` 仍用于未知版本，迁移失败改用 `schema-migration-failed`。交付时把新错误码登记进 `2026-10-19-storycraft-sqlite-store.md` 的错误码清单；该 Note 的布局、单文件备份/导出/删除结论继续适用。
- 沿用 `2026-10-20-storycraft-artifact-identity.md` 的 `summary:<n>` artifact 身份；`hasSummary` / `summaryStale` 是面板与 `readWork` 字段，不进入模型可见 artifact，故不改变 #22。
- 对拍表「卷/摘要/滚动」行在交付时从“绑定未立项”改为已交付。

## 决定

### 1. Schema 与迁移

`summaries` 增加一列，**可空**：

```sql
revision INTEGER
```

可空是必要的：`chapters.current_revision = 0` 表示“没有正文”，不能拿 0 当“未知版本”的哨兵，否则空章节会被误判为 current。`NULL` 表示“没有可用版本”。

`WORK_SCHEMA_VERSION` 从 1 升到 2；新建库直接写 `revision`。v1 库在首次 `openWork` 时迁移：

```sql
BEGIN IMMEDIATE;
-- 事务内重新读取 user_version；已为 2 则 COMMIT（不是 return），
-- 否则连接会带着未结束的事务返回。
ALTER TABLE summaries ADD COLUMN revision INTEGER; -- 列已存在则跳过
UPDATE summaries SET revision = (
  SELECT CASE WHEN chapters.current_revision > 0 THEN chapters.current_revision END
  FROM chapters WHERE chapters.number = summaries.number
) WHERE revision IS NULL;
PRAGMA user_version = 2;
COMMIT;
```

迁移规则：

- 事务内重新读 `PRAGMA user_version`：并发打开的第二个连接在拿到 `BEGIN IMMEDIATE` 后看到 2，执行 `COMMIT` 后原样返回；不会重复 `ALTER`。
- `ALTER` 前检查 `PRAGMA table_info(summaries)`，列已存在则跳过；回填只处理 `revision IS NULL`，不会把已经正确绑定的旧摘要重新绑到今天的版本。
- v1/v2 进入 step 迁移，其他版本返回 `schema-version-mismatch`；迁移失败返回 `schema-migration-failed`，库保持进入时版本，连接关闭。
- `SQLITE_BUSY` 按现有 `work-busy` 返回（可重试），不包装成迁移失败；`openWork` 的 5s busy timeout 仍先生效。
- 旧摘要按迁移时的 `current_revision` 回填；`current_revision` 为 0 的章节回填 `NULL`。历史里已经过期、但当时没有版本信息的摘要无法追溯，只能按“当前版本”对待；这是兼容性限制。
- 迁移成功后 best-effort 更新 `catalog.works.schema_version = 3`；目录不可写、不存在或 `work-busy` 时忽略，目录字段不作为打开门槛。
- `story_export` 的 manifest 升到 3（v2 字段 + 素材元数据）；章节条目增加 `summaryRevision`（无摘要为 `null`）与 `summaryStale`（无摘要或 current 为 `false`）。摘要文件仍是当前文本，不导出历史。

### 2. 判定与读取

唯一判定原语 `summaryStateOf(db, number)`（在调用方已有的连接/事务上执行一次 `LEFT JOIN`）：

```text
{ state: 'current' | 'stale' | 'missing', text, revision, currentRevision }
current = row 存在 && trim(text) <> '' && revision !== null && revision === currentRevision
stale   = row 存在 && trim(text) <> '' && revision !== null && revision !== currentRevision
missing = 其余（含空文本行与 revision IS NULL）
```

- `readSummaryState(root, work, chapter)` 只是 `openWork` + `summaryStateOf` 的薄包装，供跨连接读取使用；`foldState` 必须直接用 `summaryStateOf(db, number)`，不能在 `BEGIN IMMEDIATE` 内再开第二个连接。
- 不用 `transaction()` 读：读路径只做一次 SELECT，不取写锁，避免与写入争 `BEGIN IMMEDIATE`。
- `readSummary(root, work, chapter)` 继续返回文本，供 `story_read` 等只读路径使用。
- `readWork` / `status()` 用同一个 `summaryStateMap(db)` 批量取章节状态，不从 `readManifest` 的第二次连接推断版本。
- `nextStep` 同样从 `openWork` 的同一个连接读取章节与摘要（或使用同一快照），不混用 `readManifest` 的章节版本与另一个连接的摘要版本。
- `readWork` 增加 `summaryRevision`（无摘要 `null`）与 `summaryStale`；`hasSummary` 改为 `state === 'current'`。
- `status()` 的每章条目同样增加 `summaryRevision` / `summaryStale` / `hasSummary`。`story_status` 没有声明 output schema；本项只扩展 payload，不新增模型可见 schema。
- 旧摘要文本仍可 `story_read`；不新增 stale 字段，过期信号由 `readWork` / `story_next` 提供。

### 3. 写入与准入

`store-db.writeSummary` 仍是唯一写入属主：

- 事务内读 `chapters.current_revision`，写入 `revision = current_revision`；
- 手动 `story_summarize` 仍 upsert，可覆盖当前或过期摘要；
- 委派路径 `ifAbsent` 的含义改为“**当前版本**已有非空摘要才拒绝”：过期摘要允许重新生成；
- 返回 `{ workId, chapter, chars, truncated, summaryRevision }`；`bible.writeSummary` 继续只暴露 `{ path, truncated, words }`，`story_summarize` / `story_delegate` 的回执形状不变。
- `delegate.js` 的 summarizer 预检改用 `readSummaryState`：`current` → `summary-exists`；`stale` / `missing` 允许；不再只看原始文本。

`story_state` 工具保留现有的早期摘要检查（missing/stale 先返回，保持 tools 的 `summary-required` 优先级）；`foldState` 在事务内、现有审稿/阶段校验**之后**再用同一个 `summaryStateOf(db, number)` 复查一次：`missing` → `summary-required`，`stale` → `summary-stale`，通过后才写事件与阶段。这样既保留 `storage.test` 的“未审稿 → `review-required`”直调行为，也封住工具预检与落盘之间的竞态；两处错误码相同，不引入新的优先级分支。

### 4. 读取方语义

| 读取方 | 行为 |
| --- | --- |
| `readWork` / 面板 | `hasSummary` 只在 current 为 true；`summaryRevision`、`summaryStale` 见上 |
| `status()` / `story_status` | 每章带 `hasSummary`、`summaryRevision`、`summaryStale` |
| `story_next` | missing 或 stale 都返回 `story_summarize`；reason 分别写“没有摘要”/“摘要针对旧版本 rN”；`missing:['summary']` |
| `story_delegate(role=summarizer)` | current → `summary-exists`；missing/stale 允许；落盘覆盖并绑定当前 revision |
| `story_state` / `foldState` | missing → `summary-required`；stale → `summary-stale`；章节与状态不变 |
| `story_brief` 的 `recentSummaries` 与 `previous` | 只取 current；stale 跳过，`previous` 回退到上一章正文结尾 |
| `story_context` 的 `recent` | 只取 current；stale 跳过 |
| `story_read(summary)` | 仍返回摘要文本（含 stale）；不新增 stale 字段 |
| 导出 | manifest v3（v2 字段 + 素材元数据）；摘要文件取当前文本（即使 stale）；章节字段 `null`/`false` 如上 |
| 搜索 | stale 摘要仍留在 FTS；不做投影变更，`readWork`/next 负责标记 |

`summary-stale` 是新增错误码；`story_summarize` 与 `story_delegate` 不因 stale 失败，只有 current 拒绝委派。

### 5. 面板

- `summaryStale === true`：章节行/详情显示「摘要过期」徽标；摘要按钮文案「重写摘要」；
- `summaryStale === false && hasSummary === true`：显示「有摘要」；
- 摘要按钮固定指令的**流程不变**（仍先 `story_next`），文案把“摘要已存在”扩为“摘要已存在、已过期或当前阶段不需要摘要”，避免 stale 被误报为已存在；E2E 断言新文案；
- 定稿按钮的 `hasSummary !== true` 分支继续禁用，tooltip 在 stale 时写「摘要过期：先重写摘要，再定稿」；
- 不自动发送，不改变确认按钮行为。

### 6. 失败与降级

- **迁移成功**：正常打开；目录 `schema_version` best-effort 更新为 2。
- **迁移失败**：`openWork` 返回 `schema-migration-failed`（带原因），库保持 v1；`listWorks` 不跳过该作品，返回 `degraded: true`、`schemaVersion`、`migrationError`、`chapters: null`、`writtenChapters: null`、`latestChapter: null`、`openProblems: null`，`updatedAt` 取目录行的 `updated_at`；面板显示「需升级/升级失败」并禁用该作品的动作，不静默消失；`readWork` / `status` / 其他动作继续返回 `schema-migration-failed`，下次打开重试迁移。
- **列表遇到 `work-busy`**：`listWorks` 返回同一降级行，`migrationError.code = 'work-busy'`、`retryable: true`；面板提示「库忙，稍后重试」，不把作品从列表删掉。
- **读取旧库**：不做 v1 兼容查询；未迁移库不提供摘要读取，避免两套 SQL 与半迁移状态。
- **并发**：迁移事务内重读版本并跳过已升级库；`SQLITE_BUSY` 返回 `work-busy`（可重试），不包装成迁移失败、不吞错。

### 7. 文档与测试

- README / 技能 / role notes：`summary-exists` 改为“当前版本已有摘要”；新增 `summary-stale`；`client.js` 摘要固定指令与技能里的“摘要已存在”文案同步；面板徽标/按钮标签同步。
- `migration.test.mjs`：v1 fixture（建库后 `ALTER TABLE summaries DROP COLUMN revision` 并 `PRAGMA user_version=1`）→ `openWork` 后列存在、回填等于 current、其他表不变；重复打开不重复迁移；半迁移态（列存在、版本 1）只回填 `NULL`；回滚用“v1 库缺 `chapters` 表”让 `UPDATE` 失败，断言列未留下、版本仍 1；版本 99 仍 `schema-version-mismatch`。`node:sqlite` 同步，不驱动进程内并发，用重复打开与半迁移态覆盖幂等。
- `store-chapter.test.mjs`：写入绑定 revision；改正文后 stale；重新摘要 current；`ifAbsent` 对 stale 允许、对 current 拒绝。
- `store-db.test.mjs`：`nextStep` 对 stale 返回 summarize 且 reason 含旧 revision；`readWork` / `status` 字段；`delegateOf` 对 stale 广告 summarizer；`storage.test` 的直调 `foldState`“无摘要 + 未审稿 → `review-required`”不变；`tools.test` 的 `story_state` 早期检查保持 `summary-required`，再补“审稿已过 + 无摘要/过期 → foldState 事务内拒绝”的用例。
- `tools.test.mjs`：`foldState` / `story_state` 在审稿/阶段已通过时对 missing/stale 分别返回 `summary-required` / `summary-stale`，且状态不变；`status()` payload 含 `hasSummary` / `summaryRevision` / `summaryStale`（无 output schema 变更）。
- `bible.test.mjs` / `context.test.mjs`：brief 的 `recentSummaries` 与 `previous`、context 的 `recent` 均不含 stale；回退正文结尾。
- `export-backup.test.mjs`：manifest v3、`summaryRevision`/`summaryStale`、无摘要章节为 `null`/`false`。
- E2E：过期徽标/「重写摘要」/定稿 tooltip；摘要按钮固定指令含“已存在、已过期或当前阶段不需要摘要”；不自动发送。
- 真实单章：摘要后改正文 → stale → 重新摘要 → 定稿；记录回执与窗口。

## 备选方案

- **独立 `summary_versions` 表**：保留每版摘要，可回读历史；需要新表、UI/导出/读取切换与更多迁移；否决。
- **摘要文本里嵌 revision / 内容哈希**：不动 schema，但解析文本、400 字上限与截断会污染摘要；否决。
- **改正文时删除摘要**：过期状态最简单，但丢失可读文本，brief 立刻失去前情；否决。
- **旧摘要回填 NULL / 全部视为过期**：更保守，但所有旧作品摘要一次性失效、recent 回退正文结尾；否决，改为按当前版本回填并记录限制。
- **显式 `story_migrate` 动作**：给作者控制权，但增加第 31 个动作与迁移前置，和“打开即用”冲突；否决。
- **`openWork` 迁移失败后按 v1 只读打开**：需要摘要查询两套 SQL，且 `readWork`/`nextStep` 都要分支；否决，改为 fail-closed + 目录可见错误行。

## 后果

- 摘要现在绑定写入时的 `chapters.current_revision`；改正文后旧摘要变为 stale，`story_next` 会重新要求摘要，`story_state` 拒绝定稿。
- `readWork` / `story_status` 暴露 `hasSummary` / `summaryRevision` / `summaryStale`；面板显示「摘要过期」与「重写摘要」，定稿按钮在无当前摘要时禁用。
- `story_brief` 的 `previous` / `recentSummaries` 与 `story_context` 的 `recent` 只用 current 摘要，stale 回退到正文结尾。
- 迁移是 v1→v2 的加列；旧摘要按当时 current revision 回填，历史已过期但无版本信息的摘要无法追溯。
- 迁移失败的作品仍在目录中显示为降级，动作 fail-closed；`work-busy` 可重试，其他迁移失败返回 `schema-migration-failed`。
- 导出 manifest 升到 3（v2 字段 + 素材元数据），新增 `summaryRevision` / `summaryStale`；模型可见动作回执形状不变。
- 搜索索引仍保留 stale 摘要，只标记不删除。

## 风险

- 旧摘要按当前版本回填会掩盖迁移前已存在的过期摘要；这是无法追溯的历史限制，需在 README/升级说明写明。
- `openWork` 首次打开旧作品会写库；只读挂载或权限不足时迁移失败，作品在目录中标记为升级失败，需换可写位置或先备份。
- 过期摘要从 recent 消失后，若上一章摘要恰好过期，brief 回退到正文结尾，上下文长度会上升；预算裁剪仍按现有规则。
- `summary-stale` 是新增错误码，面板/技能/README 未同步时会被模型当未知错误。
- stale 摘要仍留在 FTS，搜索可能命中过期内容；本项只标记不删索引，后续可按需处理。
- 迁移失败后每次打开都重试；对持续损坏的库会重复失败，错误信息必须包含原因与恢复建议。

## 验证

- `node storycraft/scripts/ci.mjs`：25 个单测文件 + 11 条 E2E 全过。
- 迁移：v1 fixture 加列/回填/幂等/半迁移/回滚/未知版本/内容保持。
- 判定：current → stale → rebind、NULL revision 归 missing、brief `previous`/`recentSummaries` 排除 stale、delegate stale 准入、`foldState` `summary-required` / `summary-stale`。
- 导出：manifest v3 的 `summaryRevision` / `summaryStale`；无摘要为 `null` / `false`。
- 真实第 4 章：reopen → 重写 `r4` 1,203 字 → 清稿审稿 → `story_next` 报“摘要针对旧版本 r2” → `story_delegate(role: summarizer)` 399 字 / 2 次提交 → `story_state` `seq:37` 重新定稿；`story_status` / `readWork` 返回 `summaryRevision: 4`、`summaryStale: false`。

- 交付证据：cddc551 / 30d9be9；25 个单测 + 11 条 E2E；真实第 4 章重写 r4 1,203 字、摘要 399 字 / 2 次提交、summaryRevision 4、summaryStale false
