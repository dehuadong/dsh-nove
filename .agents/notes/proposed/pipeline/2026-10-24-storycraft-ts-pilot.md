---
title: 故事工坊：TypeScript 试点（scope）
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：TypeScript 试点（scope）

## 问题

插件当前是纯 JavaScript + JSDoc。直接全量转 TS 会同时改变 Host、Client 与打包路径，风险太大；先选一个无 DSH 依赖、已有测试的 Host 模块验证：

- 编译器与产物路径；
- DSH 从 tarball 加载 `dist` 的方式；
- `files`/pack-check 对生成物的约束；
- 现有测试与 import 是否无需改动。

试点选 `scope.js`：纯函数、无外部依赖、`scope.test.mjs` 覆盖完整。

## 对拍参考

- 无参考实现：`inkos-master` 的插件是 JS/构建产物，没有可迁移的“单模块 TS + dist”设计；DSH 自身使用 TypeScript + tsdown（`deepseek-harness/docs/development.md`），但那是包内构建，不是外部插件试点。
- 裁决：借鉴 DSH 的“源文件 TS、产物 JS”原则，但不引入 tsdown/完整构建链；试点只用 `tsc`。

## 提案

### 1. 目录与入口

- 源文件：`src/scope.ts`；
- 产物：`dist/scope.js`（试点提交产物，保证 `link:` 与 tarball 在没有构建时也能加载）；
- 稳定入口：根 `scope.js` 只 `export { SCOPE_MESSAGES, scopeDenial } from './dist/scope.js'`，现有 import 不变；
- `tsconfig.json` 只 include `src/**/*.ts`，`module/moduleResolution: NodeNext`，`strict: true`。

### 2. 构建与依赖

- `scripts/build-ts.mjs` 调用本机 `tsc -p tsconfig.json`；
- 试点把 `tsc` 作为开发机前置，不引入 `typescript` devDependency；README 写明要求；
- 后续全量迁移再评估本地依赖与分发。

### 3. Node 类型

- 试点不装 `@types/node`，用 `src/node-shim.d.ts` 声明 `node:path` 与 `process.platform`；
- 全量迁移时替换为 `@types/node`，删除 shim。

### 4. 打包与 CI

- `files` 增加 `dist`，`pack-check` 要求 `dist/scope.js`；
- CI 顺序：build → pack-check → 50 单元测试；
- 构建后检查 `git diff --exit-code -- dist`，防止提交的 dist 与源码漂移；
- 根 `scope.js` 仍由 `*.js` 覆盖。

### 5. 非目标

- 全量 Host TS；
- Client esbuild；
- 改公共导出、DSH 加载路径或运行行为；
- 把 `dist` 变成第二个源码真源。

## 备选方案

- **不提交 dist**：`link:` 直接运行会缺 `dist/scope.js`，每次开发都要先 build；否决，试点先提交。
- **引入 typescript devDependency**：更可复现，但当前包没有依赖安装流程；试点先用本机 `tsc`，全量迁移再补。
- **不改根入口，直接 import dist**：会让所有调用方知道生成路径；否决，保留根入口。
- **用 tsdown/完整 DSH 构建**：超出试点范围；否决。

## 验收条件

1. `src/scope.ts` 是实现唯一来源，根 `scope.js` 只 re-export；
2. `npm run build` 生成 `dist/scope.js`；
3. `scope.test.mjs`、`ci --no-e2e`、pack-check 通过；
4. tarball 含 `dist/scope.js`/`.d.ts`，不含 tests/e2e；
5. 构建后 `git diff --exit-code -- dist` 无差异；
6. DSH 从 tarball 加载仍成功。

## 风险

- 提交生成的 dist 会与源码重复；用 CI diff 检查约束，正式方案可改为发布时构建。
- 本机 `tsc` 版本差异可能改变产物；试点固定当前环境，后续补 devDependency。
- 手写 Node shim 在引入 `@types/node` 时需删除，否则类型冲突。
