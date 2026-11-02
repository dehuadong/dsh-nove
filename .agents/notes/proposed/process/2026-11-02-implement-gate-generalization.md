# Agent Note: implement-gate 通用化

Status: proposed

工作项：当前任务「implement-gate 通用化」。

## Problem

`@dsh-nove/implement-gate` 目前只在“.agents/implement-gate.json 存在才启用”这一层通用；启用后的策略全部写死在 `tools/implement-gate/classify.js`：

- code roots：`storycraft/src`、`storycraft/tests`、`storycraft/scripts`、`storycraft/e2e`、`storycraft/lib`、`tools`、`scripts`、`.github`；
- code files：`package.json`、`tsconfig*.json`、`cordis.patch.yml` 等；
- 文档例外路径：`docs/`、`.agents/notes`、`.agents/skills`、`.trash`、`tools/*/README.md`；
- 规划例外：`.agents/notes/proposed`；
- 命令：中文 planning/implement/docs 三条固定正则。

结果是：

- 其他项目不放 marker → 不拦截，看起来“通用”；
- 一旦别的项目启用，它套用的是 Storycraft 的目录与命令语义；
- 新项目源码目录会被当作文档，给 `docScope` 就能改源码；
- 其他项目无法使用自己的命令措辞。

这不是插件挂载问题，是策略没有配置化。

## 对拍参考

参考工程 `inkos-master` 没有 DSH `implement-gate` 对应实现；本项是 DSH Host 工具链自身的配置化改造，不存在可直接复用的参考实现。检索范围：`inkos-master` 的 `packages/`、`scripts/`、`docs/` 与 CI；未找到同类 pre-execute 授权守卫。

仓库内前置实现：`tools/implement-gate/index.js`（marker、会话状态、pre-execute）、`classify.js`（code roots、命令匹配）、`implemented/process/2026-10-31-storycraft-implement-gate.md`。本项只把既有策略移入项目配置，不改变 GATES 授权语义。

## Proposal

### 1. 项目配置

`.agents/implement-gate.json` 从单一布尔值扩展为：

```json
{
  "enabled": true,
  "version": 1,
  "codeRoots": [
    "storycraft/src",
    "storycraft/tests",
    "storycraft/scripts",
    "storycraft/e2e",
    "storycraft/lib",
    "tools",
    "scripts",
    ".github",
    "deepseek-harness"
  ],
  "codeFiles": [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.client.json",
    "cordis.patch.yml",
    ".gitignore",
    "storycraft/package.json",
    "storycraft/package-lock.json",
    "storycraft/tsconfig.json",
    "storycraft/tsconfig.client.json"
  ],
  "protected": [
    ".agents/implement-gate.json",
    ".agents/state/implement-gate"
  ],
  "proposed": ".agents/notes/proposed",
  "commands": {
    "planning": "^批准，使用(?:技能\\s*)?planning\\s+执行规划\\s+(.+)$",
    "implement": "^批准，使用(?:技能\\s*)?implement\\s+执行实现\\s+(.+)$",
    "docs": "^批准，执行文档治理\\s+(.+)$"
  }
}
```

- `codeRoots`、`codeFiles` 决定源码/配置边界；
- `protected` 是任何阶段都不能写的额外路径；marker 与 state 两个默认守护路径**无条件生效**，配置不能移除；
- `proposed` 是只允许 planning/implement 的规划路径；
- `commands` 是 owner 用户消息的完整匹配正则；planning/implement 保留“技能”可选的既有拼写；
- `version` 当前只接受 `1`；未知键 → `misconfigured`。

### 2. 启用与失败

- 无 marker → pass-through；
- `enabled: false` → pass-through；
- marker 存在但 JSON 不可解析、或缺 `enabled`、或 `enabled` 不是布尔值（如 `"true"`）→ `misconfigured`，所有写拒绝；
- `enabled: true` 但配置不合法 → `misconfigured`，所有写拒绝，`status` 返回原因；
- 必须提供非空 `codeRoots` 和 `commands.implement`；`planning`/`docs` 可缺省，缺省即不支持该动作；
- `.agents/implement-gate.json` 与 `.agents/state/implement-gate/**` **无论配置如何都视为 protected**；配置的 `protected` 只能追加，不能覆盖这两个默认路径；
- 配置路径必须是 workspace 相对路径，拒绝绝对路径、`..`、通配符；
- 正则无法编译 → `misconfigured`；未知配置键 → `misconfigured`。

### 3. 路径判定

- `codeRoots` 中的路径及其后代为 code；`codeFiles` 中精确路径为 code；
- code root 下的 `.md/.mdx/.txt/.rst/.adoc` 仍视为文档（保留当前行为）；
- 不在 code 边界内的路径为文档；
- `protected` 优先于 docs；marker/state 默认 protected 无条件优先；
- `proposed` 优先于 docs，只在 planning/implement 放行；
- 路径比较在 Windows 上大小写不敏感（`deepseek-harness`、`.GitHub` 等），macOS 也按大小写不敏感折叠；Linux 大小写敏感；
- **不做 realpath 后再分类**：`deepseek-harness` 是 workspace 内的链接，realpath 会把它解析到外部 checkout，反而把 codeRoots 判成文档。分类只用 workspace 相对的字面路径；realpath 只属于 shell-guard 的工作区外边界。

### 4. 命令匹配

`gateCommand` 从配置读取三条正则，仍只接受：

- owner 用户消息；
- 无 `principal`；
- SessionHeader `origin` 不是 subagent；
- 整条消息匹配。

不在配置中的动作不识别；例如没有 `commands.docs` 的项目不能设置 `docScope`。

### 5. 状态与配置读取

- 状态文件继续按 `(workspaceRoot, agent.id)` 保存；`agent.id` 即 SessionId，`docScope`、phase、work、task 不变；
- 配置**每次 pre-execute 按 workspace 根读取**，不做跨 workspace 缓存；同一插件实例服务多个项目时，A 的配置不能作用于 B；
- 配置修改不要求插件重载；下一次工具调用即生效；
- 配置变化不自动清空状态，`status` 显示 `configPath/configVersion` 以便核对。

### 6. Storycraft 配置

把当前硬编码值原样迁移到 `.agents/implement-gate.json`；行为保持不变。其他项目复制该文件并按自己的目录/命令修改。`deepseek-harness` 是指向外部 DSH checkout 的路径，迁移后仍必须列在 codeRoots，避免被 docsScope 当作文档。

## Alternatives considered

**A. 保持硬编码，只给 Storycraft 用。** 最强理由是零迁移、行为稳定。否决原因：其他项目一旦启用就会把源码当文档；插件名与 marker 暗示通用，实际不可用。

**B. 只配置 code roots，命令继续写死中文。** 最强理由是改动最小。否决原因：其他项目无法使用自己的 planning/implement 措辞；仍不是通用插件。

**C. 用文件扩展名自动区分代码/文档，不做配置。** 最强理由是零配置。否决原因：`.json/.yaml` 既可能是文档也可能是配置；无法可靠区分，反而扩大误判。

**D. 每个项目复制一份插件源码。** 最强理由是完全隔离。否决原因：逻辑重复，修复无法统一；配置化更小。

## Acceptance criteria

1. Storycraft 的 `.agents/implement-gate.json` 迁移为完整配置，现有 planning/implement/docs 行为不变（含 `使用implement` 无“技能”拼写）；
2. 临时项目 marker 配置 `codeRoots: ["src"]` 后，`src/x.ts` 需要 implement，`docs/x.md` 可由 docs scope 授权；
3. 无 marker、`enabled:false` 的项目完全 pass-through；
4. marker JSON 不可解析、缺 `enabled`、`enabled` 非布尔值、`enabled:true` 但缺 `codeRoots`/`commands.implement`、含绝对路径/`..`/通配符、正则非法、未知键 → `status` 返回 `misconfigured` 与原因，所有写拒绝；
5. 配置命令正则可识别 owner 整条消息；引用文档/问题文本/子代理消息不授权；缺少 `commands.planning/docs` 时该动作不可用；
6. `.agents/implement-gate.json` 与 state 默认 protected 无条件生效；配置 `protected`/`proposed` 追加生效，优先于 docs；
7. 两个不同项目可各用不同 code roots 与命令，互不影响；A 的配置不能作用于 B；
8. 配置每次按 workspace 根读取，不要求重载；修改后下一次工具调用即生效；
9. Windows 大小写变体（`.GitHub/x`、`DEEPSEEK-HARNESS`）仍判为 code/protected；
10. 现有 implement-gate 测试全部迁移并通过；新增配置校验、双项目隔离、无 marker、misconfigured、Windows 大小写用例；
11. `storycraft/scripts/ci.mjs --no-e2e` 通过；安装到 desktop profile 后 `status` 返回 `enabled/misconfigured/configPath/configVersion/phase/docScope`；
12. 更新 implement-gate README 与 AGENTS 中的配置示例，说明这不是 Storycraft 专用行为。

## Risks

- 配置错误会把所有写拒绝（fail closed）；需要 `status` 给出明确 `misconfigured` 原因；
- 配置中的正则来自项目文件，错误或过宽会改变授权语义；需要最小校验与测试；
- 旧 marker 只有 `enabled:true`；升级后必须迁移配置，否则进入 misconfigured；这是有意的失败关闭；
- `deepseek-harness` 是外部 checkout 的链接；codeRoots 只能阻止经 guard 的写入，真正的工作区外边界仍依赖 sandbox/shell-guard；
- 每次工具调用读配置带来少量 I/O；配置很小，优先保证多项目隔离与即时生效；
- Windows 大小写归一化必须覆盖 code/protected/proposed/scope 四处，漏一处就能用大小写变体绕过；
- 配置变化不会自动清除旧会话状态，可能保留旧 `docScope`；需要 `status` 可见，并在新 planning/implement 命令时清除；
- 其他项目可能不需要 docs/planning 命令；缺省动作不可用是预期行为，不是错误。
