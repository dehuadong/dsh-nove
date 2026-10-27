---
title: 故事工坊：源码 TS 约定与入口打包
status: proposed
created: 2026-10-26
updated: 2026-10-26
---

# Agent Note：故事工坊：源码 TS 约定与入口打包

## 问题

Host 现在是 36 个 `src/*.ts`，相对导入写 `./x.js`；构建用 tsc（`module`/`moduleResolution: NodeNext`）逐文件出 `dist/*.js`（37 个文件，specifier 原样保留）；Client 由 esbuild 只转译出 `dist/client.js`；54 个测试与 e2e fixture 直接 import `dist/*.js`。

由此产生的可见差异，作者 2026-10-26 判定为需要修正的问题：

- 源码通篇 `.js` 后缀。这不是笔误：Node ESM 的 specifier 是运行时路径，`NodeNext` 强制如此，并把 `./x.js` 映射回 `./x.ts`；
- 包形态是“37 个内部模块”，而 DSH 官方包与两个参照插件都是“若干入口文件 + 类型声明”；
- 内部模块随 tarball 发布，`import 'dsh-storycraft/dist/storage.js'` 这类深导入事实上可用；
- 包缺 `main`、`license`、`engines`，`private: true`（发布字段由 [发布 Note](2026-10-26-storycraft-release-packaging.md) 拥有，本文只处理构建与入口）。

要决定：源码 specifier 约定、构建工具与产物形状、测试怎样吃源码、包入口怎样声明。

## 对拍参考

- DSH 自有源码：`deepseek-harness/tsconfig.base.json` 开 `moduleResolution: "bundler"`、`allowImportingTsExtensions: true`、`rewriteRelativeImportExtensions: true`；`packages/fs/tool-fs/src/*.ts` 的相对导入写 `./diff.ts`、`./error.ts`、`./mutation-result.ts`（该目录 20 处 `.ts` specifier、0 处无后缀）。
- DSH 已发布包：`packages/fs/tool-fs/package.json` 的 `main: "lib/index.js"`，`files: ["locale/*.json", "lib/index.js", "lib/types/**/*.d.ts"]` —— 入口单文件加类型声明，不发布内部模块。
- `dsh-seework`：`tsdown.config.ts` 两份 config —— Host `src/index.ts` → `lib/index.js`（esm、`dts: false`、宿主共享包用 `external` 保持模块身份），Client `src/client/index.ts` → `lib/client.js`（cjs + `window.__ModuleLoader__.load` banner）；`tsconfig.json` 是 `moduleResolution: "Bundler"` + `noEmit`；`package.json` 给 `main`/`exports`/`files: [lib, assets, cordis.patch.yml, LICENSE, README]` 与 `peerDependencies`。
- `dsh-webnovel-writer`：`tsconfig.base.json` 同为 Bundler + `noEmit`；`packages/bundle` 用 `scripts/bundle.mjs`（esbuild）出 `lib/{index,cli,preset,client}.js`；`package.json` 有 `main`、`exports` 多子路径、`files` 白名单、`engines.node`/`engines.dsh`、`peerDependencies`。
- 采纳：入口打包、`lib/` 产物、`noEmit` 独立类型检查、`files` 白名单。
- 不采纳：两家插件的**无后缀** import 形态。宿主自己写 `.ts`；无后缀会迫使测试改用 vitest（两家都是 vitest）。也不采纳 `dsh-webnovel-writer` 的 monorepo/包划分。

## 提案

本工作不改变产品行为：动作、工具契约、面板与产物合同保持不变。改变的是源码 specifier 约定、构建产物位置与包入口。

### 1. 源码约定

- 相对导入写 `./x.ts`（`allowImportingTsExtensions`）；不设 `rewriteRelativeImportExtensions` —— 它只在 tsc emit 时生效，而我们只用 tsc 做类型检查，设了是死配置；将来要出 `.d.ts` 由打包器负责；
- `module: esnext`、`moduleResolution: bundler`、`noEmit: true`；
- 类型检查独立成命令：`tsc -p tsconfig.json`（Host）、`tsc -p tsconfig.client.json`（Client，已是该形态）。

### 2. 产物

- Host：`tsdown` 三个入口 `index`、`tools`、`skills` → `lib/{index,tools,skills}.js`（esm、`dts: false`、无 `external` —— 包内零外部依赖，宿主服务走动态注册）；共享模块交给打包器切块。
- Client：保留 esbuild `bundle: false` → `lib/client.js`。它是 `window.__ModuleLoader__` 单文件脚本，不是 ESM，进打包器会破坏该契约（`dsh-seework` 也是给 Client 单独一份 config）。
- 多入口共享代码交给打包器切块：`lib/` 内允许出现打包器生成的共享 chunk（命名由工具决定，入口之间用相对 ESM 引用解析）。不要求也不禁止重复内联；验收只约束入口集合与“不出现与 `src` 模块一对一的产物”。
- `dist/` 退役，`.gitignore` 改为 `lib/`。

入口映射（`cordis.patch.yml` 里的 `dsh-storycraft`、`dsh-storycraft/tools`、`dsh-storycraft/skills` 名称全部不变）：

| `exports` | 源入口 | 产物 |
| --- | --- | --- |
| `.` | `src/index.ts` | `lib/index.js` |
| `./client` | `src/client.ts` | `lib/client.js` |
| `./skills` | `src/skills.ts` | `lib/skills.js` |
| `./tools` | `src/tools.ts` | `lib/tools.js` |

### 3. package.json

- `main: "./lib/index.js"`；`exports` 的 `.`、`./client`、`./skills`、`./tools` 全部指向 `lib/`；
- `prepack` 仍先构建；
- `engines.node` 归本文：最低 `>=22.18`，因为测试与 e2e fixture 直接运行 TS 源码、依赖类型擦除；其余发布字段（`private`/`version`/`license`/`repository`/`engines.dsh`）与 `files` 白名单的最终取值归 [发布 Note](2026-10-26-storycraft-release-packaging.md)，本文只要求 `files` 包含 `lib`、不含 `src`/tests/e2e/scripts。

### 4. 测试与 e2e

- 54 个 `tests/*.test.mjs` 的 157 处 `../dist/<module>.js` 改为 `../src/<module>.ts`；runner 不变（自建 `check()`，不是 node:test，也不引入 vitest）；
- `e2e/host.mjs` 的 fixture 与 `e2e/workbench.spec.cjs` 里给探针造数据的地方都改为 import `src/*.ts`：打包后不再有一对一的 `lib/storage.js`，规格只能吃源码；
- 依赖 Node ≥22.18 的运行时类型擦除（本机 24.10、宿主 24.21 已实测静态与动态 import `.ts` 均可用）；版本下限由一个共享的 `scripts/node-version.mjs` 断言，`ci.mjs` 与 e2e harness 共用；`ci.mjs` 在测试前不再 build，顺序改为 typecheck → tests → build → pack-check → e2e。

### 5. 迁移顺序

1. 构建切换：tsdown、`lib/`、manifest 指向新入口，此步先保留 `.js` specifier。先验证打包器能把 `./x.js` 解析到 `./x.ts`；解析不了就把步骤 1、2 合并成一次提交（specifier 与 tsconfig 同步切换）。
2. specifier 改写与 tsconfig 切换：36 个 src 文件机械替换 `.js` → `.ts`；
3. 测试与 e2e fixture 改 import 源码；
4. 收尾：`dist/` 约定删除、pack-check 断言更新、README/AGENTS 记述。

### 6. 失败行为

- 构建、类型检查、测试任一失败即非零退出，不产出半成品：`build.mjs` 先清 `lib/` 再构建；
- Node < 22.18 时类型擦除不可用：测试入口在做任何 import 前检查 `process.versions.node`，直接报“需要 Node ≥22.18”并退出，而不是给出成片的语法错误；
- `tsdown` 装不上（离线）时停在构建这一步，按备选换成 esbuild 多入口，入口名与 `lib/` 布局不变，不改源码约定与测试；
- 打包后入口加载失败属于验收失败，由 e2e 与临时 profile 安装覆盖，不靠单测替代。

### 7. 验证切入点

- 静态：`src` 内无 `from './x.js'`；`tsc -p` 两条命令通过；
- 单元：54 个测试直接 import `src/*.ts` 通过（不先 build）；
- 打包：`npm pack --dry-run` 清单断言；
- 运行时：临时 profile 安装 → `--dump-config` 出现 `dsh-storycraft` 层 → 冷启动 → 页面无 `pageerror`、`/api/dsh-storycraft/works` 200。

### 8. 兼容与迁移

- 本仓库没有旧作品、旧安装包或外部消费者：不做 `dist/` 双读、不做 legacy 分支，`dist/` 直接停止产出；
- 开发 profile 以 `link:` 指向工作区，切换后重新 `npm install`（装 tsdown）并重建即可；`engines.node` 记 ≥22.18，与类型擦除要求一致；

## 备选方案

- **无后缀 + vitest**（seework/webnovel 形）：能去掉后缀并统一打包器，代价是重写 54 个自建 runner、引入 vitest 与整套测试配置；宿主自身不用这种写法。否决。
- **保留 tsc 逐文件**（现状）：内部模块进包、规范与生态不一致。否决（作者 2026-10-26 选 A）。
- **只给发布包加一层打包，源码留 `.js`**（上一轮的 B）：包形态对齐但源码规范不变。否决。

## 验收条件

产品行为不改，产品的可观察验收归工作项：工作台、动作回执与面板保持不变。本节列的是本次构建与包形态的技术验收。

1. `src` 内不存在 `from './x.js'` 形式的相对导入；
2. `tsc -p tsconfig.json` 与 `tsc -p tsconfig.client.json` 均通过（`noEmit`）；
3. 54 个测试不 build 直接通过；`node storycraft/scripts/ci.mjs` 全绿（含 E2E）；
4. `npm pack` 清单至少含 `lib/{index,client,skills,tools}.js` + `skills/**` + `cordis.patch.yml` + `icon.svg` + `README.md`；`lib/` 内只允许四个入口与这些入口 import 的切块，出现其他文件即失败；不含 `src`、tests、e2e、scripts。`LICENSE` 由 [发布 Note](2026-10-26-storycraft-release-packaging.md) 引入，不在本次验收内；
5. 临时 profile 安装后 `--dump-config` 出现 `dsh-storycraft` 层；页面无 `pageerror` 且 `GET /api/dsh-storycraft/works` 返回 200，两条都由 e2e 断言（`e2e/load.spec.cjs`+`e2e/host.mjs`），不靠人工观察；
6. Node 下限写进 `engines.node`，并在 CI 前置断言（擦除需要 ≥22.18）。

## 风险

- 类型擦除不支持 enum/namespace/参数属性/装饰器：已核查 `src/*.ts` 无（2 处 `^@` 是 client 里的 CSS 文本）；新增语法时要改用 `--experimental-transform-types` 或避开。
- `tsdown` 是新增 devDependency（本机未安装；`dsh-seework` 的 `node_modules` 里那份不可复用）。若离线装不上，备选 esbuild 多入口 + `splitting`，产物同名同形。
- 测试跑源码、安装包跑打包产物：同源不同形，入口加载必须由 e2e 与 install smoke 覆盖（验收 5）不能只看单测。
- Client 仍用 esbuild，构建链上是两个工具；原因写在此处，避免以后被“统一成一个工具”误改。
- 打包器按 isolatedModules 语义处理源码：跨模块的类型再导出必须写成 `export type`，否则打包器会当成值导出并在构建期报错；实施时由打包器报错兜住，不靠人工逐文件检查。

## 与既有决策的关系

- 部分替代 [TS 迁移 Note](2026-10-24-storycraft-ts-migration.md) §1 的产物位置、源内 specifier 规则与“测试 import dist”规则；其类型来源、分批迁移顺序与 Client 单文件约束继续有效。
- [发布 Note](2026-10-26-storycraft-release-packaging.md) §2 的构建脚本与 §3 的 pack-check 断言随本文更新；构建命令名仍是 `build`。
