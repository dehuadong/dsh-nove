# Agent Note: 故事工坊：implement-gate 写前授权守卫

Status: implemented

工作项：当前任务 implement-gate（不新建 GitHub issue）。产品行为与验收归本 Note。

## Problem

`AGENTS.md` 与 `GATES.md` 已经规定：

- Planning 授权不包含实施；
- Implement 必须由 `批准，使用技能 implement 执行实现 {工作项}` 授权；
- 报告问题、提问、批准 Planning 都不构成实施授权。

但这些只是文档约束。实际执行里，代理可以在没有 implement 授权的 planning 阶段直接改 `client.ts`；等用户看到时，代码已经被改。靠“下次记住”或“哪些话不算授权”的措辞清单不可靠：用户换一种说法，代理仍可能再次误判。

需要一个工具层守卫：没有当前任务的 implement 授权时，写源码工具直接被拒绝，而不是靠代理自觉。

## 对拍参考

- `tools/shell-guard/index.js`：已有 Host 插件监听 `tools/pre-execute`，命中危险命令返回 `{kind:'deny', reason}`；本守卫复用同一模式与 workspace 边界。
- `docs/agents/GATES.md`：Implement 授权覆盖实施、Implementation Review、范围内修正与 Verify；Verify 没有独立授权。
- `deepseek-harness/packages/core/agent-loop/tests/interception.spec.ts:708-730`：`tools/pre-execute` 的 `deny` 会在工具 dispatch 前短路，模型收到 isError 结果。
- DSH `cordis_inspect_query` 的 `PreToolDecision` 还支持 `{kind:'ask'}`；当前会话审批提示关闭，缺 answerer 时 `ask` 会 fail closed 为拒绝，所以第一版不依赖审批提示。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 文档规定门禁 | 工具层拒绝无授权写 | 文档不能阻止调用 | 新增守卫 | 单元/真实调用 |
| shell-guard 只挡危险 shell | 同一 seam 扩展到 file/shell 写 | 复用已验证的 pre-execute 模式 | 等价扩展 | deny 回执 |
| 审批 seam 可问用户 | 第一版不启用 ask；用规范命令解锁 | 当前审批提示关闭，ask 会直接拒绝 | 暂不采用 | 配置说明 |
| 允许所有 shell | 只挡明显写动作，读/测试放行 | 不误伤诊断 | 收窄 | 分类测试 |

## Decision

### 包与挂载

新增 Host 插件 `tools/implement-gate`：

- `inject = ['tools']`；
- 监听 `agent/pre-step` 记录授权；
- 监听 `tools/pre-execute` 决定放行/拒绝；
- `cordis.patch.yml` 以 `implement-gate` 行挂载，与 `shell-guard` 同层。

### 授权来源

**命令模式**：只匹配**真实用户、整条消息**中的规范命令：

- `批准，使用技能 implement 执行实现 {工作项}`；
- `批准，使用implement 执行实现 {工作项}`（GATES 中存在的无“技能”拼写）；
- 归一化只做空白折叠，不做子串匹配；消息里引用文档、带前后说明、问句都不算；
- 只接受 `source.kind === 'user'`、**没有 `principal`**，且**当前 SessionHeader 的 `origin` 不是 `subagent`** 的消息：`principal` 排除跨会话/非 owner；子代理的 prompt 与 `send_message` 也可能是 `kind:'user'`，必须靠 `origin` 排除；历史 fork 的 `parentSession` 不单独视为子代理；schedule 的 source 是 `schedule`；
- 看到规范 planning 命令：撤销 implement，回到 planning；
- 其他任何消息不改变授权。

**审批模式**：新增守卫工具 `implement_gate`，`action: 'authorize'` 时调用 approval 服务，**请求的是“本任务后续源码写入”的任务级授权**，不是某一次写：

- `approval.request({ agent, toolName: 'implement_gate', reason, displayReason, signal })`；
- `allowed-once` → 记录本任务 implement 授权；
- `rejected` → 不下发授权，返回 `approval-rejected` 并提示可用规范命令（默认 `policy:'never'` 会静默返回 rejected，不能当成永久拒绝）；
- `cancelled` → 不下发授权，返回 `approval-cancelled`；用户仍可用规范命令；
- `unavailable`、服务缺失、无 open turn → 返回 `approval-unavailable`，提示改用规范命令；
- `approval.overrideOf(session) === 'never'` 只作为快速跳过；**不能依赖它判断配置默认值**，最终以 `request()` 的 outcome 为准；
- 授权请求的审计语义是任务级，不是“这一次写已批准”；不能把一次写审批伪装成长期授权。

**项目启用与会话状态**：

- 项目根存在 `.agents/implement-gate.json`（`{"enabled":true}`）才启用；无此文件完全 pass-through，不干扰其他项目；
- 状态按 `(workspaceRoot, sessionId)` 存放在 `.agents/state/implement-gate/<session-hash>.json`，并行会话互不共享，插件重载后从文件恢复；
- 状态机：`discuss`（默认）→ planning 命令 → `planning` → `implement_gate({action:'end-planning'})` → `discuss`；implement 命令/审批 → `implement` → `complete`；
- `discuss` 下源码和 `.agents/notes/**` 都拒绝；`planning` 只放行规划 Note；`implement` 放行源码与 Note；`complete` 源码拒绝、文档仍可写；
- `.agents/implement-gate.json` 与 `.agents/state/implement-gate/**` 是守护路径，模型不可写；状态由插件自己写。

- 无记录默认 `discuss`；
- 子代理不继承父授权；子代理没有对 owner 命令的检测能力，默认拒绝源码写入。

### 守卫工具

注册一个控制工具 `implement_gate`：

```json
{
  "action": "authorize | end-planning | block | complete | status",
  "reason": "string?"
}
```

- `authorize`：走审批模式；不可用时返回 `approval-unavailable`，命令模式无需调用；
- `end-planning`：planning 结束后显式回到 `discuss`，之后 Note 写也被拒绝；
- `block`：`work='blocked'`，源码写全部拒绝；
- `complete`：Verify PASS 且 Note/roadmap 迁移完成后结束任务；`complete` 之后文档写仍放行，源码写恢复拒绝；
- `status`：只读返回 enabled/phase/work/task。

该工具自身不受写守卫限制；`plugin_manager` 仍可禁用整个插件，这是本方案的残余风险（见 Risks）。

### 写操作矩阵

在 `tools/pre-execute` 中：

| 目标 | discuss | planning | implement | complete |
| --- | --- | --- | --- | --- |
| 源码/测试/脚本 | 拒绝 | 拒绝 | 允许 | 拒绝 |
| `.agents/notes/proposed/**` | 拒绝 | 允许 | 允许 | 拒绝 |
| 其他 `.agents/notes/**`、`docs/**`、根文档、skills | 允许 | 允许 | 允许 | 允许 |
| shell 写命令 | 仅非-proposed docs | 仅 docs-only | 允许 | 仅非-proposed docs |
| 状态/启用标记 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

文档与仓库治理绕过工程状态门禁：README、AGENTS、GATES、docs、skills、已归档/已实现 Note 在 discuss 与 complete 下也可写；只有 **propose 规划 Note** 仍要求 planning/implement。`trash.mjs`、`git add/commit/mv` 按目标路径分类，混入源码或 propose Note 时拒绝；`git push` 不改工作树，放行。工作区外写入始终拒绝。

Agent Notes 的 `proposed → implemented` 迁移是路径级例外：`write` 新文件、`edit` 状态/标题、`trash.mjs` 旧 Note 都不需要 implement 授权，也不会被 `complete` 之后误拦。`.trash/` 作为这些文档移动的目的地同样放行；只有源码/测试/脚本/配置路径受授权约束。

拒绝原因固定写明：

```
当前任务没有 implement 授权：你只批准了 planning。
需要先输入：批准，使用技能 implement 执行实现 {工作项}
```

### 合同变更与 blocked

守卫不能从代码/对话推断“合同要变”。代理发现合同/范围/重大设计变化时，必须主动调用 `implement_gate({action:'block', reason})`：

- `work='blocked'` 后，源码写全部拒绝；
- 允许读、诊断、写 blocker Note；
- 用户讨论后给新的 planning 或 implement 命令，`work` 复位为 `active`；
- 这是代理必须执行的步骤，守卫负责在标记后强制停止写入。

### 验证

- 单元测试纯决策函数：真实用户整条命令、引用文档/问题文本不授权、planning 撤销、路径分类、shell 写分类、blocked、complete、approval allowed/rejected/unavailable/never；
- `tools/implement-gate/test.mjs` 用 mock ctx/exec 覆盖 `tools/pre-execute` 与 `agent/pre-step`，并加入仓库 CI 的显式命令（不做手工验收）；
- shell 写分类至少覆盖：`Set-Content`、`Add-Content`、`Out-File`、`New-Item`、`Remove-Item`、`Move-Item`、`Copy-Item`、`Rename-Item`、`> `/`>>`、`git add`、`git commit`、`npm/pnpm install`、`node scripts/build.mjs`、`trash.mjs`；`node tests/*`、`git status`、读取/搜索放行；
- 安装到 desktop profile 后确认与 `shell-guard` 同时生效，读/测试不被误伤。

## Alternatives considered

**A. 只改文档、加措辞清单。** 最强理由是零代码。否决原因：这次已经证明措辞清单会被换说法绕过；文档不能阻止工具调用。

**B. 只依赖审批提示、不保留命令模式。** 最强理由是真正由用户批准，不解析命令。否决原因：当前会话审批提示关闭，缺 answerer 时全部写入不可用；必须保留规范命令作为无审批环境的回退。本方案用 `implement_gate authorize` 提供任务级审批，而不是每次写都弹。

**C. 只挡 `write`/`edit`，不挡 shell。** 最强理由是实现简单。否决原因：`pwsh` 可以写文件/提交，绕过守卫；至少挡明显写动作。

**D. 用 git pre-commit hook。** 最强理由是提交层统一。否决原因：代码已经被改，用户仍会看到工作树污染；门禁应在写前。

## Testing

- `tools/implement-gate/test.mjs`：纯分类/命令用例 + mock Host 用例，覆盖 discuss 拒绝源码和 Note、planning 放行 Note、end-planning 回 discuss、implement/block/complete、approval allowed/rejected、无 marker 项目 pass-through、复合命令、重定向、构建、docs-only git mv/trash、工作区外路径；
- 已安装到 desktop profile 后实测：无 marker 的其他 workspace 不拦截；本 workspace 无授权源码 `write` 被拒绝；docs `write` 与 `trash.mjs` 放行；`implement_gate status` 返回当前会话 phase；
- `storycraft/scripts/ci.mjs` 加入 `tools/implement-gate/test.mjs`，完整单元 CI 通过（94 文件）。

## Consequences

- 命令匹配是整条消息匹配，不做语义理解；用户换说法会被拒绝，这是有意的安全默认；
- shell 写分类只能覆盖明显模式，复杂脚本仍可能绕过；第一版优先保证 file 工具与常见写命令；
- `implement_gate block` 仍需要代理主动调用；守卫无法推断合同语义，只能在标记后强制停止；
- 状态按会话文件持久化，插件重载后恢复；文件丢失/损坏时回落到 discuss，不会放行源码；
- 项目 marker 与 state 文件在 workspace 内，必须依赖 guard 自身拒绝模型写；模型若通过复杂脚本/其他宿主动手仍可能绕过，属于分层防护的残余风险；
- 审批可用时第一次 `authorize` 会弹一次窗，明确请求“本任务后续写入”；审计的是任务授权，不是单次写；
- `approval.request` 依赖 open turn 与 answerer；不满足时只能回退命令，不能假装已批准；
- `plugin_manager` 仍可禁用守卫本身；若允许模型调用它，守卫无法自保，需在 preset/权限层限制；
- 命令来源依赖 `source.kind==='user'` 且无 `principal`；这是 owner 用户消息的约定，不能完全等同于“人在键盘前”。
