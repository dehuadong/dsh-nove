---
title: 故事工坊：素材用途与写前筛选
status: implemented
created: 2026-10-22
updated: 2026-10-22
verification: 29 单测 + 13 E2E；真实雪线邮路 v3→v4、setting 进 brief、reference 进 context、清理副本
---

# Agent Note：故事工坊：素材用途与写前筛选

> 2026-10-22 补充（#31）：作品库再升 v5，素材标题并入 FTS；用途/筛选语义不变。

## 问题

B1 的素材已经一作品一库，作者导入的每一份素材天然属于该作品；B2/B4 已能把素材送进 `story_context` 与 `story_brief`。缺的是作者声明“这份素材是设定、人物、场景、文风还是参考”，以及写前只取与正文直接相关的几类。

跨作品绑定表与全局素材库不在本项；那会推翻 B1 的托管副本与作品作用域。

## 决定

### 1. 用途枚举

| 值 | 面板 | 写前 |
| --- | --- | --- |
| `setting` | 设定 | 进 brief |
| `character` | 人物 | 进 brief |
| `scene` | 场景 | 进 brief |
| `style` | 文风 | 不进 brief（文风由固定段承担） |
| `reference` | 参考 | 不进 brief（仍可被 `story_context` 命中） |

默认 `reference`；旧 v3 素材迁移后也是 `reference`。

### 2. 存储与迁移

- `WORK_SCHEMA_VERSION` 3→4；v4 `materials` 增加 `purpose TEXT NOT NULL DEFAULT 'reference' CHECK (purpose IN (...))`；
- 两个形状：`MATERIALS_SCHEMA_V3`（无 purpose，供 v2→v3）与 `MATERIALS_SCHEMA_V4`（最终，供新库）；`WORK_SCHEMA` 用 V4；
- 步骤表：
  - `openWork` 接受 v1/v2/v3；`migrateWorkSchema` 接受 v1–v3；
  - v2→v3：表不存在时建 V3；已存在时只接受 V3 或 V4 列形状；**stamp 3**（不再 stamp 4）；
  - v3→v4：`PRAGMA table_info(materials)` 缺 `purpose` 才 `ALTER TABLE ... ADD COLUMN ... CHECK`；缺表则建 V4；stamp 4；
  - v1/v2 链式经过 v3/v4；迁移失败整事务回滚，旧版本保留；
- `MATERIAL_COLUMNS_V3` / `_V4` 分别对应两个形状；`materialMetadata`、`listMaterials` 带 `purpose`；
- 非法 purpose 在导入/修改时拒绝，码 `material-purpose-invalid`；重复导入（hash 已存在）返回既有行，**不覆盖 title/purpose**，与 B1 一致；要改用途用 purpose 路由；
- 修改/重命名不改内容/哈希；purpose 是单值；`search()` 不过滤。

### 2b. 与既有记录

- **部分替代 B1** [2026-10-21-storycraft-material-ingest.md](../../implemented/pipeline/2026-10-21-storycraft-material-ingest.md)：schema v3→v4、materials 增加 purpose、导出 v3→v4；B1 的导入/管理/托管副本边界不变。
- **部分替代 B4** [2026-10-22-storycraft-brief-retrieval.md](../../implemented/pipeline/2026-10-22-storycraft-brief-retrieval.md)：brief 只取 setting/character/scene；B4 的 3 条/1200/8KB/位置/丢弃规则不变。B4 的“任意匹配素材”AC 由 #30 的用途筛选取代。
- **补充 #16** [2026-10-21-storycraft-retrieval-fts.md](../../implemented/pipeline/2026-10-21-storycraft-retrieval-fts.md)：`searchMemory` 增加 purposes，material 候选可被用途过滤；其余 kind/预算不变。
- **补充 #27/D1** [2026-10-21-storycraft-panel-export.md](../../implemented/pipeline/2026-10-21-storycraft-panel-export.md)：导出 manifest v4 增加 purpose；面板导出的原子替换不变。
- **补充 #25** [2026-10-21-storycraft-summary-revision-binding.md](../../implemented/pipeline/2026-10-21-storycraft-summary-revision-binding.md)：备份恢复 v3 库时走 v3→v4 迁移；摘要边界不变。
- **补充 #18** [2026-10-19-storycraft-sqlite-store.md](../../implemented/pipeline/2026-10-19-storycraft-sqlite-store.md)：库版本与 manifest 版本文案改 v4；旧 v3 导出/备份边界不变。

### 3. API

- `POST /materials/import` body 增加可选 `purpose`（缺省 `reference`）；
- 新增 `POST /materials/purpose` body `{root, sessionId, workId, id, purpose}`；
- `GET /materials` 返回 `purpose`，可选 `purpose` 查询过滤；非法过滤值返回 `material-purpose-invalid`，省略为全部。
- 所有写路由继续走当前作品校验。

### 4. 检索

- `searchMemory` 增加可选 `purposes`：未知值忽略；空数组只去掉 material，`summary/hook/volume` 不受影响；
- B4 `story_brief` 传 `['setting','character','scene']`；
- `story_context` 不传，保持全部素材；
- 用途筛选在 material 候选映射后执行；未知值忽略；过滤后为空只去掉 material，不误放行。

### 5. 面板

- 导入按钮旁加用途选择（默认参考）；
- 每行素材显示用途，可就地改；
- 列表顶部按用途筛选（全部/设定/人物/场景/文风/参考）；
- 导入/改用途后刷新列表；不改 composer。

### 6. 导出

- `EXPORT_SCHEMA_VERSION` 独立常量 3→4；on-disk v3 导出保持有效，不自动改写；从 v3 备份恢复走 v3→v4 迁移；
- `materials[]` 增加 `purpose`；
- 素材文件路径/内容不变；
- 旧 v3 导出不再生成；#18 的导出说明更新为 v4。

## 备选方案

- **全局素材库 + 绑定表**：跨作品共享，但推翻 B1 的作品作用域与托管副本；否决。
- **用途只做标签，不影响 brief**：作者仍需手动筛选；否决。
- **用 LLM 推断用途**：不可控、增加成本；否决。
- **把 style 也送进 brief**：与固定文风段重复；否决。
- **不升 schema，把 purpose 写进 JSON 元数据**：查询/过滤/迁移都变复杂；否决。

## 后果

产品验收在 #30；本 Note 检查技术性质：

1. v3→v4 迁移成功，旧行 `reference`；v1/v2 链式迁移；失败回滚。
2. 导入/修改 purpose 校验、默认值、非法码；内容/哈希不变。
3. `listMaterials(purpose)`、`searchMemory({purposes})` 过滤正确；`story_context` 不受影响。
4. `story_brief` 只取 setting/character/scene；B4 的 3 条/1200/8KB 规则不变。
5. 导出 v4 含 purpose；旧导出测试更新；备份/恢复仍完整。
6. 面板导入/改用途/筛选；E2E 不新增会话指令。
7. 真实 `雪线邮路` 第 4 章（已结算，只读，已写 ≥3 章且章纲能词法命中素材）：setting 进 brief、reference 不进 brief 但进 context；清理库行 + `.storycraft/materials` 副本。
8. B4 的 `bible.test` 素材显式 purpose=setting/character/scene；旧作品素材默认 reference 后 brief 会少一段，README 说明。
9. `search()` 保持不过滤；rename 保留 purpose；perf 仍 ≤400ms。

## 风险

- schema v4 让所有作品首次打开迁移；迁移失败需保留 v3 与旧数据。
- 旧素材默认参考，作者会感觉“导入了却不进 brief”；README 要说明用途语义。
- 用途是单值，不能一文多用；需要多用途时另立标签。
- 导出 v4 改变外部消费者；本项按版本号显式升级。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- 迁移：v1/v2→v4、v3→v4（purpose 默认 reference）、坏表拒绝、失败回滚。
- `material.test`：默认/显式用途、非法用途、空用途、重复导入保留原用途、列表筛选、searchMemory purposes、重命名/删除。
- `bible.test`：brief 只取 setting/character/scene；reference 在候选层被排除（candidateCount 4）。
- `export-backup.test`：manifest v4 带 purpose。
- E2E：导入选用途、列表按用途筛选、行内改用途。
- 真实 `雪线邮路`：v3→v4；setting 进 brief、reference 只进 context；删除后 0 行，副本已清理。
