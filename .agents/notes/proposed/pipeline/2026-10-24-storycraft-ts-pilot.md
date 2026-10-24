---
title: 故事工坊：TypeScript 单模块接入试验（scope）
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：TypeScript 单模块接入试验（scope）

## 问题

要决定的是：**故事工坊是否值得从 JS + JSDoc 迁到 TypeScript，以及如果值得，采用哪种接入方式**。不是“能不能把某个文件改名成 `.ts` 再编译”。

当前 `scope.js` 的改造只能证明最弱的一环：一个纯函数模块能被 `tsc` 编译、被 DSH 加载、被打进 tarball。它不能证明 TypeScript 对真实 DSH 契约（Host Service、Tool 参数、Client slot）有类型收益，也没有覆盖 Client 构建、开发热更新和全量迁移成本。

因此本记录先明确试点要回答的问题；当前实现只作为**单模块接入原型**，不是“全量迁移可行”的证据。

## 对拍参考

- 无参考实现：`inkos-master` 的插件是 JS/构建产物，没有可迁移的“单模块 TS + dist”设计。
- DSH 自身使用 TypeScript + tsdown（`deepseek-harness/docs/development.md`），但那是 DSH 包内构建，不能直接证明外部插件的收益/成本。
- 裁决：只借鉴“源文件 TS、产物 JS”的原则；是否迁移由本试点的判定问题决定，不预先采纳全量方案。

## 提案

### 1. 试点必须回答的问题

| 问题 | 为什么重要 | 当前 scope 试验能否回答 |
| --- | --- | --- |
| DSH Host 类型是否可用且值得 | 工具参数、Service、事件才可能抓出真实错误 | **否**：`scope` 不依赖 DSH |
| Client 能否用 TS + 单文件 bundle | `client.js` 是浏览器入口，和 Host 构建不同 | **否**：未做 |
| 开发循环是否可接受 | `tsc`/watch/HMR、测试路径、构建耗时 | 部分：只验证了一次 `tsc` |
| 打包与安装是否稳定 | `dist` 提交、tarball、`link:`、CI | 是：已验证 |
| 类型收益是否大于双源/构建成本 | 是否值得全量迁移 | **否**：没有 DSH 类型样本 |

结论：**当前证据只能支持“单模块可以这样接入”，不支持“全量迁移可行”。**

### 2. 当前原型的接入方式

- `src/scope.ts` 是唯一实现；根 `scope.js` 只 re-export `dist/scope.js`；
- `npm run build` 用本机 `tsc` 生成 `dist/scope.js`；
- 产物提交，保证 `link:`/tarball 无构建可加载；
- CI：build → `check-dist` → pack-check → 50 单元；
- Node 类型暂用 `src/node-shim.d.ts`，全量迁移时换 `@types/node`。

这是**单模块接入原型**，不是最终目录规范；如果后续不做全量迁移，应评估是否回退到 JS，避免长期双源。

### 3. 下一步的真实试点（另立工作项）

若要继续评估全量 TS，必须选一个**依赖 DSH 契约的 Host 模块**（例如 `tools.js` 的一个 action 或 `index.js` 的路由类型），并明确：

- 类型定义来源（DSH 包的 `.d.ts` 或本地声明）；
- 编译前后 LOC、测试改动、构建耗时；
- 是否能在不提交 `dist` 的情况下开发/安装；
- Client 是否另做 esbuild 试点。

## 备选方案

- **全量迁移**：证据不足；否决于当前阶段。
- **保持 JS + JSDoc**：零构建、零双源，但类型收益有限；作为默认基线。
- **单模块 TS 接入**：当前原型的做法；只适合作为例外，需明确维护成本。
- **先做 Client esbuild 试点**：如果目标是浏览器端类型/打包，应先于 Host 全量；未排期。

## 验收条件

1. 试点记录明确回答上表五个问题，而不是只证明“能编译”；
2. 当前原型有明确处置：保留为单模块例外，或回退；
3. 若进入全量评估，另立工作项并选 DSH 契约模块；
4. `scope.test`、`ci --no-e2e`、pack-check、tarball 加载仍通过（原型本身）；
5. 文档不再把“单模块编译成功”写成“全量 TS 可行”。

## 风险

- 提交 `dist` 会形成双源；若长期保留，必须自动化一致性检查（已加 `check-dist`）。
- 本机 `tsc` 版本不可复现；全量迁移前必须补 devDependency。
- `scope` 太简单，容易让人误以为 DSH 类型问题也解决了；这是本记录要纠正的主要误判。
