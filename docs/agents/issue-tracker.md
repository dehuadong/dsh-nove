# Issue 跟踪：GitHub（历史档案）

2026-10-31 起，本仓库的新提案/工作项使用 `.agents/notes/proposed/`，按 `write-agent-notes` 的 proposed 格式记录范围、验收、评审与批准证据；**不再新建 GitHub issue**。GitHub Issues 只保留历史工作项与关闭记录，排期以 `.agents/notes/proposed/process/2026-10-19-storycraft-roadmap.md` 为准。

历史 issue 位于 `dehuadong/dsh-nove`（私有仓库），只读使用 `gh` CLI；下文的创建/评论/关闭约定仅用于维护历史档案。

工作区需要配置指向该仓库的 git 远端，`gh` 才能在克隆内定位仓库；`gh auth status` 应显示已登录且令牌有 `repo` 权限。二者缺失时先在对话中讨论和起草，不要改用其他位置发布工作项。

## 约定

- 新建 issue：`gh issue create --title "..." --body "..."`；多行正文用 heredoc。
- 读取 issue：`gh issue view <编号> --comments`，并取标签。
- 列出 issue：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` / `--state`。
- 评论：`gh issue comment <编号> --body "..."`。
- 打标签：`gh issue edit <编号> --add-label "..."` / `--remove-label "..."`。
- 关闭：`gh issue close <编号> --comment "..."`。

## 工作状态

GitHub issue 没有内建工作状态。工作状态写在 issue 正文首行的 `Status:` 行：

| 状态 | 含义 |
| --- | --- |
| `planning` | 规划中，范围或验收未定 |
| `ready` | 规划内容通过、所需批准齐备、所选范围无阻塞 |
| `in-progress` | 已获执行授权，正在实施 |
| `complete` | 已交付并通过最终验证 |
| `rejected` | 决定不做，原因写在正文 |

工作状态与分诊标签是两套词汇，分诊标签见 [triage-labels.md](triage-labels.md)。

- Plan Review 结论与批准证据写进 issue 的决定部分或链接的评审评论。
- `ready` 需要适用的评审和批准齐备且没有阻塞；批准不授予执行授权，执行按工作区 `AGENTS.md` 的授权门禁判断。
- 就绪条件失效时把 `Status:` 改回 `planning`，记录阻塞原因，受影响工作回到讨论。
- 拒绝时写清原因并关闭 issue。

## Proposal 工作流

Proposal 是一个 GitHub issue，以 URL 或 `#编号` 标识。同一工作复用既有 issue，不同时创建远端 issue 与重复的本地 Proposal。Note 拥有长期设计时，从 issue 链接到 Note；跨工作项合同留在其登记位置。

## PR 作为请求入口

**PR 作为请求入口：否。**

外部 PR 不进入分诊队列；需要分诊的请求以 issue 提出。改为“是”时，PR 走与 issue 相同的标签和状态，用 `gh pr view` / `gh pr diff` / `gh pr comment` / `gh pr edit` / `gh pr close` 操作；issue 与 PR 共用编号空间，裸 `#42` 需先用 `gh pr view 42` 判断。

## 技能说“发布到 issue 跟踪器”时

按请求和登记的属主确定工作项与发布位置。已有工作项更新该 issue；只有确实需要新工作项时才新建。确认发布已被请求或已被授权，仅配置或 `ready` 状态不构成发布许可。没有工作项编号时先查相关既有 issue；归属不明时先解决再发布。

## 技能说“取相关工单”时

执行 `gh issue view <编号> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一个带 `wayfinder:map` 标签的 issue，**子工单**是它的 GitHub sub-issue。

- map：`gh issue create --label wayfinder:map`，正文写 Notes / 已定决定 / Fog。
- 子工单：用 sub-issues 接口挂到 map 下；不可用时在 map 正文的任务列表登记，并在子工单顶部写 `Part of #<map>`。标签 `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`；认领后指派处理者。
- 阻塞：用原生 issue dependencies 表示——`gh api --method POST repos/dehuadong/dsh-nove/issues/<子>/dependencies/blocked_by -F issue_id=<阻塞者数据库 id>`，数据库 id 由 `gh api repos/dehuadong/dsh-nove/issues/<n> --jq .id` 获取，不是 `#编号`。依赖不可用时退化为正文顶部的 `Blocked by: #<n>, #<n>`。
- 前沿查询：列出 map 的未关闭子工单，剔除有未关闭阻塞或已有指派者的，按 map 顺序取第一个。
- 认领：`gh issue edit <n> --add-assignee @me`。
- 解决：`gh issue comment <n> --body "<答案>"`，再 `gh issue close <n>`，最后把要点与链接追加到 map 的已定决定。
