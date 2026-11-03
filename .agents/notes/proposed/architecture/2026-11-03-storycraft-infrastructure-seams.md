# Agent Note: 故事工坊：基础设施职责拆分（R3）

Status: proposed

工作项：当前任务（不新建 GitHub issue）。把 `store-db.ts`、`tools.ts`、`context.ts` + `bible.ts`、`client.ts` 四个 monolith 拆成存储/领域/阶段机、动作注册、上下文装配与面板子模块；行为、动作名、错误码与产物不变。

## Problem

R0 已定目标结构（`storage/{db,repositories/*}`、`domain/*`、`runtime/stage-machine.ts`、`context/{composer,brief}.ts`、`tools/{registry,actions/*}`），R1/R2 只完成了角色模块与运行时抽取。当前四个文件仍各自承担多种职责：

| 文件 | 规模 | 现在承担 | 目标 |
|---|---|---|---|
| `store-db.ts` | 243 KB / 约 5,350 行、90+ 导出 | 连接、行读写、阶段机、`nextStep`、审批、foundation bundle、计划/章节/审稿/摘要/结算、卷、素材、检索、导出/备份、提案、会话指针 | `storage/db.ts` + `storage/repositories/*` + `domain/*` + `runtime/stage-machine.ts` |
| `tools.ts` | 126 KB / 36 个动作 | 动作注册、输入 schema、执行、面板辅助数据 | `tools/registry.ts` + `tools/actions/*` |
| `context.ts` + `bible.ts` | 32 + 30 KB | 上下文选择/预算/trace、brief 分段、真值读写与校验 | `context/composer.ts` + `context/brief.ts`；真值读写进 `storage/repositories/bible.ts`，校验/渲染进 `domain/bible.ts` |
| `client.ts` | 227 KB | 单模块工厂：类型、API face、样式、面板组件 | 入口只做组装；`client/{api,types,styles}.ts` + `client/panels/*` |

R0b 把 `context-budget-trace`、`worker-skills` 标为 R3 的 `rework-required`；`store-db-row-types`（proposed）是同一文件上的类型缝。

### 范围

- 纯结构搬迁：不新增/删除动作，不改 payload、错误码、回执、产物字段与提示词；
- `store-db-row-types` 的类型缝并入 R3a（去掉 `@ts-nocheck`，行类型成为存储边界）；
- `context-budget-trace` 的行为（token 预算、trace 字段与落盘时机）保持不变，只换模块归属；
- `worker-skills` 只做「技能加载与角色模块对齐」的复核，不改技能内容（内容差距归 R4）。

不做的：不改阶段机判定、不引入 ORM/查询构建器、不拆 `index.ts` 的 HTTP 路由（只更新 import）、不改面板行为与样式、不做 S/D。

## 对拍参考

- `inkos-master/packages/core/src/state/`：运行状态与投影按文件归位；`pipeline/runner.ts` 负责编排；`agents/` 按角色拆；`models/` 定义行/结构类型。
- `inkos-master/packages/core/src/play/play-db.ts` 与 `models/runtime-state.ts`：行 interface / schema 类型由存储边界导出，查询返回按行类型消费（`store-db-row-types` 已按其结论采纳）。
- `inkos-master/packages/studio/src`：面板按页面/面板拆文件，不是单文件。
- 我们的映射与偏差：

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| 工作区文件为权威，SQLite 是检索投影 | SQLite 是权威；`storage/repositories/*` 是唯一读写面 | 既有架构，R3 不改存储模型 | 等价适配 | 既有存储测试 |
| `state/` 按状态域拆文件 | `storage/repositories/*` 按聚合拆，`storage.ts` 保留为稳定门面 | 调用方一直只依赖门面，拆仓库不破坏这一契约 | 采纳（保留门面） | import 检查 |
| `pipeline/` 拥有阶段推进 | `runtime/stage-machine.ts` 只放 `nextStep`/阶段派生；写操作留在仓库 | 阶段判定与落盘分离，便于测试 | 采纳 | nextStep 测试 |
| `models/` 用 zod | `store-rows.ts` 只放 interface，校验仍在 `artifact-contract` | 不引入依赖，校验已有归属 | 采纳（等价） | 类型检查 |
| `studio` 多文件 React 面板 | `client/panels/*` 接收 `h`/hooks 作为参数，`client.ts` 仍为单入口 | loader 工厂内才有 `require('react')` | 等价适配 | E2E |
| `composer` 独立选择上下文 | `context/composer.ts` 装配 + 预算 + trace；`context/brief.ts` 分段 | 两者输入不同、消费者不同 | 采纳 | context/brief 测试 |

## Proposal

### 1. 目标结构

```text
storycraft/src/
  storage/
    db.ts                     # 由 src/db.ts 迁入：连接、schema、事务
    store-rows.ts             # 行 interface（只类型）
    repositories/
      works.ts                # catalog/manifest/提案/会话指针/回收站
      chapters.ts             # 计划、正文、版本、历史、回滚、重开
      reviews.ts              # 审稿、接受、修订
      summaries.ts            # 摘要与索引
      state.ts                # 事件、草稿、结算、定稿、卷
      foundation.ts           # foundation 文档与 bundle、审批、指纹
      bible.ts                # 真值读写（校验/渲染走 domain/bible）
      materials.ts            # 素材
      search.ts               # FTS/统一检索/记忆检索
      export.ts               # 导出与备份
  domain/
    foundation.ts             # 初始伏笔表格、foundation 内容规则（纯函数）
    chapters.ts               # 字数、版本轮次、审批策略（纯函数）
    state.ts                  # 状态投影与限界（复用 state-projection 的类型）
    bible.ts                  # 真值校验/渲染/角色解析（纯函数）
  runtime/
    stage-machine.ts          # nextStep、foundation 状态派生、审批门
    delegate-runner.ts / child-run.ts / submission.ts / prompt-kit.ts / role-input*.ts
  context/
    composer.ts               # assembleRoleContext：选择、预算、trace
    brief.ts                  # assembleBrief：分段、裁剪、检索段
  tools/
    registry.ts               # action() 注册器与共享输出 schema
    actions/*.ts              # 按域拆的 36 个动作
  client/
    api.ts                    # face、ROUTE、请求封装
    types.ts                  # 面板类型
    styles.ts                 # CSS 常量
    panels/*.ts               # dashboard/workbench/logs/analysis/search/…
  client.ts                   # loader 工厂：组装上述模块
  index.ts                    # HTTP 路由（只更新 import）
  storage.ts                  # 稳定门面：re-export repositories/domain
```

### 2. 存储拆分规则

- `storage.ts` 保留为**唯一对外门面**（现有契约：调用方不关心查询归属）；`store-db.ts` 删除后不得留同名兼容文件；
- 每个 repository 只依赖 `storage/db.ts`、`storage/store-rows.ts`、`domain/*` 与既有的 artifact 写入面；跨聚合读写只能经对方的公开函数（或 `storage.ts` 门面），不得 import 对方私有 helper；
- 依赖方向：`domain`（纯函数）← `storage/repositories` ← `storage.ts` 门面；`runtime/stage-machine` 读仓储/门面，仓储不 import 阶段机；`tools/actions` 与 `context/*` 只经门面/运行时；`client/*` 只依赖 `client/{api,types,styles}`，不 import 服务端模块；
- 事务仍由各写操作在 repository 内用 `transaction(db, ...)` 包裹；跨聚合事务（如按章改号的删除/移动、foundation bundle）留在拥有该不变量的 repository（chapters / foundation）；
- 行类型：`store-rows.ts` 覆盖现有表；查询边界 `as Row | undefined` / `as Row[]`；删除 `@ts-nocheck`，但不为每个 `any` 发明新校验。

### 3. 阶段机与领域

- `runtime/stage-machine.ts`：`nextStep`、`foundationStateOf`/`approval` 派生、`chapterStageOf` 等只读判定；
- 纯函数进 `domain/`：字数与版本、审批策略、foundation 内容/伏笔表格、真值校验/渲染；
- `context.ts`/`bible.ts` 删除：
  - `context/composer.ts` 接 `assembleRoleContext`（预算、trace、检索、技能段）；
  - `context/brief.ts` 接 `assembleBrief`（分段顺序、裁剪、检索段）；
  - `bible.ts` 的读写进 `storage/repositories/bible.ts`，校验/渲染进 `domain/bible.ts`；对外的 `readBible`/`writeBible` 等 async 形状保持不变（`storage.ts` 或门面 re-export）。

### 4. 工具拆分

- `tools/registry.ts` 只放 `action()`、`OUTPUT_PROPERTIES`、共享输出 schema 与注册表装配；
- `tools/actions/<domain>.ts` 按与仓库近似的域拆：work、outline/plan、chapter、review、state、foundation、delegate/submit、read（bible/context/brief）、materials、export/backup、settings/current/recover；
- 每个动作的 name、description、input schema、execute 逐字保留；测试只改 import；
- 面板辅助数据（工作台/日志/分析/自检）若不是动作，随其消费者进 `tools/` 或 `client/`，不在 registry 里堆数据拼装。

### 5. 客户端拆分

- 单入口 `client.ts` 仍是 loader 工厂；`client/*` 子模块不直接 `require('react')`，而是由入口传入 `{ h, React, hooks, face }`；
- 先拆 `types.ts`、`api.ts`（face/ROUTE）、`styles.ts`（CSS 常量），再按面板拆 `panels/*`；
- 渲染结果与 DOM 结构不变，`aria-label`、`data-*` 与按钮文案不改；E2E 是回归网。

### 6. 切片与退出条件

| 切片 | 内容 | 完成标志 |
|---|---|---|
| S1 | `storage/db.ts`、`store-rows.ts`；删 `@ts-nocheck` | 类型检查通过，SQL 未改 |
| S2 | 按聚合建 `storage/repositories/*`，`storage.ts` 改接仓库 | 既有存储/章节/状态测试全绿 |
| S3 | `runtime/stage-machine.ts` + `domain/*` 抽纯函数 | `nextStep`/审批/阶段测试全绿；`store-db.ts` 删除 |
| S4 | `context/composer.ts` + `context/brief.ts` + bible 拆分 | context/brief/技能证据测试全绿；`context.ts`/`bible.ts` 删除 |
| S5 | `tools/registry.ts` + `tools/actions/*` | 36 个动作数量与 schema 快照不变；`tools.ts` 删除 |
| S6 | client 子模块 | 49 条 E2E 全绿；`client.ts` 只剩组装 |
| S7 | 文档与状态、旧文件清零 | `grep` 旧文件名零命中；CI 全绿 |

退出条件：`store-db.ts`、`context.ts`、`bible.ts`、`tools.ts` 不存在；`storage.ts` 是唯一存储门面；行为与回执不变。

### 7. 测试

- 新增 `infrastructure-seams.test.mjs`：目标文件存在、旧文件不存在、`storage.ts` 门面导出关键函数、36 个动作名不变、client 入口仍是 loader 工厂、repository 不 import 其它 repository；
- 既有 96 个单元文件只改 import（`../src/storage.ts` 基本不变，`../src/store-db.ts`/`context.ts` 的测试随路径迁移）；
- E2E 49 条不改选择器与断言；
- `context-budget-trace` 的行为由现有 accounting/trace 测试锁定，R3 不动数字与落盘时机。

## 与既有决定

- [对拍基线重审](2026-11-02-storycraft-parity-rebaseline.md) 的 R3 目标由本项承接；
- [store-db 行类型](2026-10-24-store-db-row-types.md) 的结论并入 S1/S2；实施后转为 implemented 并互链；
- [上下文 token 预算与 trace](../../implemented/architecture/2026-10-26-storycraft-context-budget-trace.md) 只换模块归属，行为不变；R3 完成后按新路径复核该 Note 的「落盘只在派发时」与 trace 字段；
- [R2 角色边界](../../implemented/architecture/2026-11-03-storycraft-role-boundaries.md) 已把角色 payload schema 移出 `submission/tools`，本项继续把动作注册与存储拆开；
- `worker-skills` 只复核技能加载与角色模块的对应关系，不重写技能正文。

## Alternatives considered

**A. 只拆 `store-db.ts`。** 最强理由是风险集中、收益最大。否决原因：R3 的定义是四处；`tools.ts`/`client.ts` 会继续膨胀，S/D 前还得再开一轮。

**B. 两个工作项（数据层 / 动作与面板）。** 最强理由是门禁隔离、client 风险独立。否决原因：同一「纯搬迁、行为冻结」规则立两次，且 tools 的拆分依赖 repositories 的模块边界（动作按域对应仓库）；一个工作项的切片已能逐片复看。

**C. 一次性按目标目录重写。** 最强理由是文件布局一步到位。否决原因：5,350 行 + 36 动作 + 227 KB 客户端一次重排，失败面无法分片定位；违背 R0「过渡期设退出条件」的要求。

**D. 保留 `store-db.ts` 作为 facade。** 最强理由是 import 全不用改。否决原因：它就是第二入口，与退出条件冲突；现有 `storage.ts` 已经是门面，保留它就是重复。

**E. 不拆 client，等面板重设计。** 最强理由是 UI 行为风险高。否决原因：R0 明确列为 R3；且先拆 types/api/styles 即可降低单文件风险，E2E 已覆盖。

## Acceptance criteria

1. `store-db.ts`、`context.ts`、`bible.ts`、`tools.ts` 删除，仓库内无 import；`storage.ts` 是唯一存储门面；
2. `storage/repositories/*` 按聚合覆盖现有全部导出；repository 不得 import 其它仓库的私有 helper，跨聚合只走公开函数或门面；跨聚合事务仍留在拥有该不变量的仓库；
3. `runtime/stage-machine.ts` 持有 `nextStep` 与阶段/审批派生；`domain/*` 只放纯函数与类型；
4. `context/composer.ts` 与 `context/brief.ts` 分别承载 `assembleRoleContext` 与 `assembleBrief`；token 预算、trace 字段、落盘时机不变；
5. `tools/registry.ts` + `tools/actions/*` 承载全部动作，36 个动作名、输入 schema、执行行为逐字不变；
6. client 子模块化后入口仍是 loader 工厂；面板 DOM、文案、`aria-label` 不变；
7. `store-db-row-types` 落地：删除 `@ts-nocheck`，行类型从 `store-rows.ts` 导出；
8. 新增 `infrastructure-seams.test.mjs`；既有 96 单元 + 49 E2E 全绿；`node storycraft/scripts/ci.mjs` 通过；`npm run verify-notes` 通过；
9. 文档：roadmap R3 行、parity-matrix 运行时/角色边界行、`store-db-row-types` 生命周期、context-budget-trace 的路径引用同步；
10. 安装形态：`npm run build`、`npm pack`、`plugin_manager install_bundle` 后安装副本含新目录结构，真实链路不可见行为变化。

## Risks

- 最大风险是搬运中悄悄改行为：以现有 96+49 为回归网，每片后跑 CI；
- `store-db.ts` 的跨聚合不变量（删章/移章重排、foundation bundle、审稿绑版本）容易在拆仓库时被拆散；每个不变量必须落在一个仓库内并保留事务；
- `storage.ts` 门面可能变成 Middle Man：只 re-export，不放逻辑；repository 的公开函数才是实现；
- client 拆模块需要传 `h`/hooks，容易在子模块里误用模块级 React；入口签名固定并靠 E2E 验证；
- `tools/actions` 拆分后 action 数量或 schema 漂移；用快照/计数测试锁定；
- 行类型去掉 `@ts-nocheck` 会暴露大量 `any`；允许逐步收窄，但不得为过检引入虚假校验；
- R3 完成后 R4 仍要重验真实链路，结构通过不等于产品完成。
