# implement-gate

Host 插件：仅在已启用的项目里，按**会话**控制**代码文件**的写入；文档、普通 JSON/YAML、git 操作不进入代码门禁。

## 为什么存在

`AGENTS.md` 和 `docs/agents/GATES.md` 已经规定 Planning 授权不包含实施，但文档不能阻止工具调用。守卫在 `tools/pre-execute` 上返回 `deny`，文件在 dispatch 前就被拒绝。

## 项目启用

策略来自**会话工作区向上找到的最近** `.agents/implement-gate.json`：工作区根有 marker 就用它，子目录会话继承上级项目的策略；找不到 marker 的项目**完全 pass-through**，`implement_gate` 不出现在工具面。

初始化是作者的人类命令，在项目根会话执行：

```text
/implement-gate init
```

- 只在 marker 不存在时创建；已有 marker 返回「已存在」，不覆盖；
- 只在**工作区根就是项目根**时创建：祖先已有 marker、或祖先存在 `.git` 时拒绝并给出项目根路径，因此不会在子目录生成嵌套 marker；
- 生成默认 v2 配置：常见代码扩展名、`codePaths` 默认为空（需要拦执行入口的项目自行声明）、marker/state 默认 protected；不写 `commands`/`proposed`，命令使用代码默认值；
- 默认配置在写入前先用同一套校验器验证，不会留下导致全部写拒绝的半配置；不创建 state 文件，不授予 implement 授权。

命令是全局人类命令，出现在每个会话的 `/` 菜单；它不进入模型工具面，也不消耗模型步骤。

配置示例：

```json
{
  "enabled": true,
  "version": 2,
  "codeExtensions": [".ts", ".js", ".py", ".rs", ".go", ".sh"],
  "codePaths": ["package.json", "tsconfig.json", "cordis.patch.yml"],
  "protected": [".agents/implement-gate.json", ".agents/state/implement-gate"],
  "commands": {
    "planning": "^批准，使用(?:技能\\s*)?planning\\s+执行规划\\s+(.+)$",
    "implement": "^批准，使用(?:技能\\s*)?implement\\s+执行实现\\s+(.+)$",
    "docs": "^批准，执行文档治理\\s+(.+)$"
  }
}
```

- 没有 marker 或 `enabled:false`：pass-through，工具不可见；
- marker JSON 坏、`enabled` 非布尔、缺 `version:2`/`codeExtensions`/`commands.implement`、含绝对路径/`..`/通配符/未知键：`misconfigured`，**所有工具调用**被拒绝（fail-closed）；只有 `implement_gate status` 例外，用来返回原因与 marker 路径；
- `.agents/implement-gate.json` 与 `.agents/state/implement-gate/**` **无条件 protected**，配置只能追加；
- `codeExtensions` 之外的路径是文档；`codePaths` 只列执行入口（package/lock/tsconfig/cordis/CI workflow）；缺省为空，不默认拦配置文件；
- `commands` 是可选覆盖层：只写需要改的键，未写的键使用代码默认值；`proposed` 仍被接受但已弃用、不参与分类；
- `codePaths` 不带尾斜杠是精确文件，带尾斜杠是目录前缀；
- 配置按 marker 目录、每次调用读取；不同项目互不影响。

## 会话状态

状态按 `(marker 目录, sessionId)` 存放，跟 marker 同目录，子目录会话也不往子目录写：

```text
<marker 目录>/.agents/state/implement-gate/<session-hash>.json
```

每个会话一个文件，并行会话互不影响，插件重载后从文件恢复。状态：

```json
{
  "phase": "discuss | planning | docs | implement | complete",
  "work": "active | blocked",
  "task": "...",
  "blockReason": null
}
```

`discuss` 是默认态：不写代码，也不写文档/规划 Note；写文档需要 `批准，执行文档治理 {范围}`。`planning` 允许文档与 proposed Note、拒绝代码；`docs` 允许文档/notes、拒绝代码；`implement` 允许代码与文档。Planning 结束通过 `implement_gate({action:'end-planning'})` 回到 discuss；文档治理结束通过 `implement_gate({action:'end-docs'})` 回到 discuss；实现中发现范围外问题用 `implement_gate({action:'return-to-discuss',reason})` 回到 discuss，保留 task。

## 授权来源

- 真实用户整条消息中的规范命令：
  - `批准，使用技能 planning 执行规划 {工作项}` → planning；
  - `批准，使用技能 implement 执行实现 {工作项}` → implement；
  - `批准，执行文档治理 {范围}` → docs；
- `implement_gate({action:'authorize'})` 调用 DSH approval 服务，获得任务级批准；
- 审批不可用/被策略禁止/被拒绝时返回 `approval-unavailable`、`approval-disabled` 或 `approval-rejected`，回退规范命令。

命令匹配只看 owner 用户消息（`source.kind==='user'`、无 `principal`、SessionHeader `origin` 非 subagent），整条消息匹配，不做子串/语义近似。

`implement` 任务必须有工作项：同 topic 的 proposed Note，或 `mechanical:<说明>`。没有工作项时不进入 implement，保持当前 phase，并记录 `blockReason: work-item-required`；`proposed:` 前缀可显式指定 Note topic。机械任务不会被 complete 的 proposed 检查阻断。

## 行为

| 目标 | discuss | planning | docs | implement | complete |
| --- | --- | --- | --- | --- | --- |
| 代码文件（`codeExtensions`/`codePaths`） | 拒绝 | 拒绝 | 拒绝 | 允许 | 拒绝 |
| 普通文档/JSON/YAML/notes | 拒绝 | 允许 | 允许 | 允许 | 拒绝 |
| `git status/add/commit/push` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `git checkout/reset/clean` | 拒绝 | 拒绝 | 拒绝 | 允许 | 拒绝 |
| 状态/启用标记 | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

不按路径白名单判断文档；只有代码扩展名与 `codePaths` 进入 implement 门禁。`pwsh`/`bash` 只检查显式代码目标与重定向，不再把整条命令当代码写。

- `implement_gate block` 冻结代码写；
- `implement_gate complete` 结束任务，代码写恢复拒绝；任务仍有 proposed Note 时拒绝 complete；
- `implement_gate return-to-discuss` 从 implement/planning 回到 discuss，保留 task；
- `implement_gate end-docs` 仅 docs phase 可用，回到 discuss。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件入口、marker/策略解析、会话状态、`implement_gate` 工具（`when` 门控）、`/implement-gate init` 命令、pre-execute 拦截 |
| `config.js` | 定位 marker 与项目根，读取与校验 `.agents/implement-gate.json` |
| `classify.js` | 纯分类：命令、路径、shell 写动作 |
| `test.mjs` | 纯函数 + mock Host 用例（含子目录、`.git`、命令初始化） |
| `cordis.patch.yml` | 插入 `implement-gate` 行 |

## 验证

```powershell
node tools/implement-gate/test.mjs
```

安装：

```powershell
# 通过 plugin_manager install_bundle，target 指向本目录
```
