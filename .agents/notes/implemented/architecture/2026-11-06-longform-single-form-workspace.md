# Agent Note: 故事工坊：长篇单形态工作区与会话面板

Status: implemented

工作项：修正长篇复刻的工作区、预设、面板与会话绑定。它由三个能力组成，按“一次一个能力”交付：

- 新增 `workspace.single-form`：工作区只承载一种形态，预设声明形态并校验；
- 修订 `runtime.session-binding`：会话绑定一部作品后不可原地换绑；
- 修订 `panel.workbench`：长篇面板从侧边栏迁到会话顶部 `[会话] [轨迹] [长篇面板]`。

## Problem

当前实现有三处结构性问题：

1. 一个工作区可以同时存在长篇、短篇、剧本作品，`story_init` 接受任意 form；面板也按 form 分支，导致“工作区形态”没有单一权威。
2. `session_current` 可在同一会话内改指另一部作品；前半段对话在 A，后半段工具调用落到 B，会串作品。
3. 面板是侧边栏/右侧 tab，全局可见；它不是会话级，也没有绑定当前预设与工作区。

源工程的形态边界是 profile 级：`longform-novel`、`short-fiction`、`script` 是不同 profile；会话绑定决定 work。复刻需要把这条边界显式化。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/builtin-profiles.ts:15-33` | 长篇、短篇、剧本各自是 profile，required skills/artifact kinds 不同 | 采纳“形态由 profile 区分”；复刻当前只交付长篇预设，短篇/剧本后续独立预设 |
| `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话由 sessionKind/bookId 绑定 profile 与 work | 等价适配：复刻按工作区 form + 会话绑定 work；DSH 没有 sessionKind 枚举 |
| `inkos-master/packages/core/src/harness/contracts.ts` 的 WorkProfile | profile 声明能力、技能与产物 | 复刻用预设声明 `form`，工作区保存 form，二者必须一致 |

## Decision

### 1. 工作区形态（`workspace.single-form`）

- `catalog.db` 增加 workspace 级元数据：`form`（当前 `longform`）与首次使用的 preset id；
- 预设声明 `form`；打开工作区时若 `workspace.form` 与 preset.form 不一致，返回 `workspace-form-mismatch`；
- 首次 `story_init` 时把 preset.form 写入工作区；之后固定；
- 同一工作区可有多部作品，但全部同 form，一作品一库；
- `story_init` 不再接受 form 参数；跨 form 调用拒绝；
- 不做旧作品迁移；插件开发工作区与测试工作区都重建。

### 2. 会话绑定（`runtime.session-binding`）

- `session_current` 改为一次性绑定：`sessionId → workId`；
- 未绑定会话第一次选作品时写入；
- 已绑定会话在面板点击另一作品时**不改 current**：
  - B 已有同工作区、同预设会话 → 打开该会话；
  - 没有 → 通过 `sessionController.create({ cwd, agentPreset })` 新建会话，再 `uiWorkspace.openSession` 打开；
- A 会话保持 A；
- 显式 `work` 只允许当前工作区、当前 form，不能跨；
- 删除当前作品清绑定。

### 3. 长篇面板（`panel.workbench`）

- 移除侧边栏/右侧 tab 注册；
- 注册 `conversation.view`：id `longform`、label `长篇面板`、order 排在 `会话`、`轨迹` 后；
- 会话级，只列当前工作区的长篇作品；
- 当前作品高亮；未绑定会话要求先选作品；
- 不提供跨工作区、跨形态切换；
- 短篇、剧本未来各自注册独立 view，不共享该组件。

### 4. 预设边界

- 当前只交付长篇预设，声明 `form: longform`；
- 短篇、剧本各自独立预设、面板与工作区，后续能力行交付；
- 长篇面板不出现 form 切换控件。

## Capability ledger 变更

- 新增 `workspace.single-form`（status `missing`）；
- `runtime.session-binding` 的标题与验收改为“工作区 + 预设 + 不可改绑的作品绑定”；
- `panel.workbench` 的标题与验收改为会话级 `[长篇面板]`；
- `docs/scope.md` 的 D0/D1/D6 节点同步。

## Alternatives considered

**保留 `session_current` 可改绑，并在切换时清空上下文。** 最强理由是同一会话可换作品；但对话历史、章纲与审阅记录无法按作品切分，清空也会破坏连续性，故不采用。

**一个工作区只允许一部作品。** 最强理由是绑定最简单；但作者会在同一形态下开多部作品，强制拆工作区会让预设/面板绑定变成工作区目录管理，故不采用。

**继续用侧边栏全局面板。** 最强理由是现有代码已可用；但面板不随会话/预设变化，无法表达“当前长篇工作区”，故不采用。

## Consequences

- `workspace.single-form`：工作区 form 首次写入后固定，跨 form 初始化返回 `workspace-form-mismatch`；
- `runtime.session-binding`：会话绑定一部作品后不可原地改绑，点另一作品打开/新建目标会话；
- `panel.workbench`：`[长篇面板]` 仅限 storycraft 预设 + 作品工作区，标准预设不注册；
- 三个能力各有 consumer 与真实回执；面板内容仍复用现有工作台，短篇/剧本后续拆分。

## Verification

```text
node storycraft/scripts/ci.mjs --no-e2e   # PASS
npm run verify                            # 19 verified / 21 missing
npm run check-fidelity-audit              # 40 audited, 19 verified
```

## Risks

- `sessionController.create` 与 `ctx.uiWorkspace.openSession` 已在 DSH 中存在（`client/ui-chat` 用它打开 child session）；仍需在实现时确认当前 client 插件注入面是否可取得 `uiWorkspace`，不可用时登记为保真债；
- 现有 `story_init` 调用方可能仍传 form；需在 schema/校验层拒绝并更新测试；
- 删除作品/清理绑定的路径多，漏一处会把动作指向已删除作品；
- `conversation.view` 是全局注册；短篇/剧本后续独立 view 时需避免多个面板同时显示。
