# Agent Note: 故事工坊：源码 TS 约定与入口打包

Status: implemented

## 问题

Host 原本是 36 个 `src/*.ts`，相对导入写 `./x.js`；构建用 tsc（`module`/`moduleResolution: NodeNext`）逐文件出 `dist/*.js`（37 个文件，specifier 原样保留）；Client 由 esbuild 只转译出 `dist/client.js`；54 个测试与 e2e fixture 直接 import `dist/*.js`。

由此产生的差异，作者 2026-10-26 判定为需要修正的问题：

- 源码通篇 `.js` 后缀。这不是笔误：Node ESM 的 specifier 是运行时路径，`NodeNext` 强制如此，并把 `./x.js` 映射回 `./x.ts`；
- 包形态是“37 个内部模块”，而 DSH 官方包与两个参照插件都是“若干入口文件”；
- 内部模块随 tarball 发布，`import 'dsh-storycraft/dist/storage.js'` 这类深导入事实上可用；
- 构建需要 tsc 边编译边检查，测试必须先构建才能跑。

## 对拍参考

- DSH 自有源码：`deepseek-harness/tsconfig.base.json` 开 `moduleResolution: "bundler"`、`allowImportingTsExtensions: true`、`rewriteRelativeImportExtensions: true`；`packages/fs/tool-fs/src/*.ts` 的相对导入写 `./diff.ts`、`./error.ts`（该目录 20 处 `.ts` specifier、0 处无后缀）。
- DSH 已发布包：`packages/fs/tool-fs/package.json` 的 `main: "lib/index.js"`，`files: ["locale/*.json", "lib/index.js", "lib/types/**/*.d.ts"]` —— 入口单文件加类型声明，不发布内部模块。
- `dsh-seework`：`tsdown.config.ts` 两份 config —— Host `src/index.ts` → `lib/index.js`（esm、`dts: false`、宿主共享包用 `external` 保持模块身份），Client `src/client/index.ts` → `lib/client.js`（cjs + `window.__ModuleLoader__.load` banner）；`tsconfig.json` 是 `moduleResolution: "Bundler"` + `noEmit`。
- `dsh-webnovel-writer`：`tsconfig.base.json` 同为 Bundler + `noEmit`；`packages/bundle` 用 `scripts/bundle.mjs`（esbuild）出 `lib/{index,cli,preset,client}.js`，`files` 白名单列这些入口。
- 采纳：入口打包、`lib/` 产物、`noEmit` 独立类型检查、`files` 白名单。不采纳：两家插件的**无后缀** import（宿主自己写 `.ts`；无后缀会迫使测试改用 vitest），也不采纳 `dsh-webnovel-writer` 的 monorepo 包划分。

## 决定

- **源码约定**：相对导入写 `./x.ts`（`allowImportingTsExtensions`），`module: esnext`、`moduleResolution: bundler`、`noEmit`。不设 `rewriteRelativeImportExtensions`：它只在 tsc emit 时生效，而 tsc 在这里只做类型检查，设了是死配置。
- **产物**：`tsdown` 三个入口（`index`、`tools`、`skills`）→ `lib/*.js`，共享代码由打包器切成 `lib/<name>-<hash>.js`；Client 仍由 esbuild `bundle: false` 转译成 `lib/client.js`，因为它不是 ESM，而是 `window.__ModuleLoader__.load({ factory(require) })` 单文件脚本。`dist/` 停止产出。
- **manifest**：`main: "./lib/index.js"`，`exports` 的 `.`/`./client`/`./skills`/`./tools` 指向 `lib/`，`files` 用 `lib`，`engines.node: ">=22.18"`。`cordis.patch.yml` 里的 `dsh-storycraft/tools`、`dsh-storycraft/skills` 名称不变。
- **测试与 e2e 跑源码**：54 个测试、`e2e/host.mjs` 的 fixture 与 `e2e/workbench.spec.cjs` 的探针数据都 import `src/*.ts`，依赖 Node 的运行时类型擦除；版本下限由 `scripts/node-version.mjs` 一处断言，`ci.mjs` 与 e2e harness 共用。`ci.mjs` 顺序改为 typecheck → tests → build → pack-check → e2e。
- **打包校验**：`pack-check.mjs` 的入口集合从 `package.json` 的 `exports` 派生，用 `npm pack --dry-run --json --ignore-scripts`（不再触发 prepack，因此 `prepublishOnly` 必须先 build），并拒绝 `lib/` 里入口没有 import 的文件。
- **可观察验收**：`e2e/load.spec.cjs` 断言页面无 `pageerror`、`GET /api/dsh-storycraft/works?root=…` 返回 200 且列出作品；`--dump-config` 断言 `# == dsh-storycraft` 层。

## 备选方案

- **无后缀 + vitest**（seework/webnovel 形）：能去掉后缀并统一打包器，代价是重写 54 个自建 runner、引入 vitest 与整套测试配置；宿主自身不用这种写法。否决。
- **保留 tsc 逐文件**：内部模块进包、规范与生态不一致，测试还要先构建。否决。
- **只给发布包加一层打包、源码留 `.js`**：包形态对齐但源码规范不变。否决。
- **Client 也进打包器**：会改写 `__ModuleLoader__` 外壳与 `require('react')`，破坏加载契约。否决。

## 后果

- 发布包里只有四个入口与它们 import 的切块；内部模块不再是可深导入的文件，重构不再需要担心隐藏消费者。
- 测试跑源码、安装包跑打包产物：同源不同形，入口加载必须由 e2e 与 pack-check 覆盖，不能只看单测。
- 单元测试若需要某个模块，只能从 `src/<module>.ts` 导入；`lib/` 里没有一对一文件。
- 构建链两个工具（tsdown 出 Host、esbuild 出 Client）；Client 单独转译的原因写在 `scripts/build-client.mjs` 与 README，避免被“统一成一个工具”误改。
- Node 下限从“能用”抬到 **≥22.18**（类型擦除），更老的 Node 会由 `scripts/node-version.mjs` 明确报错退出。
- 剩余风险：类型擦除不支持 enum/namespace/参数属性/装饰器（当前 `src` 没有；新增语法要改用 `--experimental-transform-types` 或避开）；`tsdown` 是新增 devDependency，离线时备选 esbuild 多入口 + `splitting`。

## 验证

- `node storycraft/scripts/ci.mjs` → `[ci] PASS: 54 unit files + E2E`（26 条页面 spec）。
- `node storycraft/scripts/pack-check.mjs` → `[pack] PASS: 36 个文件；4 个入口（lib/index.js, lib/client.js, lib/skills.js, lib/tools.js）+ skills`。
- 把 `lib/` 移走后重跑 `packaging`/`tools`/`storage`/`acceptance-multichapter` 仍通过 —— 测试不依赖构建产物。
- 临时 profile `--dump-config` → 出现 `# == dsh-storycraft` 层与 `dsh-storycraft/skills`、`dsh-storycraft/tools`。
- 作者在实际应用里确认工作台可见（2026-10-27）。安装路径为 `link:E:/dsh-nove/storycraft`；e2e 的复制安装按 `files` 复现了包形态。

- 交付证据：node storycraft/scripts/ci.mjs PASS（54 个单元文件 + 26 条 E2E spec）；pack-check PASS（36 个文件、4 个入口）；临时 profile --dump-config 出现 # == dsh-storycraft 层；作者在真实会话中确认工作台可见（2026-10-27）
