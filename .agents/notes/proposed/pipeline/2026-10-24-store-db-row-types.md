---
title: 故事工坊：store-db SQLite 行类型
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：store-db SQLite 行类型

## 问题

`src/store-db.ts` 已从 JS 迁到 TS，但文件头是 `// @ts-nocheck`：

- 3709 行、133 个函数，`prepare/get/all/run` 的返回全是 `Record<string, SQLOutputValue>` 或 `any`；
- 表结构在 `src/db.ts`，行形状只存在于 SQL 和调用方；
- L3 的“SQLite 行类型”验收未达成，L4 的 DSH 类型缝没有稳定数据缝。

目标：去掉 `@ts-nocheck`，让行类型成为 store 的显式边界，行为/SQL 不变。

## 对拍参考

- `inkos-master/packages/core/src/play/play-db.ts` 为 `EntityRow`、`EdgeRow`、`StateSlotRow`、`EventRow` 定义 interface，查询返回按行类型消费；
- `inkos-master/packages/core/src/models/runtime-state.ts` 用 zod schema 定义 `ChapterSummaryRow` 并导出 `z.infer` 类型；
- 参考工程用 `node:sqlite` 的 `DatabaseSync`，与我们的连接方式一致。

采纳：**行 interface + 查询边界 cast**；不引入 zod 依赖，不复制其表名/字段。参考的 schema 校验留在 artifact-contract，store 只负责行形状。

## 提案

### 1. 行类型文件

新增 `src/store-rows.ts`，只放类型，不放 SQL/运行时逻辑：

- 目录库：`WorkRow`、`ProposalRow`、`SessionCurrentRow`；
- 作品库：`MetaRow`、`ChapterRow`、`ChapterVersionRow`、`EventRow`、`VolumeRow`、`BibleRow`、`ArtifactRow`、`MaterialRow`、`SearchDocRow`；
- 每列与 `src/db.ts` 的 schema 一一对应；可空列用 `| null`，不把 `null` 混进 `undefined`；
- JSON 列保持 `string`，解析仍在调用方/artifact 层，不在行类型里假装已解析。

### 2. 查询边界

在 store-db 内用局部 helper 收窄：

```ts
const row = db.prepare(sql).get(id) as WorkRow | undefined
const rows = db.prepare(sql).all() as ChapterRow[]
```

`unknown`/`SQLOutputValue` 只在 helper 内出现；业务函数签名用行类型或明确的输入 interface。避免把 `Record<string, SQLOutputValue>` 泄到导出函数。

### 3. 迁移顺序（同一分支）

| 阶段 | 范围 | 门 |
| --- | --- | --- |
| P0 | 建 `store-rows.ts`；给只读路径加行类型（readManifest/readChapter/listWorks/listTrash/readVolumes/readBible/readArtifact/listArtifacts/search） | `tsc` + 50 单元；`@ts-nocheck` 仍在 |
| P1 | 写路径与事务：init/move/trash/backup/chapter write/revision/summary/settle/export | 事务/导出/迁移测试 |
| P2 | 移除 `@ts-nocheck`，修正剩余隐式 any；导出类型给 L4 | 严格编译 + 全 CI + 安装 smoke |
| P3 | 删除重复 JSDoc 类型，README/Note 更新 | docs 检查 |

P2 拆分（2026-10-24，按第一次去 `@ts-nocheck` 的 130 个错误）：

| 子阶段 | 范围 | 门 |
| --- | --- | --- |
| P2a 边界与可空 | `asRow`/`asRows`/`requireCatalog` 集中 cast；catalog 可空；`SQLOutputValue`→string/number；`prepare().run` 多参数；catch unknown、`error.code` | `ci --no-e2e`；nocheck 仍在 |
| P2b 行投影与输入 | `MaterialRow` 局部 SELECT、`BibleRow` spread、chapter version/volume/event 投影、`WriteSummaryInput`/`ReviseChapterInput`/state options 字段 | 事务/导出/材料测试；nocheck 仍在 |
| P2c 去 nocheck | 移除 `@ts-nocheck`，修剩余严格错误 | 严格 tsc + 50 单元 + pack-check + 安装 smoke |

P2a/P2b 期间 `@ts-nocheck` 仍在，类型修正不能靠编译器全量验证；P2c 是唯一完成门槛，必须在同一分支连续完成，不能停在 P2a/P2b。

P0/P1 期间 `@ts-nocheck` 不能作为最终状态；P2 是完成门槛。

### 4. 非目标

- 改 SQL、表结构或事务边界；
- 引入 ORM/查询构建器；
- 给 JSON 列做运行时 schema（artifact-contract 已有）；
- 数据迁移/兼容。

## 备选方案

- **zod schema 生成行类型**：多一个依赖，且 store 只需读形状；否决，保留 interface。
- **`any` 标注全部函数**：编译能过但没有行边界；否决。
- **拆 store-db 成多模块再类型化**：行为风险与 import 迁移大；本工作项只做类型，不拆。
- **继续 `@ts-nocheck`**：L4 无数据缝；否决。

## 验收条件

1. `src/store-db.ts` 无 `@ts-nocheck`，`tsc` 严格通过；
2. `src/store-rows.ts` 覆盖所有表，列名/可空性与 schema 一致；
3. `prepare/get/all/run` 的返回值在业务函数处有行类型或明确标量类型；
4. 50 单元、pack-check、tarball 安装 smoke 通过；
5. 无 SQL/行为差异；diff 只含类型、cast、import 与注释。

## 风险

- 3709 行、133 函数，一次性去 `@ts-nocheck` 会产生大量改动；按 P0/P1 分段，P2 集中收口。
- 行类型与 schema 漂移：在 `store-rows.ts` 顶部注明对应 `WORK_SCHEMA_VERSION`；schema 变更时同步更新。
- 复杂 JOIN/投影不是完整表行：为投影定义专用 `...View` 类型，不强行套 `WorkRow`。
- `DatabaseSync.get/all` 无泛型：cast 是必要边界，集中 helper，避免散落。
