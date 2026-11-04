# Agent Note: 故事工坊：architect 初始伏笔（R1b）

Status: implemented
Archived: 2026-11-04

工作项：当前任务（不新建 GitHub issue）。R1a 之后补 architect 的第五段产物 `pendingHooks`：初始伏笔随 foundation 一次播种进 v2 事件账本，成为可读、可确认、可消费的基础设定，不再等第一章结算补写。

## Problem

R0 裁决参考 architect 的 foundation 是**五段**，R1a 只落了四段：

- 参考 `ArchitectOutput` 含 `pendingHooks`（可读投影）与 `initialHooks`（结构化种子），`details` 阶段必须提交；
- 参考把 `story/pending_hooks.md` 列为 foundation 完整性的必需文件，缺它不算 ready；
- 我们此前没有任何 architect hooks 生产者：hooks 只由 settler 逐章 `newHooks` 产生，开书前的伏笔账本是空的，writer 的 brief/context 在第一章拿不到「作品中已埋但未兑现的承诺」。

R1a 已把「一个 child 四 phase + bundle 单事务」落好，本项只扩第五件产物与它的播种、完整性、消费者，不重开四段结构。

## Decision

### 1. `details` 提交合同

```ts
{ bookRules: BookRules, pendingHooks: InitialHook[] }

type InitialHook = {
  hookId: string        // 模型给的语义 id，非空
  type: string          // 伏笔类型，非空
  expectedPayoff: string// 预期回收，非空
  notes: string         // 可为空
  text: string          // 显示用一句话，非空
}
```

规则：

1. `pendingHooks` 必填，可为空数组；不设条数上限；
2. 每条对象的键必须恰为上面五个，出现 `status`/`startChapter`/`dependsOn` 等一律拒绝；
3. `hookId` 在本次提交内唯一（账本主键）；`text` 不要求唯一——显示串重复不影响按 id 消费；`hookId` 不做字符白名单；
4. 单 phase 仍受 64 KB 上限；校验失败按 phase 返回可重试错误，最多 3 次，不落任何产物；
5. `validateInitialHooks` 一份实现，`submission.ts`（提交时）与 `writeFoundationBundle`/`writeFoundationStage`（落盘时）共用。

### 2. 播种进事件账本

`writeFoundationBundle` 在同一事务内、artifact 记录之后调用 `seedFoundationHooksOnDb`：

- 每条种子写一条 `kind='hook', op='upsert'` 事件，`chapter=0`，记录为
  `{hookId, startChapter: 0, type, status: 'deferred', lastAdvancedChapter: 0, expectedPayoff, notes, text}`；
- 记录用 `validateHook` 全量校验后才插入，并同步 `search_docs`；
- 不经过 `applyHookOp`：settler 的 upsert 契约（新伏笔只能 `open`）保持不变，播种是独立的 authoring 入口；
- `pendingHooks: []` 时只写 artifact、不写事件——完整性由 artifact 判定，不靠「有事件」；
- 任一记录非法 → 整个 bundle 抛错回滚，不落 artifact、不落事件。

### 3. 第五件产物与完整性

- 新 artifact：`bible:hooks`，`kind='hooks'`，内容 `{ hooks: InitialHook[], markdown: string }`；
  `markdown` 为 `# 初始伏笔` + 表格：参考 `renderHooksProjection` 的七列（hook_id/起始章节/类型/状态/最近推进/预期回收/备注）再加一列 `text`（显示串）；起始章节与最近推进显示为「开篇」；
- `artifact-contract.ts`：`ARTIFACT_KINDS` 增 `hooks`，并加 `ARTIFACT_CONTENT_VALIDATORS.hooks` 与 `ARTIFACT_IDENTITY.hooks`（`bible:hooks`）；
- `store-db.ts` 的段清单 `FOUNDATION_STAGES = ['frame','rules','hooks','roles','cards']`；`FOUNDATION_STAGE_ARTIFACTS.hooks = ['bible:hooks']`；`FOUNDATION_WRITE_STAGES` 加 `hooks`（手动修复入口，`writeFoundationStage('hooks')` 只收 `{pendingHooks}` 并复用同一播种函数）；
- `writeFoundationStage` 的 hooks 分支只要求 `frame` 已完成（与 `rules` 同宽松）；不新增第五 phase，bundle 仍是四段；
- `roles/architect/contract.ts` 的阶段清单（`tools.ts` 的 `story_delegate.stage` 与 `foundationStage` 枚举来源）加 `hooks`；注意它与 store-db 的同名常量含义不同；
- `bible:hooks` 不进 `artifact-store.ts` 的 `FOUNDATION_DOCUMENTS` 名字表（那是 `story_bible`/`story_bible_write` 的入口，经它改 hooks 只会改 artifact、不播种事件）；只由 architect 种子与手动 `hooks` 阶段写，作者推进/回收走 dashboard 的状态转移；
- `readFoundationDocuments` 与面板 foundation 路由暴露 `hooks`，导出写 `foundation/hooks.md`（播种快照，当前伏笔仍在 `state/events.jsonl`）；
- `foundationRevisionOf` 指纹纳入 `bible:hooks`：重播种即失效作者确认；
- 面板：五个阶段格（新增「初始伏笔」）与文档行；确认闸门仍只在面板，模型调 approve 仍返回 `approval-moved`；
- 确认 ask 的逐段摘要多一条「初始伏笔：N 条」。

### 4. 重跑与差量

bundle 或手动 `hooks` 阶段都可以重跑。种子不能删事件，按 id 差量：

- 旧种子 → 新种子同 id：写一条 `op='upsert'` 事件，载荷是合并后的完整记录并带**当前状态**（`applyHookEvent` 对已有记录保留当前状态）；不走 settler 的 `hookUpsert`；
- 旧有新无：写 `op='supersede'` 事件（`chapter=0`），并校验 `HOOK_TRANSITIONS` 允许；
- 新有旧无：写 `op='upsert'`、`status='deferred'`；
- 种子归属看事件日志里是否存在该 id 的 chapter 0 upsert，而不是看上一份 artifact；新 id 命中非种子的既有 hook（如章节内 settler 铸的 `h-…`）→ 抛 `foundation-hooks-conflict`；
- 已被 supersede 的种子是退役 id：`HOOK_TRANSITIONS.superseded = []` 不允许复活，同 id 再加回抛 `foundation-hooks-retired`，由作者换 id；
- 重跑仍在一个事务内完成 artifact 替换 + 事件追加；失败全回滚。

### 5. 消费者

| 消费者 | 变化 |
|---|---|
| `brief` 的 `hooks` 段 | 无需改代码：播种的 deferred 在未解过滤内，开书后立即可见 |
| `context` 的 openHooks / directed refs | 同上；`startChapter=0` 不会被 `>= number` 误排 |
| 检索 | 播种的伏笔进入 openHooks 查询词与 hook 检索 |
| `dashboard` | 分组标题与详情徽标把 `startChapter=0` 显示为「开篇」；推进/回收仍需可写章 |
| 结算 `hookOps` | 种子 id 进入 baseline，可 progress/mention/defer/resolve/supersede |
| 面板基础设定 | 第五格 + 「初始伏笔」文档 |
| `story_read(kind='bible:hooks')` | 可读到播种快照；快照不进入子代理上下文装配，当前伏笔走 brief/context |

### 6. 方法归属

初始伏笔的方法归 architect，不归 planner：

- `storycraft-architect/references/foundation-design.md` 增「初始伏笔」段（从 `storycraft-long-outline/references/outline-design.md` 迁入）；
- `outline-design.md` 的「初始伏笔」段改为边界说明（计划文字只标承重伏笔的大致回收位置）；
- `storycraft-architect/SKILL.md` 的 details/hooks 合同、「不要做」与 `storycraft/README.md` 的 foundation 段同步。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect.ts:12`：注释「Architect owns the five-section persistence protocol」；`:307-316` 把 `details.pendingHooks` 映射为 `HookRecord[]`（`startChapter=0`、`lastAdvancedChapter=0`、`status='deferred'`）；`:341-342` 一并返回。
- `inkos-master/packages/core/src/agents/architect-tool.ts:25-34`：`details.pendingHooks` 为 `{hookId, type, expectedPayoff, notes}`，`hookId` 由模型给，无 text 字段。
- `inkos-master/packages/core/src/state/runtime-state-store.ts:25-41`：`createInitialRuntimeState` 以 `lastAppliedChapter: 0` 播种 hooks；`:160-167` 每次保存原子重写 `hooks.json` 与 `pending_hooks.md`。
- `inkos-master/packages/core/src/state/state-projections.ts:7-43`：`renderHooksProjection` 输出 `# 伏笔池` + 表格。
- `inkos-master/packages/core/src/utils/outline-paths.ts:11-23`：foundation 完整性必需 `story/pending_hooks.md`。
- `inkos-master/packages/core/src/agents/architect.ts:181-183`：只有 `mode==='init'` 重建 runtime state；`revise` 不重播 hooks（参考的弱点）。
- `inkos-master/packages/core/src/utils/hook-arbiter.ts:108-114`：章节内新 hook 由宿主铸 canonical id。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| foundation 五段，`pending_hooks.md` 是必需文件 | 五段，第五件是 `bible:hooks` artifact（JSON + 可读 markdown） | 运行时是 SQLite + artifact，不落文件；完整性按产物派生 | 采纳结构，等价适配 | bundle/完整性测试 |
| `pendingHooks` 字段 `{hookId,type,expectedPayoff,notes}` | 同四字段 + `text` | brief/context/dashboard 以 `text` 渲染伏笔 | 等价适配（新增字段，不裁剪） | schema 测试 |
| 模型给 `hookId`（语义 id） | 采纳；settler 的 `newHooks` 仍宿主 `mintHookId(text)` 铸 id | 参考也分两路：foundation 用模型 id，章节内用宿主 canonical id | 采纳 | 播种 + 结算测试 |
| 参考对 `hookId` 只要求非空，不查重 | 本次提交内 `hookId` 唯一 | 事件账本以 id 为主键，重复会互相覆盖 | 等价适配（登记约束） | 重复 id 测试 |
| 播种 `status='deferred'`、`startChapter=0` | 同 | 开书前是「已埋未推进」 | 采纳 | 投影测试 |
| 每次保存重写 `pending_hooks.md` 为当前投影 | `bible:hooks` 是**播种快照**；当前投影由事件派生 | 派生文档双写会与事件漂移；当前投影本就从事件折叠 | 等价适配，登记偏差 | 消费者测试 |
| `revise` 不重建 runtime state，旧 hooks 原样保留 | 按 id 差量 upsert / supersede，不删除事件 | 事件权威且不可删；删除会让章节 hookOps 引用悬空 | 采纳并补强参考弱点 | 重跑测试 |
| 章节内新 hook 由宿主铸 canonical id | 既有 `mintHookId(text)` | 不在本项范围 | 登记偏差 | 既有测试 |

## 与既有决定

- **部分取代** [R1a 多阶段提交](2026-11-02-storycraft-architect-multistage-runtime.md) 的「hooks 另立 R1b」：R1a 的四 phase/bundle/单 child 不变。
- **部分取代** [foundation 生产](../feature/2026-10-24-storycraft-foundation-production.md) §5「不生成 initial hooks」与其备选「沿用旧 text-hook 初始化」：当时否决的是把 hooks 写成 text 事件、并进 plan；现在是 v2 hook 事件（chapter 0、模型 id、deferred）+ artifact。
- **已否决的旧方案** [foundation 委派（已否决）](../../rejected/architecture/2026-10-23-storycraft-foundation-delegation.md) 保留「chapter 0 写入 + 展示为开书」两点；它的否决理由是产物压进 world/plan/characters，与本项无关。
- hooks 状态机、`mintHookId`、settler 的 `newHooks` 上限由 [state 迁移](2026-10-24-storycraft-state-migration.md) 与 `artifact-contract.ts` 拥有，本项不改。

## Alternatives considered

**A. 种子只写事件，不建 `bible:hooks` artifact。** 最强理由是少一件产物、少一处双表示。否决原因：`pendingHooks: []` 与「还没跑 hooks」无法区分，完整性判定只能另找标记（meta 列或新事件 kind），破坏「foundation 五段皆由产物派生」的一致性。

**B. 不播种，保留「初始伏笔等第一章结算再写」。** 最强理由是改动最小、不引入第二种 hook 创建路径。否决原因：参考 foundation 明确产出初始伏笔，开书前账本为空会让 writer 第一章拿不到已埋承诺；这是能力缺失，不是成本权衡。

**C. 把 `pending_hooks.md` 做成每次保存重写的派生 artifact。** 最强理由是与参考的「文件即当前投影」完全一致。否决原因：事件是权威，派生 artifact 必须在播种、结算、重开、删章/移章、作者手点推进等每条事件变更路径上同步刷新，漏一处就漂移；当前投影已由 `bible/context/dashboard` 从事件折叠得到。改为「artifact = 播种快照 + 当前投影走事件」。

**D. foundation hooks 也走 settler 的 `newHooks` 通道。** 最强理由是复用一套创建逻辑。否决原因：该通道要求 `chapter>=1`、`status='open'`、宿主铸 id，与「开书前、deferred、模型语义 id」三条都不符；放宽会污染章节内状态机约束。

**E. 一次提交把 hooks 放进 `outline` phase。** 最强理由是少改一段 payload。否决原因：参考把 hooks 归 details（与 book_rules 同段），outline 在 R1a 已用于 frame/volume。

## Testing

- `node storycraft/scripts/ci.mjs`：95 单元 + 49 E2E 通过（含新增 `foundation-hooks.test.mjs`；`dashboard.spec.cjs` 断言五个阶段格与「初始伏笔」标签）；
- `foundation-hooks.test.mjs`：五段完整性、空 hooks、重复 hookId、非法字段、bundle 回滚、重跑差量（状态保留 / supersede / 新增 / 退役 id）、brief/检索/dashboard 消费、结算按种子 id 推进、导出 `foundation/hooks.md`、章节伏笔 id 冲突；
- `foundation-production.test.mjs`：一个 child 四 phase → 五组 artifact、缺段/坏卡回滚、手动 `hooks` 阶段、design 只覆盖三段；
- `foundation-gate.test.mjs`、`panel-approval.test.mjs`、`story-approve.test.mjs`：五段完整性、ask 摘要、面板确认与预览含「初始伏笔」；
- `submission.test.mjs`：details 必带 pendingHooks、坏 hooks 可重提；
- `npm run verify-notes`：107 篇通过；
- 真实链路（真实 foundation → 第一章 brief → settle 推进）由作者在安装后验收。

## Consequences

- 面板四格变五格，`dashboard.spec.cjs` 的计数与标签同步；窄容器下五列更挤，靠容器查询换行兜底；
- `bible:hooks` 与当前投影是两种表示：前者是播种快照，后者是事件派生；导出只含快照，当前伏笔在 `state/events.jsonl`，读导出的人可能把快照当现状（已登记为偏差）；
- 模型给的 `hookId` 质量不可控，宿主只校验非空与本次唯一；
- 被移除的种子进入 superseded 终态、不能复活，同 id 加回会报 `foundation-hooks-retired`；
- 手动 `design` 仍只写 frame/rules/roles，单独跑永远不能让 foundation 完成，需配合 `cards` 与 `hooks` 两个手动阶段，或重跑 bundle；
- 64 KB 是单 phase 上限，hooks 与 book_rules 同段，大书规模需在真实链路观察；
- 播种多了一条 hook 创建路径（foundation 种子 vs settler newHooks），两条路径共用 `validateHook`，但状态语义不同（deferred vs open）。
