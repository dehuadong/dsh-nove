# Agent Note: storycraft 的 GitHub Actions 门禁

Status: implemented

## Problem

storycraft 的门禁只有本地一条命令 `node storycraft/scripts/ci.mjs`，推送后没有任何检查；[2026-10-26-storycraft-release-packaging.md](../../archived/process/2026-10-26-storycraft-release-packaging.md) 把 CI 化留给后续工作项。

同一条命令里还代跑了 `tools/implement-gate/test.mjs` 与 `tools/shell-guard/test.mjs`。这两个是独立工具，不是 storycraft 的一部分：它们的红会让 storycraft 的门禁红，而改动 `tools/**` 又不在 storycraft 的路径范围内。

## Decision

`.github/workflows/storycraft.yml` 是 storycraft 唯一的 CI：`push` 到 `main`、或 pull request 命中 `storycraft/**` 或该 workflow 本身时，在 `ubuntu-latest` 与 `windows-latest` 上执行 `npm ci` 后跑 `node scripts/ci.mjs --no-e2e`。

- `--no-e2e` 是硬约束。浏览器级那一步要起桌面客户端：`storycraft/e2e/host.mjs` 与 `storycraft/scripts/install-smoke.mjs` 都把可执行文件指向安装态的 `DeepSeek Harness.exe`，托管 runner 上没有它。E2E 与 tarball smoke 只在本机跑。
- 两个 OS 都是必需的。Windows 是主开发平台（`storycraft/tests/scope.test.mjs` 有一条 `process.platform === 'win32'` 分支），Ubuntu 是交付与外部消费者所在。
- `storycraft/scripts/ci.mjs` 不再调用 `tools/**`。三份工具的测试是本地命令，不进 CI。
- job 设 `timeout-minutes: 30`，并用 `concurrency` 取消同一分支上被新提交取代的旧运行：这条门禁是仓库里最慢的检查。
- `storycraft/tests/store-perf.test.mjs` 的时间预算在 CI 上只打印 `skip`、不判负：共享 runner 的盘速与 CPU 让毫秒阈值失去意义（首次运行 windows 腿实测 12923ms 与 111.6ms，本机同机是几十毫秒）。测量工作照跑，正确性断言与内存上限照判。
- `storycraft/tests/scope.test.mjs` 里 `dir .\works` 是 Windows 语法，移进已有的 `win32` 分支：POSIX 上 `.\works` 只是一个文件名，不构成对 `works` 的访问。
- `.github/workflows/shell-guard.yml` 删除。

## 对拍参考

- `inkos-master/.github/workflows/ci.yml`：`pnpm install --frozen-lockfile && pnpm build && pnpm test`，单 OS、单 job，覆盖构建与全部测试；发布由独立的 `release.yml` 在 tag 上串 test → smoke → publish。采纳"一个包一条检查、发布另走一条"的形状，以及锁文件冻结安装（本仓库对应 `npm ci`）。
- 未采纳其单 OS：本包的主开发平台是 Windows，只有 Ubuntu 会漏掉路径与进程行为差异。
- 未采纳其 `release.yml` 全链：本包尚未发布到 registry，发布门禁仍由 `scripts/ci.mjs --smoke` 在本机执行。
- 无参考实现的部分：三份工具不配 CI 是本仓库的取舍，参考工程没有等价的独立工具集。

## Testing

- 改后 `node storycraft/scripts/ci.mjs --no-e2e` PASS：全部单元契约文件、两项类型检查、构建、打包清单全过（exit 0）。
- `storycraft/` 内 `npm ci --dry-run` 报 `up to date`，锁文件与 `package.json` 一致。
- `storycraft.yml` 用 js-yaml 解析通过，`on`、`jobs`、矩阵与步骤符合预期。
- `storycraft/` 内搜 `tools/` 命中 0。
- 首次推送（run 41568245635）两腿均红：ubuntu 只有 `scope.test.mjs` 一条判负，windows 只有 `store-perf.test.mjs` 两条时间预算判负，其余全过。上面两条修正即由此而来。
- 修正后推送（run 41570657285）双绿：ubuntu 腿 1m03s，windows 腿 4m53s。
- 修正后本机 `CI=true node storycraft/scripts/ci.mjs --no-e2e` PASS，跳过的是时间预算那几行。

## Alternatives considered

- **一条 workflow 覆盖 `storycraft/**` + `tools/**`**：最强理由是省事、一个文件管全仓。否决原因：把三个互不依赖的项目绑成一条检查，`tools/` 改动会触发 storycraft 的构建与全部单测，失败归因也混在一起。
- **让 `ci.mjs` 继续代跑两个工具的测试**：最强理由是本机一条命令跑全仓，作者已有这个习惯。否决原因：storycraft 的门禁红可能来自别的项目，且改动 `tools/**` 不触发这条 workflow，覆盖是假的。
- **CI 里也跑 E2E**：最强理由是浏览器层才抓得到面板回归。否决原因：需要先把两个 harness 的启动方式从桌面客户端改成通用 launcher，属于独立范围，未纳入本次。可行性已在本机核过：`npm i @deepseek-ai/dsh@0.2.1-rc.5` 后 `node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --dump-config` 与 `... web --port 33177 --no-open` 都在纯 node 下成功，后者打印 `dsh web: http://127.0.0.1:33177/?token=…`，与 `e2e/host.mjs` 的等待正则同形。
- **只跑 `ubuntu-latest`**：最强理由是省一半 runner 时间并贴近部署环境。否决原因：丢掉主开发平台的覆盖。

## Consequences

- 推送后类型检查、全部单元契约、构建与打包清单在两个平台上自动验证；E2E 与安装 smoke 仍只在本机跑（`node scripts/ci.mjs`、`node scripts/ci.mjs --smoke`）。
- 首次运行就抓到两条平台假设（Windows 语法的用例、共享 runner 上的毫秒预算），说明异地 runner 判的是本机测不出的东西。
- CI 上 `storycraft/tests/presets.test.mjs` 会打印 `skip standard baseline (DSH checkout not present)`：标准预设逐行对齐要读本地 `deepseek-harness` 软链接，托管 runner 上没有它，这条契约在 CI 里不校验。
- `engines.node` 声明的 22.18 下限没有被 CI 覆盖，runner 只跑最新 24.x；下限仍是本机承诺。
- storycraft 的门禁不再覆盖 `tools/**`。三份工具的测试要人记得单独跑，没有 CI 兜底。
- DSH 与 Node 版本要一起看：`engines.node >=22.18`，`tsdown@0.23.2` 声明 `^22.18.0 || ^24.11.0 || >=26.0.0`；workflow 里 `setup-node` 的 `24` 解析到最新 24.x。
