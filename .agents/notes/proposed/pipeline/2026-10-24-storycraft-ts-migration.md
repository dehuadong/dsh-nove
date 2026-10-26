---
title: 故事工坊：TypeScript 迁移计划（分阶段）
status: proposed
created: 2026-10-24
updated: 2026-10-26
---

# Agent Note：故事工坊：TypeScript 迁移计划（分阶段）

## 问题

故事工坊目前几乎全是 JS + JSDoc，只有 `scope` 是 TS（`src/scope.ts` → `dist/scope.js`）。要决定：

- 是否、以及怎样把 Host 代码迁到 TypeScript；
- 怎样在不改变 DSH 加载契约、动作行为、产物合同的前提下分批迁移；
- Client 是否/何时迁移。

全仓改名 `*.js` → `*.ts` 一次切换不可接受：35 个 Host 模块、166KB 的 `store-db`、137KB 的 `client`，一次切换无法定位回归，也无法逐阶段验收。

## 对拍参考

- `inkos-master` 是 TypeScript 项目：`tsconfig.json` 的 `rootDir: src`、`outDir: dist`；`packages/core/src/*.ts`；`package.json` 的 `build: pnpm -r build`。
- 只参考其**能力实现方式**：开发写 TS、构建出 JS、运行/安装用 JS 产物。
- 不采纳其目录结构、monorepo、tsdown/vitest 或包划分；故事工坊是单个 DSH 插件包，结构由 DSH 的加载契约决定。
- Client 的 browser bundle 也按 DSH 的 `__ModuleLoader__` 单文件入口处理，不照搬参考工程的 browser 构建。

## 提案

### 1. DSH 约束下的结构

结构不是照搬 `inkos-master`，而是由 DSH 决定：

- 单个插件包，没有 monorepo；Cordis 按包名加载 Host 入口；
- DSH Client 通过 `__ModuleLoader__` 加载单文件 `client.js`，不能用 tsc 直接产出多模块；
- 当前 package 的 `exports` 和 `dsh.bundle.patch` 已固定入口，迁移期间要保持可加载；
- 因此采用 `src/*.ts` → `dist/*.js`；入口模块（`index`、`tools`、`skills`、`client`）迁到 TS 的当层改写 `exports` 目标，迁完后包根不再有 JS。

采用 `src/*.ts` → `dist/*.js`：

- 源文件：`src/<module>.ts`，镜像现有根模块名；
- 产物：`dist/<module>.js`，`dist/` 被 gitignore，不提交；
- 迁移一个模块时，所有消费者把 `./<module>.js` 改为 `./dist/<module>.js`（JS/TS 都可 import dist）；
- TS 模块之间 import `./<module>.js`：源内解析到 `src/<module>.ts`，编译后解析到 `dist/<module>.js`；
- 不建根级 shim/转发文件；一个模块只有一个实现；
- `npm run build` 用本地 `typescript`（Host）与本地 `esbuild`（Client），`prepack` 自动构建。

不在本计划：把 `dist` 提交、`allowJs` 混编、根入口 `index.js` 直接改名。

### 2. 类型来源

- Host 模块没有直接 `@deepseek-ai/*` import，DSH API 通过 `ctx`/`exec` 参数进入；
- T3 前建 `types/dsh.d.ts`，只声明故事工坊实际使用的 Context/Exec/Agent/Subagent 面，不引入整个 DSH 包依赖；本地声明要显式纳入 `tsconfig.json` 的 `include`，否则不参与编译；
- 如果后续 DSH 提供稳定 `.d.ts`，替换本地声明，删除 shim；
- Client 的 React 类型在 T4 用 `@types/react` devDependency，不进安装包。

### 3. 迁移层

按依赖 DAG，不按文件数：

| 层 | 模块 | 说明 |
| --- | --- | --- |
| L0 | `scope` + build/prepack/CI | 已完成；作为后续层的构建基线 |
| L1 | `domain`、`chapter-edit`、`search-text`、`critique`、`materials`、`current`、`epub` | 只依赖 Node/domain；先建立类型与测试基线 |
| L2 | `db`、`artifact-contract`、`search-index`、`style`、`revision`、`state-projection` | 数据/规则叶子 |
| L3 | `store-db`、`artifact-store`、`storage`、`retrieval`、`volumes` | 中心存储与查询；`store-db` 单独一批 |
| L4 | `bible`、`facts`、`landing`、`consistency`、`context`、`role-input`、`submission`、`proposals`、`state-check`、`state-settle`、`delegate`、`tools`、`index` | 角色/状态消费与 DSH 接缝；`consistency`/`proposals` 是 `landing`/`tools` 的编译边界 |
| L4b | `skills` | 技能 provider 入口；迁到 `dist/` 后包内 `skills/` 目录基准上跳一级，`exports` 的 `./skills` 当层改指 dist |
| L5 | `client` | 浏览器入口；esbuild 单文件转译，`exports` 的 `./client` 指 `dist/client.js`，包根不再有 JS |

每层完成后：`ci --no-e2e`、pack-check、tarball 安装 smoke 全过；下一层才开始。

### 4. 测试与 CI

- 迁移模块的测试 import `../dist/<module>.js`；
- `ci.mjs` 先 build，再跑测试/pack；
- 每层新增类型/行为断言，不减少已有单元文件（当前 51 个）；
- 面板 harness 也读编译产物：fixture 与 spec 用 `../dist/<module>.js`；`files` 不再含 `*.js` glob，`dist/` 整体复制进临时 profile。只跑 `ci --no-e2e` 时这条链路不会暴露。

### 5. Client（L5）

- `client.js` 不是 ESM，是 `__ModuleLoader__` 单文件；不能直接 `tsc`；
- 采用 esbuild **只转译不打包**：`src/client.ts` 是单文件脚本，esbuild 擦除类型后写到 `dist/client.js`，`window.__ModuleLoader__.load({ factory(require) })` 外壳与 `require('react')` 原样保留。打包（`--bundle`）会把宿主提供的 `require` 当成待解析依赖，反而破坏加载契约；
- 类型检查走独立的 `tsconfig.client.json`（DOM lib、`noEmit`），不进 Host 的 `tsconfig.json`；React 类型来自 `@types/react` devDependency，加载器与注入面声明在 `types/client.d.ts`；
- 构建是 `scripts/build.mjs`：先 Host `tsc`，再 Client esbuild；`prepack` 与 `ci.mjs` 都走它，`ci.mjs` 另跑一次 Client 类型检查；
- 验收：浏览器加载、面板 E2E、无运行时差异（同一 esbuild 参数编译 HEAD 的源码作为参照，产物 token 流一致）。

### 6. 分支与交付

- 所有层在同一个分支 `plan/ts-migration` 上连续开发，不按层开新分支或 PR；
- 每层形成独立 commit，便于按层审阅/回退；
- 回退按 commit 处理，dist 重新构建。

## 备选方案

- **一次全仓 rename**：回归面太大；否决。
- **`allowJs` + `checkJs` 混编**：无法保证 TS 模块边界，类型收益低；否决。
- **根 shim 保留旧 import**：每个模块多一个转发文件，长期维护噪音；否决。
- **只迁叶子模块不迁 store-db/tools**：类型收益停在边缘；不作为终点。
- **Client 与 Host 同批**：构建模型不同（esbuild vs tsc）；否决。

## 验收条件

1. 每层模块只有 TS 源，`dist` 由构建生成，仓库不提交；
2. 每层 `ci --no-e2e`、pack-check、tarball 安装 smoke 通过；
3. 行为/工具 schema/产物合同无变化；
4. 迁移后无同一实现的 JS+TS 双份；
5. L4 后 `index.js`/`tools.js` 的 DSH 入口仍可加载；
6. T4 Client 独立验收，不阻塞 Host 层。

## 风险

- `store-db` 166KB，类型化 SQLite 行与动态 SQL 成本高；单独一批，允许 `unknown` 边界。
- DSH `ctx`/`exec` 没有公开类型；本地声明可能与运行时漂移，需 T3 真实构造验证。
- 每层 import 路径改动会碰很多 JS 文件；用 grep + 测试锁定，不做批量正则盲改。
- `dist` 不提交意味着 `link:` 开发必须先 build；文档和脚本要写清。
- Client 单文件 137KB，拆 TS 模块后 esbuild 产物可能改变加载时序；T4 单独验收。
