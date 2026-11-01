# implement-gate

Host 插件：仅在已启用的项目里，按**会话**控制源码与规划 Note 的写入。

## 为什么存在

`AGENTS.md` 和 `docs/agents/GATES.md` 已经规定 Planning 授权不包含实施，但文档不能阻止工具调用。守卫在 `tools/pre-execute` 上返回 `deny`，文件在 dispatch 前就被拒绝。

## 项目启用

只有项目根存在：

```text
.agents/implement-gate.json
{"enabled": true}
```

才启用本守卫。没有该文件的项目**完全 pass-through**，不会被拦截，`implement_gate status` 返回 `enabled:false`。

该文件和 `.agents/state/implement-gate/` 是守护路径，模型不能通过 `write`/`edit`/shell 修改；状态文件由插件自己写。

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

`discuss` 是默认态：不写源码，也不写规划 Note；用户随口提问不会导致 Note 被改。Planning 结束通过 `implement_gate({action:'end-planning'})` 显式回到 discuss。

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
| 源码/测试/脚本 | 拒绝 | 拒绝 | 允许 | 拒绝 |
| `.agents/notes/proposed/**` | 拒绝 | 允许 | 允许 | 拒绝 |
| 其他 `.agents/notes/**`、`docs/**`、根文档、skills | 允许 | 允许 | 允许 | 允许 |
| shell 写命令 | 仅非-proposed docs | 仅 docs-only | 允许 | 仅非-proposed docs |
| 状态/启用标记 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

文档和仓库治理不经过工程状态门禁：README、AGENTS、GATES、docs、skills、已归档/已实现 Note 在 discuss 与 complete 下也可写；只有 **propose 规划 Note** 仍要求 planning/implement。`trash.mjs`、`git add/commit/mv` 按目标路径分类，混入源码或 propose Note 时拒绝。
- `git push` 不改工作树，放行；
- `implement_gate block` 冻结源码写，文档仍可写；
- `implement_gate complete` 结束任务，源码写恢复拒绝，文档仍可写。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件入口、项目启用、会话状态、`implement_gate` 工具、pre-execute 拦截 |
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
