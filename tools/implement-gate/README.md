# implement-gate

Host 插件：没有当前任务的 implement 授权时，拒绝源码写入。

## 为什么存在

`AGENTS.md` 和 `docs/agents/GATES.md` 已经规定 Planning 授权不包含实施，但文档不能阻止工具调用。守卫在 `tools/pre-execute` 上返回 `deny`，文件在 dispatch 前就被拒绝。

授权来源只有两种：

- 真实用户整条消息中的规范命令 `批准，使用技能 implement 执行实现 {工作项}`；
- `implement_gate({action:'authorize'})` 调用 DSH approval 服务，获得任务级的一次批准。

审批不可用/被策略禁止/被拒绝时，`implement_gate authorize` 返回 `approval-unavailable`、`approval-disabled` 或 `approval-rejected`，都退回规范命令。

## 行为

- `write`/`edit`：`.agents/notes/**`、`docs/**`、`.trash/**`、根 `AGENTS.md`/`GATES.md`/`README.md`、`tools/*/README.md` 始终放行；其他路径需要 implement；
- `trash.mjs`：Note/文档目标放行，源码目标拒绝；
- `git add`/`commit`：paths 或已暂存文件全在 notes/docs 时放行；混入源码时拒绝；
- `git push` 不改工作树，放行；
- 其他 shell 写动作（枚举在 `classify.js`）需要 implement；
- `implement_gate block` 后源码写拒绝，文档写仍放行；
- `implement_gate complete` 后源码写恢复拒绝，文档写仍放行。

命令匹配只看 owner 用户消息（`source.kind==='user'`、无 `principal`、SessionHeader 非 subagent），整条消息匹配，不做子串/语义近似。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件入口、状态、`implement_gate` 工具、pre-execute 拦截 |
| `classify.js` | 纯分类：命令、路径、shell 写动作 |
| `test.mjs` | 不依赖 Harness 的纯函数用例 |
| `cordis.patch.yml` | 插入 `implement-gate` 行 |

## 验证

```powershell
node tools/implement-gate/test.mjs
```

安装：

```powershell
# 通过 plugin_manager install_bundle，target 指向本目录
```
