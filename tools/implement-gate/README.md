# implement-gate

Host 插件：仅在已启用的项目里，按**会话**控制**代码文件**的写入；文档、普通 JSON/YAML、git 操作不进入代码门禁。

## 为什么存在

`AGENTS.md` 和 `docs/agents/GATES.md` 已经规定 Planning 授权不包含实施，但文档不能阻止工具调用。守卫在 `tools/pre-execute` 上返回 `deny`，文件在 dispatch 前就被拒绝。

## 项目启用

只有项目根存在 `.agents/implement-gate.json` 才启用本守卫。没有该文件的项目**完全 pass-through**，不会被拦截，`implement_gate status` 返回 `enabled:false`。

配置示例：

```json
{
  "enabled": true,
  "version": 2,
  "codeExtensions": [".ts", ".js", ".py", ".rs", ".go", ".sh"],
  "codePaths": ["package.json", "tsconfig.json", "cordis.patch.yml"],
  "protected": [".agents/implement-gate.json", ".agents/state/implement-gate"],
  "proposed": ".agents/notes/proposed",
  "commands": {
    "planning": "^批准，使用(?:技能\\s*)?planning\\s+执行规划\\s+(.+)$",
    "implement": "^批准，使用(?:技能\\s*)?implement\\s+执行实现\\s+(.+)$"
  }
}
```

- 没有 marker 或 `enabled:false`：pass-through；
- marker JSON 坏、`enabled` 非布尔、缺 `version:2`/`codeExtensions`/`commands.implement`、含绝对路径/`..`/通配符/未知键：`misconfigured`，所有写拒绝；
- `.agents/implement-gate.json` 与 `.agents/state/implement-gate/**` **无条件 protected**，配置只能追加；
- `codeExtensions` 之外的路径是文档；`codePaths` 只列执行入口（package/lock/tsconfig/cordis/CI workflow）；
- `codePaths` 不带尾斜杠是精确文件，带尾斜杠是目录前缀；
- 配置按 workspace 根、每次调用读取；不同项目互不影响。

## 会话状态

状态按 `(workspaceRoot, sessionId)` 存放：

```text
.agents/state/implement-gate/<session-hash>.json
```

每个会话一个文件，并行会话互不影响，插件重载后从文件恢复。状态：

```json
{
  "phase": "discuss | planning | implement | complete",
  "work": "active | blocked",
  "task": "...",
  "blockReason": null
}
```

`discuss` 是默认态：不写代码文件，也不写规划 Note；普通文档、JSON、YAML、git 不受影响。Planning 结束通过 `implement_gate({action:'end-planning'})` 显式回到 discuss。

## 授权来源

- 真实用户整条消息中的规范命令：
  - `批准，使用技能 planning 执行规划 {工作项}` → planning；
  - `批准，使用技能 implement 执行实现 {工作项}` → implement；
- `implement_gate({action:'authorize'})` 调用 DSH approval 服务，获得任务级批准；
- 审批不可用/被策略禁止/被拒绝时返回 `approval-unavailable`、`approval-disabled` 或 `approval-rejected`，回退规范命令。

命令匹配只看 owner 用户消息（`source.kind==='user'`、无 `principal`、SessionHeader `origin` 非 subagent），整条消息匹配，不做子串/语义近似。

## 行为

| 目标 | discuss | planning | implement | complete |
| --- | --- | --- | --- | --- |
| 代码文件（`codeExtensions`/`codePaths`） | 拒绝 | 拒绝 | 允许 | 拒绝 |
| 普通文档/JSON/YAML | 允许 | 允许 | 允许 | 允许 |
| `.agents/notes/proposed/**` | 拒绝 | 允许 | 允许 | 拒绝 |
| `git status/add/commit/push` | 允许 | 允许 | 允许 | 允许 |
| `git checkout/reset/clean` | 拒绝 | 拒绝 | 允许 | 拒绝 |
| 状态/启用标记 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

不按路径白名单判断文档；只有代码扩展名与少量执行入口 `codePaths` 进入 implement 门禁。`pwsh`/`bash` 只检查显式代码目标与重定向，不再把整条命令当代码写。

- `implement_gate block` 冻结代码写；
- `implement_gate complete` 结束任务，代码写恢复拒绝；
- `implement_gate end-docs` 返回 `not-supported`；文档不再需要范围授权。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件入口、项目启用、会话状态、`implement_gate` 工具、pre-execute 拦截 |
| `config.js` | 读取与校验 `.agents/implement-gate.json` 项目策略 |
| `classify.js` | 纯分类：命令、路径、shell 写动作 |
| `test.mjs` | 纯函数 + mock Host 用例 |
| `cordis.patch.yml` | 插入 `implement-gate` 行 |

## 验证

```powershell
node tools/implement-gate/test.mjs
```

安装：

```powershell
# 通过 plugin_manager install_bundle，target 指向本目录
```
