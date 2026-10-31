# Agent Note: 故事工坊：E13 自检

Status: implemented

工作项：当前任务 E13（不新建 GitHub issue）。产品范围与验收归本 Note；依赖 A10 已交付。

## Problem

长篇写到中后期后，作者只能靠“下一步”或看板发现问题，看不到底层体检：

- 作品库缺失/损坏/schema 版本不符；
- 检索索引缺失或漂移；
- 章节 `current_revision` 指向的版本行不存在，或正文为空；
- 定稿章的 `state_ready_revision` 与当前版本不一致；
- 状态草案未处理；
- 作品被另一个动作占用。

E13 要求“作品一致性、锁残留、版本缺失的体检”。这些检查都是只读的，不需要模型或新 schema。

## 对拍参考

- `inkos-master/packages/cli/src/commands/doctor.ts:108-170`：`doctor` 是 CLI 环境/模型健康检查；`inkos-master/packages/studio/src/pages/DoctorView.tsx:32-49` 与 `studio/src/api/server.ts:6306-6321` 提供 Studio Doctor 页和 `/doctor` 检查接口（检查项、recheck、pass/fail、workspace/bookCount）。
- 本项目 `src/recovery.ts:193-247` 的 `scanWork` 已有作品库完整性、检索索引与 WAL 扫描；`src/db.ts:520` 有 `integrityCheck`；`src/store-db.ts` 有章节版本/状态投影。
- 参考的 Doctor 是工作区/环境级，本项目是单作品、作者上下文内的只读自检；结构差异登记在偏差表。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| Studio Doctor 是独立工作区页 | 作品看板内折叠段；`/work` 失败时在错误分支仍可运行 | 单作品上下文，且损坏库必须能自检 | 偏差 | E2E |
| CLI doctor 检查环境/模型 | 面板内作品库自检 | 作者在作品上下文里用 | 等价适配 | E2E |
| 检查后给修复提示 | 只读列问题，不自动修复 | 修复已有备份/重建入口，自检不越权 | 收窄 | 单元 |
| 参考 `/doctor` 用工作区/书数 | 单作品一次检查，返回 checked/issues | 入口是作品看板 | 偏差 | 单元 |

## Decision

### 看板内自检段

- 看板“分析”之后增加折叠的“自检”段；不新增主标签；
- 默认折叠，点“运行自检”才请求 `/self-check`；运行中/失败/完成三态；
- 完成后显示检查项数量、error/warning 列表；无问题显示“未发现问题”；
- 只读，不提供自动修复；已有“重建检索索引”“备份恢复”仍走原入口。

### `/self-check`

新增只读 `GET /api/see-storycraft/self-check?root&id`：

- `scanWork` 增加 read-only 打开与 `inspect(db)` 回调：完整性、检索索引缺失/漂移、库缺失/损坏/占用全部在**同一个只读连接**里完成；read-only 时跳过 FTS5 `integrity-check`（它走 xUpdate，只读会误报损坏），FTS 深度检查仍归可写的 `story_recover`；
- 章节检查（`inspect` 内一次 `chapters LEFT JOIN chapter_versions`）：`current_revision > 0` 必须存在对应版本行；正文去空白后不能为空；`stage='settled'` 时 `state_ready_revision` 必须等于 `current_revision`；
- 状态检查：每章最新状态草案 `ready !== true` 时给 warning（已接受待定稿的草案不算未处理）；不做基础设定检查（阶段由 artifact 派生，approved 也由派生状态给出，检查不可达）；
- 打开库失败（`schema-version-mismatch`/`db-corrupt`/`busy`）由共享映射转成 issue，不抛 500；
- 返回 `{ ok, checked, issues:[{code,severity,message,chapter?}] }`；`checked` 表示实际跑过的检查组数（库打不开为 1，正常为 4）；不返回正文；
- 不执行写 SQL（SQLite 只读连接可能创建 `-shm`，不算业务写入）、不调用模型、不改 schema。

### 性能

- 复用 F13 250 章 fixture，`/self-check` DTO 预算 **<1000ms**；
- 章节检查一次 SQL 取 `chapters LEFT JOIN chapter_versions`，不逐章打开数据库；
- `scanWork` 的检索 integrity 是显式运行成本，不在看板首屏执行。

### 客户端

- 抽出独立 `SelfCheckPanel`：正常看板折叠段与 `/work` 失败的错误分支共用；错误分支也能运行自检，不依赖详情加载；
- 作品列表里 `degraded` 作品行不再禁用，点开进入详情错误分支（否则坏库无法到达自检）；
- 自检状态由组件持有，按 `workId` 重置，并用请求计数器丢弃旧作品的迟到响应；
- 每条 issue 显示 code/severity/message，章节问题带“第 N 章”；
- 错误不阻塞看板其他段；失败可重试；
- README 路由表加 `/self-check`。

## Alternatives considered

**A. 独立“自检”标签。** 最强理由是入口清晰。否决原因：七标签已满，E13 是低频诊断，折叠段足够。

**B. 自检后自动修复。** 最强理由是省操作。否决原因：修复涉及重建/恢复/删除，必须保留作者确认与备份；自检只报告。

**C. 全库扫描所有作品。** 最强理由是能发现孤儿库。否决原因：当前入口是作品内诊断；工作区级扫描已有 `scanWorkspace`，不在本次范围。

**D. 把检查做进 `/analysis`。** 最强理由是少一个路由。否决原因：分析是统计，自检是诊断；混在一起会让分析失败拖垮诊断，反之亦然。

## Testing

- `tests/self-check.test.mjs`：正常/空作品、缺当前版本、空正文、定稿 state 不一致、未处理/已接受草案、检索索引缺失、schema 不符、只读不改主库。
- `tests/store-perf.test.mjs`：250 章自检 <1000ms，响应不含正文。
- `e2e/self-check.spec.cjs`：折叠段运行前不请求、正常无问题、草案提醒、详情打不开时错误分支仍可自检并返回全部作品。
- 完整 CI：89 单元 + 40 E2E。

## Consequences

- 自检做来源计数与章节扫描，250 章作品会比看板慢；这是显式运行的低频诊断，不做缓存；
- 章节版本/正文检查只覆盖当前版本，不逐版校验历史；
- 自检发现的问题不一定都能在本面板修复，修复仍走备份/重建；
- 只读连接不跑 FTS5 深度校验，FTS 内部损坏仍由 `story_recover` 的写连接发现。
