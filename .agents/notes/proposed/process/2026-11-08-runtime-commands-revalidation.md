# Agent Note: 故事工坊：runtime.commands 证据重验

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.commands` 重验。复审已把它冻结为 `missing`；本工作项只修 `/story-init` 的初始化语义与命令入口边界，不扩成通用命令代理。

## Problem

复审确认旧实现过宽且证据不足：

- 源 `init` 创建项目文件（`inkos.json`、`works/`、`radar/` 等），已存在时拒绝；
- 当前 `/story-init` 只 `mkdir`，不创建 catalog，也不拒绝已初始化目录；
- 宿主路由 `/api/see-storycraft/command` 把任意 `line` 转发给 `commands.execute`，实际是通用命令代理；
- 声明 consumer 只断言 UI 文案，没有命令边界或初始化证据；
- `--lang` 未实现，是源行为缺口。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/cli/src/commands/init.ts:10-19` | `init [name]` 创建目录并初始化项目；`--lang` 默认 zh | 复刻 `/story-init [name]`；语言登记后续债 |
| `packages/cli/src/project-bootstrap.ts:122-152` | `inkos.json` 已存在时拒绝；创建 `works/`、`radar/`、`.env` 等 | 复刻创建 `.storycraft/catalog.db`；已存在拒绝；文件清单差异登记债 |
| 源 CLI 入口是独立进程 | 命令由 CLI 解析 | 复刻宿主 `/api/see-storycraft/command` 只接受 `/story-init`，不做通用代理 |

## Proposal

### 范围

1. `initializeWorkspace`：
   - `name` 为空初始化 cwd，否则子目录；
   - 已存在 `.storycraft/catalog.db` → `project-exists`；
   - 否则 `openCatalog(root, { create: true })` 创建 catalog；
   - 返回 `已初始化工作区`；
2. 宿主 `/command`：
   - 只接受 trim 后以 `/story-init` 开头的 line；
   - 其他命令 → `command-not-allowed`；
3. consumer：
   - `commands.test.mjs` 覆盖首次创建、重复拒绝、name 子目录、catalog 存在；
   - `e2e/commands.spec.cjs` 保留 UI 文案，并新增 `/compact` 被路由拒绝；
   - `tools.test`/命令列表仍验证 `story-init` 注册；
4. 旧 Note 归档，新 Note 接管；真实回执用当前树 e2e。

### 非目标 / 保留债

- 不写 `inkos.json`/`.env`/`radar`（DSH 作品存储不同；登记债）；
- 不实现 `--lang`（作品无 language 字段；登记债）；
- 不实现 export/headless 入口（`export.work` 仍 missing）；
- 不做通用命令代理。

### 失败行为

- catalog 已存在 → `project-exists`；
- 无 cwd → 现有错误；
- 非 `/story-init` 命令 → `command-not-allowed`；
- 创建失败 → 命令 error。

## Alternatives considered

**保留任意命令代理。** 最强理由是方便 `/compact`；源入口不是通用代理，且会暴露 `/permission`，故限制为 `/story-init`。
**只修文案不建 catalog。** 最强理由是改动小；源 init 真的初始化项目，当前命令没有产物，故必须建 catalog。
**完整复刻 inkos.json 文件集。** 最强理由是结构等价；DSH 用 `.storycraft/catalog.db`，文件集差异登记债，不在本行硬造无关文件。

## Acceptance criteria

1. 首次 `/story-init` 创建 catalog；
2. 重复 `/story-init` 返回 `project-exists`，不覆盖；
3. `name` 创建子目录并初始化；
4. `/command` 只接受 `/story-init`，其他命令 `command-not-allowed`；
5. consumer 与真实 e2e 回执齐全；
6. 语言/文件清单/export 债有归属；
7. `--write` 后才置 `verified`。

## Plan Review

- Standards：命令入口边界与源 CLI 对齐；不把 DSH 差异写成等价。
- Spec：catalog 创建、重复拒绝、name、命令拒绝都可观察。
- Architecture：catalog 是工作区初始化产物；命令路由只暴露 story-init。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 重复 `/story-init` 从幂等变为拒绝，面板按钮可能报错；
- e2e 需要断言 `/compact` 被拒绝；
- 真实回执依赖当前树 e2e 会话。
