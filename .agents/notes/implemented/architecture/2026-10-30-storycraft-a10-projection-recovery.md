# Agent Note: A10 状态投影与恢复

Status: implemented

## Problem

长篇作品的状态是 `state` 事件日志的派生投影：当前事实、未解伏笔与章摘要索引不落独立投影表，读时由 `projectState(events)` 与 artifacts 重算。这带来两个空白：

1. **没有可执行的健康检查与索引重建**：`search_docs` 只在写路径增量同步；索引损坏或历史遗留缺行时，没有从 chapters/summaries/events 等来源重建的入口。`reconcileWorks` 只对账 catalog 与文件，不检查索引、WAL 与残留临时目录。
2. **崩溃与损坏的边界没有表达**：SQLite WAL 已能回到最近一次提交，`openDatabase` 也把 `SQLITE_BUSY` / `SQLITE_NOTADB` 映射为 `work-busy` / `db-corrupt`，但 `db-corrupt` 没有 `next`，也没有“先扫描、再决定是否用备份恢复”的路径；作者只能看到错误。

`#4` 的 A10 行因此标为“部分实现：`state/events` + SQLite 状态投影；崩溃恢复到最近提交未做”。

## Decision

### 动作分类（按 #77）

| 动作 | 类别 | 入口 | 变更 |
| --- | --- | --- | --- |
| `story_recover scan` | 只读 | 主会话工具 | 不写内容/catalog/索引；打开库时可能回放 WAL |
| 重建索引 | 作者面板操作 | 备份页「重建索引」→ `/api/see-storycraft/recover/rebuild-index` | 只重建派生索引 |
| 备份恢复 | 作者面板操作 | 现有 `restoreBackup` | 作者显式选 `backupId` |

两者都不进入状态卡；`scan` 不改变阶段，重建索引不改变正文/事件/artifacts。

### `story_recover scan`

`story_recover` 只有 `scan`，参数：

- `workspace: true`：工作区级扫描；`work` 必须省略，同时给两者返回 `recover-arguments-invalid`；
- `work`（可选）：作品级扫描；显式 `work` 仍受“本会话当前作品”约束，跨作品返回 `work-mismatch`；
- 两者都不给：由会话当前作品决定，没有当前作品则 `work-not-selected`。

因此 `story_recover` 需要像 `story_current` 一样豁免 `withCurrentWork` 的自动解析，在 `execute` 内自行解析；不能把“可选 work”留给包装器，否则 workspace 模式不可达。

扫描范围：

- 工作区级：`catalog-missing`、`db-missing`、`orphan-db`、`stale-session`、`export-temp`、`backup-temp`；只读 catalog 与目录元数据，不读其它作品内容表；
- 作品级：`db-missing`、`integrity-failed`、`search-index-missing`、`search-index-drift`、`search-fts-corrupt`、`busy`；不跨作品读内容。

`scan` 直接查询 catalog（`openCatalog({ create: false })`），不复用会写 `missing_at` 的 `reconcileWorks`。损坏库把 `db-corrupt` 作为 issue 返回，不把同一个错误再抛给调用方；`work-busy` 同样作为 `busy` 报告。扫描的逐 kind 对比只覆盖已知 kind；未知 kind 只进入 `unknownKinds` 信息，不参与 drift 判定，重建时保留。

`wal-present` 只作 informational 字段，不进入 `issues`：SQLite 每次打开都可能留下 `-wal` / `-shm`，它不是问题。

临时/孤儿文件必须排除点号开头的 staging：`.work-restore-*`、`.safety-*`、`.corrupt-*`、`.tmp-*` 只作为 `staging` 信息，不计入 `orphan-db`。

### 重建索引（面板）

重建只在面板「备份」页触发；宿主 route 在一个事务内完成：

1. 删除下列已知 kind 的 `search_docs` 行；未知 kind 保留；
2. 按写路径的 `docId` / `source` / body 重新插入；
3. `INSERT INTO search_fts(search_fts) VALUES('rebuild')`，从 `search_docs` 重建 external-content FTS；
4. 返回每类计数。

| kind | docId | source | body |
| --- | --- | --- | --- |
| `chapter` | `chapter:<n>:r<r>` | `chapters/ch-<nnnn>` | 当前 revision 正文 |
| `summary` | `summary:<n>` | `summaries/ch-<nnnn>` | `summarySearchText` |
| `fact` / `hook` | `event:<seq>` | `state/events` | event payload JSON（`settle` 标记不索引，与写路径一致） |
| `volume` | `volume:<id>` | `volumes` | `title + summary` |
| `material` | `material:<id>` | `materials/<id>` | body 为 content；索引文本用 `materialIndexText(title, content)` |
| `outline` | `outline` | `outline/plan` | 仅 `meta.outline_written_at` 非空时索引 |
| `world` / `style` / `intent` | `bible:<name>` | `bible/<name>` | truth content |
| `current_focus` | `bible:current_focus` | `foundation/current_focus` | focus 文本 |
| `story_frame` / `volume_map` / `book_rules` | 对应 artifactId | `foundation/<name>` | 渲染文本 |
| `role_index` | 对应 artifactId | `foundation/roles/index` | 渲染文本 |
| `role_card` | `role:<slug>` | `foundation/roles/<slug>` | markdown 或 JSON |
| `card` | `card:characters` | `bible/characters` | characters JSON |
| `state_draft` | `state:draft:<n>:r<r>` | `state/draft/<n>` | draft JSON |

`event` 不是 kind；事件按它们的 kind（`fact`/`hook`）索引，`settle` 标记、`reopen`/`chapter-edit` 不索引。检索过滤 `MEMORY_KINDS`，重建必须写这些字面量，不能写笼统的 `event`/`bible`。

扫描同时用 `search_fts('integrity-check')` 捕获“行数对但 FTS 损坏”的情况；这也会暴露 `deleteChapter` 现有只删 `search_docs` 不删 FTS 的问题，修复它作为本项范围内的一致性修正。

### 恢复边界

- **崩溃**：依赖 SQLite WAL；已提交事务保留，未提交事务在重开时回滚，不引入应用层 journal。`scan` 以读写方式打开以允许 WAL 回放，但只承诺不修改内容/catalog/索引。
- **损坏**：`db-corrupt` 带 `next`，写明“让作者在备份页选择一个备份恢复；可先跑 `story_recover` 查看扫描结果”。不自动挑选最新备份，不自动覆盖。
- 状态投影不落缓存表：`scan` 报告 `projection: event-log`，重建只针对检索索引。

## 对拍参考

参考实现 `inkos-master` 采用文件状态与逐章快照：

- `packages/core/src/state/manager.ts:495-655`：`snapshotStateAt` 把 `current_state.md` / `pending_hooks.md` / `chapter_summaries.md` / `story/state/*` 写入 `story/snapshots/<n>`，`rollbackToChapter` 用快照恢复并删除后续章节；
- `packages/core/src/utils/atomic-file-set.ts:68-104`：按 journal 的 `prepared` 状态回滚死进程留下的文件集；
- `packages/core/src/utils/memory-retrieval.ts:78`：明确 SQLite 是“rebuildable projection”；
- `packages/core/src/state/manager.ts:35-53`：`BOOK_BUSY` 与 stale lock 的自动回收。

我们的存储是单文件 SQLite + 事件日志，不是多文件目录；因此不照搬逐章快照与文件 journal，只采纳“可重建检索投影 + 显式恢复 + 失败可诊断”。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 逐章状态快照，可回滚到任意章 | SQLite WAL 回到最近提交；显式备份恢复 | 单文件事务已保证崩溃一致性；事件日志要求单调，不提供任意回滚 | 不采用 | 崩溃子进程测试、restoreBackup 测试 |
| 文件集 journal 恢复 | 不引入文件 journal | 正文/状态/索引同库，无跨文件事务 | 不采用 | `sqlite_master` 与 WAL 测试 |
| 文件锁 + stale lock 回收 | `busy_timeout` + `work-busy` / `retryable` | 无锁文件；SQLite 锁随进程释放 | 等价适配 | `work-busy` 错误测试 |
| SQLite 为可重建投影 | 面板 `rebuild-index` 从源表/artifacts 重建 `search_docs` + FTS | 与参考同向，且现有写路径缺少全量重建 | 采纳 | 删除索引后重建命中恢复 |
| 逐章快照提供“可恢复点” | 备份面板 + `backupId` 显式恢复 | 不自动覆盖作者数据 | 等价适配 | 备份/恢复同 #50 E |

## Alternatives considered

**A. 按参考实现引入逐章快照与任意章节回滚。** 最强的理由是恢复粒度最细，章节删除/审稿拒绝可直接回滚到上一章。否决原因：正文、状态、索引已经在同一 SQLite 事务里，快照会复制一份权威数据并引入“快照与 events 谁为准”的第二权威；任意回滚还会破坏事件日志的单调语义。

**B. `db-corrupt` 时自动恢复最近备份。** 最强的理由是一键恢复、作者无感。否决原因：备份可能落后于最近提交，自动覆盖会静默丢稿；恢复必须由作者看到候选备份后显式选择。

**C. 把 state/facts/hooks 物化成投影表，读时直接查。** 最强的理由是读路径更快，且可校验投影。否决原因：当前投影是纯函数、读时重算，事件日志是唯一权威；引入投影表会多一份可腐化状态。性能问题归 F13。

**D. `rebuild-index` 做成模型工具。** 最强的理由是代理可在扫描后自动修复。否决原因：`#77` 把派生数据的维护归作者面板操作；模型工具会把“修复索引”变成隐式写动作，且 `mutates` 会让子代理也能触发。保留 `scan` 给模型，重建交给作者。

## Testing

- `storycraft/tests/recover.test.mjs`：干净作品/工作区、索引缺行、重建后 FTS 命中、未知 kind 保留、material body 与索引文本分离、新作品默认 outline 不误报、缺 DB、孤儿库、stale session、export 残留、子进程事务未提交退出后 integrity 与已提交数据、未提交行不存在。
- `storycraft/tests/tools.test.mjs`：35 个动作、`story_recover` 的 workspace/work 模式与 `recover-arguments-invalid` / `work-mismatch`。
- `storycraft/e2e/workbench.spec.cjs`：备份页「重建检索索引」按钮与提示。
- 全量 `node storycraft/scripts/ci.mjs`：82 单元 + 28 E2E。

## Consequences

- 索引损坏或历史缺行可由作者一键重建；`scan` 只报告，不自动修复或恢复，避免静默丢稿。
- 重建只覆盖已知 kind，未知投影保留；`deleteChapter` 同步删除 FTS 行，修复了原有 stale-index。
- `writeBible` 不再为空 characters 建立检索文档，保持新建作品的索引与来源计数一致。
- 崩溃仍由 SQLite WAL 处理；没有逐章快照与任意回滚，恢复粒度是最近提交或作者选定的备份。
- `integrity_check` 只在显式 `scan` 触发，不增加日常打开成本。
