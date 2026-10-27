---
title: 故事工坊：可发布包形态与三轨分发
status: proposed
created: 2026-10-26
updated: 2026-10-26
---

# Agent Note：故事工坊：可发布包形态与三轨分发

## 问题

故事工坊目前只有开发形态：`private: true`，没有 `main`、`engines.dsh`、`license`、`repository`，`dist` 由 tsc 逐文件产出（37 个文件，相对 `.js` 导入原样保留），profile 用 `link:` 指向工作区。

同一个包要同时支持本机 link 开发、GitHub 直装与 npm 发布，需要确定：发布字段取哪些值；安装时构建由谁触发、在什么上下文里能成立；三类安装各自用什么可观察证据验收；发布门禁放在哪里，才能既不靠人记得先构建，也不改变运行行为与 DSH 加载契约（`exports` 入口、`cordis.patch.yml`、`dsh.client` 注入）。

## 对拍参考

- `inkos-master/.github/workflows/release.yml`：`v*` tag 触发 test → smoke-test（产物 `--help`、`import()`、`npm pack` 后检查 tarball 内容）→ publish-canary → verify-canary → publish-release → verify-release → GitHub Release。采纳：tag 与 `package.json` 版本逐字对齐、发布前构建并校验 tarball、发布后以消费者身份重装一次；不采纳：canary 双发布与 `workspace:` 协议重写（本包是单包，没有 workspace 依赖）。
- `inkos-master/packages/cli/package.json`：`prepack` 先构建，`files` 只列 `dist`，`engines.node` 声明运行时，`prepublishOnly` 再校验一次 manifest。采纳“打包必构建 + 白名单 + 发布前校验”，不采纳其 monorepo 构建链。
- 外部 DSH 插件 `dsh-seework`（`E:\workspace\dsh-plugin\dsh-seework`）：`tsdown.config.ts` 产出 `lib/index.js` 供 `main` 与 `exports` 指向；`docs/design/2026-09-29-npm-distribution-and-in-plugin-update.md` 记录首版 `0.1.0`、去 `private`、补 `repository`、`prepublishOnly` 构建、`files` 只留运行时文件、peer 依赖只告警、registry 安装与开发安装分离、pnpm 默认拒绝安装发布不满 24 小时的版本、tarball/path spec 重装报 `ambiguous-install`。采纳这些安装与发布事实；不采纳其打包形态（本包构建形态由 TypeScript 迁移 Note 拥有）与插件内更新 UI（本次非目标）。
- `dsh-webnovel-writer`（`E:\workspace\dsh-webnovel-writer`）：`packages/bundle/package.json` 用 `files` 白名单发布单文件 `lib/index.js` 与 `lib/client.js`。采纳 `files` 白名单形状；不采纳打包，因为它要内联 `@webnovel/*` 源码包与 229 处无扩展名导入，本包没有内部 workspace 依赖。
- DSH 宿主契约：`deepseek-harness/docs/user/develop/basic/publish.zh.md` 第 66 行要求 `engines.dsh`（缺省时回退到 `@deepseek-ai/dsh*` peer 范围），第 161–186 行说明 git 安装走 `prepare`、npm 与 tarball 使用预构建产物；`deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts` 第 55–73 行规定有 `engines.dsh` 时只看它、两者都缺视为满足；`deepseek-harness/docs/user/guide/plugin-market.md` 定义插件市场索引，本次不做。
- 无参考实现的取值：`engines.dsh` 的具体范围、`dsh-storycraft` 在 npm 的占用情况属于本包事实，上述参考工程都没有使用 DSH。范围由作者在 2026-10-26 定为 `>=0.2.1-rc.2 <0.3.0`。

## 提案

### 1. manifest

`storycraft/package.json` 增加发布字段；产物位置与入口由 [2026-10-26-storycraft-bundled-build.md](2026-10-26-storycraft-bundled-build.md) 拥有，`exports`、`main`、`dsh`、`icon`、`description` 的**值**以该 Note 为准，本节只管发布字段：

- 去掉 `private`；
- `version: "0.1.0"`；
- `main: "./lib/index.js"`（入口集合见 bundled-build 的入口映射表）；
- `license: "MIT"`，新增 `storycraft/LICENSE`（MIT 全文）；
- `repository: { "type": "git", "url": "git+https://github.com/dehuadong/dsh-nove.git", "directory": "storycraft" }`；
- `engines.dsh: ">=0.2.1-rc.2 <0.3.0"`（`engines.node` 由 bundled-build 拥有：`>=22.18`）；
- `keywords` 补 DSH 插件检索词；
- `files` 为 `lib`、`skills`、`cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE`。

`src` 不进包；`lib` 仍由构建生成、不提交。

### 2. 构建与安装脚本

> **部分替代（2026-10-26）**：Host 的构建方式与产物位置改由 [2026-10-26-storycraft-bundled-build.md](2026-10-26-storycraft-bundled-build.md) 拥有（tsdown 出 `lib/` 入口，esbuild 转译 Client）。本节只保留“哪些脚本触发构建”与发布门禁。

沿用现有的 `scripts/build.mjs` 作为唯一构建入口，不引入第二套构建命令：

- `build`：现有 `scripts/build.mjs`；
- `prepare`：与 build 相同，供 git 直装在安装后生成 `lib/`，本地 `npm install` 也会触发；
- `prepack`：与 build 相同，保证 `npm pack` 与 `npm publish` 的产物完整；
- `prepublishOnly`：`npm run build && node scripts/pack-check.mjs`。`npm publish` 先跑 prepublishOnly、再跑 prepack，而 pack-check 用 `npm pack --dry-run --ignore-scripts` 读清单、自己不再构建，所以这里必须先 build，否则干净树上会检查到空的 `lib/`。

### 3. 校验与安装 smoke

- 扩展 `scripts/pack-check.mjs`：在现有“必需文件、编译产物齐全、禁止目录”之外，断言 `private` 不存在、`main` 指向的文件在 tarball 内、`engines.dsh` 存在、`license` 字段与 `LICENSE` 文件一致、`README.md`、`icon.svg`、`cordis.patch.yml` 在包内。
- 新增 `scripts/install-smoke.mjs`：临时 `DSH_HOME` 下用 `dsh --profile smoke --from-default-profile web` 建立独立 profile，再 `dsh plugin --profile smoke add <tgz>`；`dsh --profile smoke --dump-config` 断言出现 `# == dsh-storycraft` 层与 `dsh-storycraft` 行；随后按 `e2e/host.mjs` 的方式冷启动 web 实例（`ELECTRON_RUN_AS_NODE=1`、`web --port <空闲端口> --no-open`、解析 stdout 的 token URL）；Playwright 打开页面，断言 `pageerror` 为空且 `GET /api/dsh-storycraft/works` 返回 200。桌面客户端路径沿用 `DSH_E2E_APP` 覆盖方式，不写死在脚本里。
- `ci.mjs` 增加一次 tarball 安装 smoke；与现有 e2e 复制模式二选一运行，避免同时启动两个实例。

### 4. 三轨安装

- 本机 link（开发）：`link:E:/dsh-nove/storycraft` 不变，改源码后先 `npm run build`；e2e 复制模式作为回归。
- GitHub 直装：`dsh plugin --profile <p> add "git+https://github.com/dehuadong/dsh-nove.git#<sha>&path:/storycraft"`，`prepare` 在安装时构建；验收检查装好的包内有 `dist/index.js` 并能挂载。
- registry：`npm publish` 后 `add dsh-storycraft@0.1.0`；若命中 24 小时 `minimumReleaseAge`，在临时 profile 的 `pnpm-workspace.yaml` 写入 `minimumReleaseAgeExclude: dsh-storycraft@0.1.0`，与 pnpm 自己的豁免写法一致。

### 5. 版本与发布流程

1. 确认版本与提交一致，运行 `node storycraft/scripts/ci.mjs`；
2. `npm pack`，运行 install-smoke；
3. 打 tag `v0.1.0`，与 `package.json.version` 逐字一致；预发布版本只进非 `latest` 的 dist-tag；
4. `npm publish`（出站动作，单独确认）；
5. 从 registry 重装一次并挂载；git 轨按固定 SHA 另行验证。

### 6. 许可与源码

发布包采用 MIT，不附带源码；GPL 的源码可得义务不再适用，仓库保持私有。

## 备选方案

- **继续只做 link 开发**：不满足可分发目标；否决。
- **把 Host 打包成单文件**：与 TypeScript 迁移 Note 的 tsc 决定冲突；当前单包没有内部依赖要内联，收益是产物完整性，代价是构建链与调试变化；本次不做。
- **提交 `dist` 让 git 安装免构建**：生成物成为第二真源，且与“dist 不提交”的决定冲突；否决。
- **用 tsdown 替换 tsc/esbuild**：改变构建链，收益与打包相同；本次不引入。
- **不做 `prepare`、只支持 npm**：放弃 git 直装；不满足三轨目标。
- **依赖 GitHub Actions 自动发布**：仓库没有 CI；先做可本地复现的门禁，CI 化留给后续工作项。
- **GPL-3.0-only 并把源码放进 npm 包**：能合规，但作者选择更简单的 MIT；否决 GPL。
- **插件市场索引与中央注册表**：作者决定本次不做；延后。

## 验收条件

1. `npm pack` 产物通过扩展后的 pack-check，清单含 `dist/index.js`、`dist/client.js`、`skills/**`、`cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE`，不含 `src`、`tests`、`e2e`、`scripts`。
2. tarball 在临时 `DSH_HOME` 的独立 profile 中安装成功，`--dump-config` 出现 `dsh-storycraft` 层，冷启动页面无客户端注册错误且工作台路由返回 200。
3. `git+https://github.com/dehuadong/dsh-nove.git#<sha>&path:/storycraft` 安装成功，装好的包内存在 `dist/index.js`。
4. 发布后从 registry 安装 `dsh-storycraft@0.1.0` 成功并完成同样的挂载验收。
5. 本机 link 开发回归：现有 e2e 复制模式仍通过。
6. 把 `engines.dsh` 改成当前运行版本不满足的范围后，隔离 profile 的安装被宿主拒绝并给出原因。

## 风险

- git 安装时 pnpm 是否安装 devDependencies 并执行 `prepare` 未在本机验证；若不成立，需要改为随包提交构建产物或提供不依赖 devDependencies 的构建方式，两者都要回到 Discuss。
- 本机只有 `0.2.1-rc.3` 可运行（checkout 为 rc.2 且没有 `node_modules`）；`engines.dsh` 含 rc.2 但 rc.2 未实测，登记为已知缺口。
- pnpm 的 24 小时 `minimumReleaseAge` 会挡住发布当天的 registry 安装验证，需要在临时 profile 显式豁免该版本。
- npm 发布与 git 推送都是出站动作，需要单独确认；发布后的 CDN 同步滞后会让紧随其后的安装 404，重试即可。
- `dsh plugin add` 对 tarball 与 path spec 的重装报 `ambiguous-install`（`dsh-seework` 实测），smoke 每次使用全新临时 profile 规避。
