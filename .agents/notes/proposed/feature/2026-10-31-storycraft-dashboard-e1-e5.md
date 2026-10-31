# Agent Note: 故事工坊：E1/E4/E5 看板

Status: proposed

工作项：当前任务 E1/E4/E5（不新建 GitHub issue）。产品范围与验收归本 Note。

## Problem

长篇作者目前要在多个标签间拼进度：

- `story_status` 只有计数和每章元数据，看不到伏笔明细；
- 待处理伏笔没有面板，作者只能读状态文本或在章节里找；
- 摘要是否存在、字数趋势、未处理审稿数散在章节/真值/导出页；
- 没有“先看全局，再点进具体章”的入口。

E1 要求“进度、待处理伏笔、未处理审稿的聚合视图”，E4 要求“伏笔按章分组、标记已用/已解”，E5 要求“每章摘要、字数趋势”。三者共享同一份看板数据，拆成三个主标签会把现有六个标签变成九个。

## 对拍参考

- `inkos-master/packages/core/src/agents/writer.ts:399-433`：参考工程把 `story/pending_hooks.md`、`story/chapter_summaries.md`、`state/chapter_summaries.json` 作为每章写作快照的一部分；
- `inkos-master/packages/core/src/agents/composer.ts:700-708`：上下文按 `chapter_summaries` 与 `pending_hooks` 的 id 取段；
- 参考没有独立的 Web 看板；它的数据源是 pending hooks 与 chapter summaries 两份状态产物。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| pending_hooks / chapter_summaries 状态产物 | 看板从 `readFoldedState` 与 `status` 聚合，不新增产物 | 现有投影已是权威；避免复制状态 | 等价适配 | `/dashboard` DTO |
| 每章写作快照含摘要/伏笔 | 每章摘要按需读取现有 `chapter?view=summary` | 不把摘要正文塞进状态 DTO | 收窄载荷 | 摘要抽屉 |
| 无独立 Web 看板 | 新增一个“看板”主标签，内含进度/伏笔/摘要三段 | 六标签已有信息架构，不扩成九标签 | 新增 | E2E |
| 无作者标记入口 | 看板 POST `/hooks/transition`，作者直接推进/解决 | 作者操作不经过模型回合 | 新增 | 路由测试 |

## Proposal

### 一个看板标签

现有主标签为：章节、真值、写前上下文、素材、导出、备份。新增 **看板** 作为第一个主标签，内部三段，不新增 E4/E5 独立标签：

1. **进度**：已写/已审/已定稿、未处理审稿、未解伏笔、字数趋势、调用成本摘要；
2. **伏笔**：只列未解（open/progressing/deferred），按 `startChapter` 分组；显示文本、状态、最近推进章；按钮“已用（推进）”“已解”；
3. **摘要**：每章摘要状态（current/stale/missing）、字数；点开按需读取摘要正文。

E1 的“未处理审稿”只显示计数与跳到章节；条目留在章节页，避免重复。E5 的摘要正文不进入看板 DTO，按需读取现有 `chapter?view=summary`。

### 数据

新增只读 Host 路由 `GET /api/see-storycraft/dashboard`：

- `status`: 现有 `readStatus`（字数、阶段、审稿数、成本、摘要状态计数）；
- `hooks`: `readFoldedState(root, work).hooks` 中未解项，字段 `hookId/text/type/status/startChapter/lastAdvancedChapter/expectedPayoff`；
- `transitionChapter`: 最新“已写且未定稿”章号，或 null；面板据此禁用按钮并显示原因；
- 不返回摘要正文、不返回未处理审稿明细；不新增模型工具，不扩 `story_status`。

### 作者伏笔操作

新增写路由 `POST /api/see-storycraft/hooks/transition`：

- body：`root`、`sessionId`、`workId`、`hookId`、`op`（`progress`|`resolve`）；用现有 `writeWorkTarget` 校验当前作品；
- 事件章取**最新“已写且未定稿”章**（`current_revision>0` 且 `stage!=='settled'`）；没有这样的章返回 `chapter-settled`，面板显示“先 reopen 当前章”；
- 事件章已有状态草案时返回 `state-draft-pending`，面板提示先接受/丢弃草案，避免作者事件与 finalize 重放冲突；
- 先读投影：若目标状态已达成且（`op!=='progress'` 或 `lastAdvancedChapter===chapter`），视为 no-op 直接返回看板；否则用 `applyHookOp(..., {allowReapply:false})` 校验并写事件；`progress` 在已 progressing 但新章时仍推进 `lastAdvancedChapter`，不冻结“最近推进章”；
- `progress` 的按钮文案为“已用（推进）”，`resolve` 为“已解”；`mention` 不作为作者操作；
- 只允许面板当前作品；错误沿用 `hook-not-found`/`hook-transition-invalid`/`chapter-settled`/`state-draft-pending`；
- 写成功后返回更新后的 dashboard，面板重新 `load()` 看板与顶部徽标，不只手改局部数字。

### 客户端

- `client.ts` 没有 `MAIN_TABS` 常量；实现时同步四处：默认 tab（`client.ts:1692`）、tab 顺序（`:2529/2540`）、标签映射（`:2546`）、帮助文案（`:3087`），新增 `dashboard`/“看板”作为第一个；
- 进度卡 + 章节字数条形；伏笔按章分组；摘要行展开时请求现有 `chapter?view=summary`，用抽屉展示并限制可视高度，不把摘要正文塞进看板 DTO；
- `post` 的错误对象补充 `code`（`client.ts:1023-1031`），面板用 `chapter-settled`/`state-draft-pending` 显示具体提示，不只显示 message；
- 现有六标签和它们的动作不变；更新 `workbench.spec.cjs:327` 的六标签断言与 `README.md:162` 的六标签说明；不引入前端框架或新构建步骤。

## Alternatives considered

**A. 三个独立主标签（E1/E4/E5）。** 最强理由是功能边界最清晰。否决原因：已有六个标签，九个标签使窄屏导航失真；E1 本来就是聚合视图，拆开会让“先看全局”多一次跳转。

**B. 把钩子明细直接加进 `story_status`。** 最强理由是复用模型可见工具和现有 schema。否决原因：作者面板数据会变成模型上下文，增大每轮 token；E4 的明细不属于模型决策输入。

**C. 伏笔标记也走模型 `story_state` 草案。** 最强理由是与既有状态写入同一条链。否决原因：作者点一个按钮不应启动模型回合；且当前章定稿后 `story_state` 也要求 reopen，语义不更简单。

## Acceptance criteria

1. 看板是第一个主标签；空作品、只有计划、已写多章都能渲染，不调用模型；
2. 进度段显示已写/已审/已定稿、未处理审稿、未解伏笔、每章字数与成本摘要；数字与 `story_status` 一致；
3. 伏笔段只列未解，按 `startChapter` 分组；标记“已用”写入 `progress`、“已解”写入 `resolve`，投影立即更新；最新“已写且未定稿”章缺失返回 `chapter-settled` 并给出 reopen 提示；有状态草案返回 `state-draft-pending`；重复点击同章同目标状态时 no-op；`progress` 在新章仍推进 `lastAdvancedChapter`；
4. 摘要段显示 current/stale/missing 与字数；展开时读取现有摘要正文，摘要正文不进入 `/dashboard`，抽屉限制可视高度；
5. `/dashboard` 是按 work 查询的只读面板数据（与 `/state` 相同，不强制 session 当前作品）；`/hooks/transition` 用 `writeWorkTarget` 只允许面板当前作品，并拒绝未知 hook/非法转移；
6. 现有六标签、动作、键盘/窄屏布局不回归；新增看板 E2E（计数、分组、标记后刷新/徽标、空状态、定稿拒绝、草案拒绝）；
7. 不改 schema、不新增模型工具、不扩大 `story_status`。

## Risks

- 伏笔操作依赖最新“已写且未定稿”章；全书定稿后作者需先 reopen 才能标记，这是状态冻结的代价；
- 有状态草案时拒绝标记，作者必须先处理草案；这避免了 finalize 重放冲突，但多一步；
- 看板读取投影与状态两次，作品很大时需要索引；沿用现有 F13 预算，不新增全表扫描；
- 摘要按需读取会多一次请求；看板首屏不加载摘要正文，避免大书首屏膨胀；
- 进度卡与 `story_status` 数字必须同源，避免两套计算漂移。
