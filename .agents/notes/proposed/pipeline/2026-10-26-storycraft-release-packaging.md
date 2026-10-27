---
title: 故事工坊：npm 发布形态与安装验收
status: proposed
created: 2026-10-26
updated: 2026-10-27
---

# Agent Note：故事工坊：npm 发布形态与安装验收

## 问题

构建形态已由 [2026-10-26-storycraft-bundled-build.md](../../implemented/pipeline/2026-10-26-storycraft-bundled-build.md) 定稿并交付：`lib/` 四个入口、测试跑源码、`engines.node >=22.18`。

剩下的是“这个包怎样被安装与发布”：`package.json` 仍是 `private: true`，没有 `license`、`repository`、`engines.dsh`、`keywords`，也没有 `LICENSE` 文件；开发期只有 `link:` 一种装法，没有任何命令能证明“打出来的 tarball 装进一个干净 profile 后还能用”。

作者在 2026-10-27 决定：**只走 npm 发布，不做 GitHub 直装**。因此不需要为 git 安装设计构建触发（`prepare`），也不需要仓库对外可读；需要确定的是发布字段取值、发布门禁放在哪里、以及发布前用什么可观察证据证明 tarball 可用。

## 对拍参考

- `inkos-master/.github/workflows/release.yml`：`v*` tag 触发 test → smoke-test（产物 `--help`、`import()`、`npm pack` 后检查 tarball 内容）→ publish-canary → verify-canary → publish-release → verify-release → GitHub Release。采纳：版本与 tag 逐字对齐、发布前构建并校验 tarball、发布后以消费者身份重装一次；不采纳 canary 双发布与 `workspace:` 协议重写（本包是单包，没有 workspace 依赖）。
- `inkos-master/packages/cli/package.json`：`prepack` 先构建、`files` 只列产物、`prepublishOnly` 再校验一次 manifest。采纳“打包必构建 + 白名单 + 发布前校验”，不采纳其 monorepo 构建链。
- `dsh-seework`（`E:\workspace\dsh-plugin\dsh-seework`）：`docs/design/2026-09-29-npm-distribution-and-in-plugin-update.md` 记录的 npm 发布事实 —— 首版 `0.1.0`、去 `private`、补 `repository`、`prepublishOnly` 构建、`files` 只留运行时文件、peer 依赖只告警、registry 安装与开发安装分离、pnpm 默认拒绝发布不满 24 小时的版本、tarball/path spec 重装报 `ambiguous-install`。这些全部采纳为本包的安装与发布事实。
- `dsh-webnovel-writer`（`E:\workspace\dsh-webnovel-writer`）：`packages/bundle/package.json` 用 `files` 白名单发布入口文件；采纳其白名单形状，不采纳其 monorepo 与内联打包。
- DSH 宿主契约：`deepseek-harness/docs/user/develop/basic/publish.zh.md`（第 66 行要求 `engines.dsh`，缺省时回退到 `@deepseek-ai/dsh*` peer 范围；npm 与 tarball 安装使用预构建产物，不执行构建）；`deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts` 第 55–73 行规定有 `engines.dsh` 时只看它、两者都缺视为满足。
- 无参考实现的取值：`engines.dsh` 的具体范围与 `dsh-storycraft` 在 npm 的占用属于本包事实，参考工程都没有使用 DSH。范围由作者在 2026-10-26 定为 `>=0.2.1-rc.2 <0.3.0`。

## 提案

### 1. manifest

`storycraft/package.json` 增加发布字段；产物位置与入口由 [2026-10-26-storycraft-bundled-build.md](../../implemented/pipeline/2026-10-26-storycraft-bundled-build.md) 拥有，`exports`、`main`、`dsh`、`icon`、`description` 的**值**以该 Note 为准，本节只管发布字段：

- 去掉 `private`；
- `version: "0.1.0"`；
- `license: "MIT"`，新增 `storycraft/LICENSE`（MIT 全文）；
- `repository: { "type": "git", "url": "git+https://github.com/dehuadong/dsh-nove.git", "directory": "storycraft" }`（仅作元数据；仓库保持私有，不影响 npm 安装）；
- `engines.dsh: ">=0.2.1-rc.2 <0.3.0"`（`engines.node` 由 bundled-build 拥有：`>=22.18`）；
- `keywords` 补 DSH 插件检索词（`dsh-plugin`、`deepseek-harness`、`novel` 等）；
- `files` 增加 `LICENSE`，其余保持 `lib`、`skills`、`cordis.patch.yml`、`icon.svg`、`README.md`。

`src` 不进包；`lib` 仍由构建生成、不提交。

### 2. 构建与安装脚本

沿用 `scripts/build.mjs` 作为唯一构建入口，不引入第二套构建命令：

- `build`：现有 `scripts/build.mjs`；
- `prepack`：与 build 相同，保证 `npm pack` 与 `npm publish` 的产物完整；
- `prepublishOnly`：`npm run build && node scripts/pack-check.mjs`。`npm publish` 先跑 prepublishOnly、再跑 prepack，而 pack-check 用 `npm pack --dry-run --ignore-scripts` 读清单、自己不再构建，所以这里必须先 build，否则干净树上会检查到空的 `lib/`；
- 不设 `prepare`：它只对 git 安装有意义，而本包不做 git 轨。

### 3. 校验与安装 smoke

- 扩展 `scripts/pack-check.mjs`：在现有断言（入口集合从 `exports` 派生、`lib/` 无未声明产物、禁止 `src`/tests/e2e/scripts）之外，断言 `private` 不存在、`engines.dsh` 存在、`license` 字段与 `LICENSE` 文件一致、`LICENSE` 在包内、`files` 里没有 `dist`。
- 新增 `scripts/install-smoke.mjs`：临时 `DSH_HOME` 下用 `dsh --profile smoke --from-default-profile web` 建立独立 profile，再 `dsh plugin --profile smoke add <tgz>`；`dsh --profile smoke --dump-config` 断言出现 `# == dsh-storycraft` 层与 `dsh-storycraft` 行；随后按 `e2e/host.mjs` 的方式冷启动 web 实例（`ELECTRON_RUN_AS_NODE=1`、`web --port <空闲端口> --no-open`、解析 stdout 的 token URL）；用 `e2e/load.spec.cjs` 同一套断言检查页面无 `pageerror`、`GET /api/dsh-storycraft/works?root=…` 返回 200。桌面客户端路径沿用 `DSH_E2E_APP` 覆盖，不写死在脚本里。
- `ci.mjs` 增加一次 tarball 安装 smoke；与现有 e2e 复制模式二选一运行，避免同时启动两个实例。

### 4. 两种安装形态

- 本机 link（开发）：`link:E:/dsh-nove/storycraft` 不变，改源码后先 `npm run build`；e2e 复制模式作为回归。
- registry（发布）：`npm publish` 后 `dsh plugin add dsh-storycraft@0.1.0`；若命中 pnpm 的 24 小时 `minimumReleaseAge`，在临时 profile 的 `pnpm-workspace.yaml` 写入 `minimumReleaseAgeExclude: dsh-storycraft@0.1.0`。tarball 安装是发布前的本地等价验证。

不做的轨：GitHub 直装（`git+https://…`）、插件内更新 UI、插件市场索引。

### 5. 版本与发布流程

1. 确认版本与提交一致，运行 `node storycraft/scripts/ci.mjs`；
2. `npm pack`，运行 install-smoke；
3. 打 tag `v0.1.0`（仅作发布标记，与 `package.json.version` 逐字一致；不作为安装入口）；
4. `npm publish`（出站动作，单独确认；预发布版本只进非 `latest` 的 dist-tag）；
5. 从 registry 重装一次并完成同样的挂载验收。

### 6. 许可与源码

发布包采用 MIT，不附带源码；仓库保持私有，npm 发布不要求仓库公开。

## 备选方案

- **继续只做 link 开发**：不满足可分发目标；否决。
- **GitHub 直装**（`git+https://…&path:/storycraft`，安装时 `prepare` 构建）：私有仓库需要凭据、安装时依赖 devDependencies 与 pnpm 行为，且作者 2026-10-27 明确不需要；否决。
- **提交 `lib` 让安装免构建**：生成物成为第二真源，且与“`lib` 不提交”的决定冲突；否决。
- **不做 `prepare`、只支持 npm**：已采纳（见 §2）。
- **依赖 GitHub Actions 自动发布**：仓库没有 CI；先做可本地复现的门禁，CI 化留给后续工作项。
- **GPL-3.0-only 并把源码放进 npm 包**：能合规，但作者选择更简单的 MIT；否决 GPL。
- **插件市场索引与中央注册表**：作者决定本次不做；延后。

## 验收条件

1. `npm pack` 产物通过扩展后的 pack-check：清单含 `lib/{index,client,skills,tools}.js`、`skills/**`、`cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE`，不含 `src`、`tests`、`e2e`、`scripts`；`private` 不存在、`engines.dsh` 存在、`license` 与 `LICENSE` 一致。
2. tarball 在临时 `DSH_HOME` 的独立 profile 中安装成功，`--dump-config` 出现 `dsh-storycraft` 层，冷启动页面无 `pageerror` 且工作台路由返回 200。
3. 发布后从 registry 安装 `dsh-storycraft@0.1.0` 成功并完成同样的挂载验收。
4. 本机 link 开发回归：现有 e2e 复制模式仍通过。
5. 把 `engines.dsh` 改成当前运行版本不满足的范围后，隔离 profile 的安装被宿主拒绝并给出原因。

## 风险

- 本机只有 `0.2.1-rc.3` 可运行（checkout 为 rc.2 且没有 `node_modules`）；`engines.dsh` 含 rc.2 但 rc.2 未实测，登记为已知缺口。
- pnpm 的 24 小时 `minimumReleaseAge` 会挡住发布当天的 registry 安装验证，需要在临时 profile 显式豁免该版本。
- `npm publish` 是出站动作，需要单独确认；发布后的 CDN 同步滞后会让紧随其后的安装 404，重试即可。
- `dsh plugin add` 对 tarball 与 path spec 的重装报 `ambiguous-install`（`dsh-seework` 实测），smoke 每次使用全新临时 profile 规避。
- `repository` 指向私有仓库：npm 页面对外部访问者不可达，只作元数据；不影响安装。
