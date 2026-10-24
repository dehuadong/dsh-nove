---
title: 故事工坊：TypeScript 开发与编译产物接入
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：TypeScript 开发与编译产物接入

## 问题

开发时用 TypeScript，安装包用编译后的 JavaScript。需要确定：

- 源码 / 产物的边界，避免同一实现维护两份；
- DSH 加载的是编译产物，开发 `link:` 与 tarball 安装都能工作；
- 构建由谁触发，CI 与 `npm pack` 如何保证产物存在。

`scope` 作为第一个模块，是因为它纯函数、已有测试，适合先验证接入方式；它不是全量迁移决策。

## 对拍参考

`inkos-master` 本身就是 TypeScript 项目：

- `inkos-master/tsconfig.json`：`rootDir: src`、`outDir: dist`、`module: Node16`、`strict`、`declaration`；
- `inkos-master/packages/core/src/index.ts` 等源文件是 `.ts`；
- `package.json` 的 `build` 是 `pnpm -r build`，测试用 vitest。

采纳其 **TS 源码 → dist JS → 安装/运行** 的方式；不复制其包结构或构建工具，试点用本地 `tsc`。

## 提案

### 1. 源码与产物

- 唯一实现：`src/scope.ts`；
- 编译产物：`dist/scope.js`，**不提交**，由构建生成；
- 不存在根 `scope.js` 的第二份实现；`tools.js` 直接 import `./dist/scope.js`，测试 import `../dist/scope.js`；
- `dist/` 继续被 `.gitignore` 忽略，安装包通过 `prepack` 生成后打入 tarball。

### 2. 构建与依赖

- `npm install` 安装 `typescript` 与 `@types/node`（devDependencies，不进安装包）；
- `npm run build` 调用本地 `node_modules/typescript/bin/tsc`，不依赖全局 `tsc`；
- `prepack` 自动 build，`npm pack` 的 tarball 一定含 `dist/scope.js`；
- CI：build → pack-check → 50 单元测试。

### 3. 打包

- `files` 含 `dist`，不含 `src`、`tests`、`e2e`、`scripts`；
- `pack-check` 实际检查 `npm pack --dry-run` 清单，要求 `dist/scope.js`；
- 开发 `link:` 需要先 build；改 `src` 后重新 build，不手改 `dist`。

### 4. 非目标

- 全量 Host TS；
- Client TS/esbuild；
- 根入口 shim 或提交生成产物；
- 改变运行行为或 DSH 加载路径。

## 备选方案

- **提交 dist**：会把生成物变成第二个真源；否决。
- **根 `scope.js` re-export**：会保留一份 JS 入口；否决，直接 import 产物。
- **全局 tsc**：不可复现；否决，改用 devDependency。
- **构建时再编译（不预构建）**：没有构建步骤的开发机无法直接 `link:`；用 `prepack` + 显式 build 解决。

## 验收条件

1. `src/scope.ts` 是唯一实现，`dist/` 被忽略且不提交；
2. `npm install && npm run build` 生成 `dist/scope.js`；
3. `scope.test`、`ci --no-e2e`、pack-check 通过；
4. `npm pack` 的 tarball 含 `dist/scope.js`，不含 tests/e2e/src；
5. 临时 profile 安装 tarball 后 DSH 能启动。

## 风险

- 开发机需要先 `npm install` 和 build，`link:` 不是零步骤；
- `dist` 不提交，直接复制仓库目录安装会缺产物，必须走 tarball 或先 build；
- 后续全量 TS 需要单独评估 Client 构建与 DSH 类型定义。
