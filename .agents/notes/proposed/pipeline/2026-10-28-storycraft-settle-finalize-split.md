---
title: 故事工坊：结算与定稿拆分
status: proposed
created: 2026-10-28
updated: 2026-10-28
---

# Agent Note：故事工坊：结算与定稿拆分

> 承接 [#82](https://github.com/dehuadong/dsh-nove/issues/82)。产品行为与验收归 #82；本 Note 拥有技术设计与实现边界。
> 部分替代 `2026-10-24-storycraft-bible-artifacts.md`、`2026-10-24-storycraft-consumer-migration.md` 中“settle 单动作完成状态与定稿”的描述；状态投影与对账语义不变。

## 问题

`story_settle` 把状态抽取、语义对账、定稿锁定绑在一个事务里（`state-settle.ts` → `settleState`）。真实链路（#50）里，结算超时或对账退回会卡住定稿；退回的 proposed 只能由模型手抄进 `story_state` 再重跑。

产品口径：定稿前事实可修正，定稿才冻结。因此**事实/伏笔事件只在定稿时写入**；结算只产草案。`reopen` 仍写它自己的 reopen 事件（阶段标记，不是状态真值）。

## 现状（代码位置）

- `settleState`（`store-db.ts:2651`）写事件、写 `settle`、置 `stage='settled'`；
- `story_state`（`tools.ts:1943`）直接调用它，因此也定稿；
- 正文 revision 递增点：`writeChapter`（`store-db.ts:1926-1939`）与 `reviseChapter`（`:2258-2265`），后者不写 reopen；
- `reopenChapter`（`store-db.ts:2998-3015`）写 reopen 事件（含 revision）、置阶段；
- 章节移/删：`moveChapter`/`deleteChapter` 经 `remapChapterArtifacts`（`artifact-store.ts:474-574`）重映射 plan/summary/review/trace，**不处理草案**；
- `assertStateGate`（`store-db.ts:2434`）校验审稿/摘要；
- `deriveWorkbench({next, manifest})`（`workbench.ts:73`）不读草案。

## 提案

### 数据

- **schema v13**：`chapters.state_ready_revision INTEGER NOT NULL DEFAULT 0`；旧库 `schema-version-mismatch`（无迁移）。夹具用 `initWork` 自建 v13，只有 `migration.test.mjs` 的硬编码版本号需改。
- 新 artifact kind `state_draft`，identity `^state:draft:([1-9]\d*):r([1-9]\d*)$`，且 **`chapterScoped: true`**（否则交叉校验时 `chapter` 为 undefined，恒失败）。
- **注册点四处**：`ARTIFACT_KINDS`、`ARTIFACT_IDENTITY`、`ARTIFACT_CONTENT_VALIDATORS`（实际名，`:608`），以及 `validateArtifactRecord` 里新增 artifactId↔content 交叉校验（现有 plan/summary/trace 同款，`:668`）。
- 与既有虚拟 `state`（events 文本，无 identity）不同 kind，不冲突；与立项 `proposals` 表无关。
- 内容：

```json
{
  "chapter": 1,
  "revision": 3,
  "factOps": { "upsert": [], "expire": [] },
  "hookOps": { "progress": [], "resolve": [], "mention": [], "defer": [], "supersede": [] },
  "newHooks": [],
  "findings": [{ "code": "", "where": "", "problem": "", "severity": "", "fix": "" }],
  "ready": false,
  "resolvedBy": null,
  "createdAt": ""
}
```

- 一致性与 stale：`chapter`/`revision` 必须与 artifactId 的章号、`r<revision>` 一致，且 `revision` 必须等于写入时章节 `current_revision`；比较对象是**正文 revision（content.revision / artifactId 后缀）**，artifact 的 `revisionId`（内容哈希）只用于读取钉版。
- 生命周期：草案在**定稿时删除**（消费）；`reopen`、**任何 current_revision 递增**（`writeChapter`、`reviseChapter`）都删除当前草案并把 `state_ready_revision` 清零，统一走 helper `invalidateStateDraftOnDb(db, chapter)`。**章节移/删**同样失效：移章时删除受影响章的草案（章号变了，identity 不再成立），删章时一并删除；两者都把对应章 `state_ready_revision` 清零。移/删本身仍只允许非已定稿章（现状）。

### 动作与状态转移

| 起点 | 动作 | 结果 |
| --- | --- | --- |
| 正文+摘要覆盖 rN | `story_settle` | 写草案；`ready=true`（对账通过）或 false + findings；`state_ready_revision=rN`；不写 fact/hook 事件。**零 ops 也写空草案（ready=true）**，供“本章无状态变化”的定稿路径 |
| 草案未就绪 | `story_apply_draft` | 草案 `ready=true`；`state_ready_revision=rN` |
| 定稿前 | `story_state` | 作者 ops 合并进草案（无则创建）；`ready=true`；`state_ready_revision=rN`；空 ops 且已有草案时允许（作者只清 findings） |
| 草案 ready 且覆盖 rN | `story_finalize` | 应用草案 ops（可为空）写事件 → 写 `settle` → 阶段 `settled` → **删除草案** |
| `settled` | `story_reopen` | 阶段 `written`；revision 不变；`state_ready_revision=0`；**删除草案** |
| 任意 | `writeChapter` / `reviseChapter`（新 revision） | `state_ready_revision=0`；删除草案 |
| 任意 | `moveChapter` / `deleteChapter` | 受影响章：`state_ready_revision=0`；删除草案 |

### `nextStep` 优先级

1. `blocked` 含 `revision-limit` → `story_revise`；
2. 当前 revision 有草案且 `ready=false` → `story_apply_draft`；
3. 草案 ready 且覆盖当前 revision，且 `assertStateGate` 通过 → `story_finalize`（含 ready 空草案）；
4. 草案 revision ≠ 当前 revision（防御；正常已被删除）→ `story_settle`；
5. 其余保持现有顺序（审稿 → 修订 → 摘要 → 结算）。

### 定稿的权威校验

`story_finalize` 依次：`assertStateGate`（审稿覆盖 + 摘要覆盖）→ `state_ready_revision == current_revision` → 草案存在且 `ready=true`。失败返回既有 `review-required` / `summary-required` / `summary-stale` 与新增 `state-not-ready`。

**空的判定留在结算侧**：是否允许零 ops 由 `settle` 决定（干净章、重开未改稿章都允许），`finalize` 只消费 ready 草案，不再判断 `wasReopened`/`allowEmpty`；这两个判定不搬迁，避免两边各判一次。

### `story_state` 合并语义

- 以 `(subject, predicate)` 为键，作者 ops **覆盖**草案同名事实；`expire` 追加；`newHooks` 追加；`hookOps` 追加。
- 作者写入即视为对 findings 的裁决：`findings` 清空（作者承担），写 `resolvedBy: "author"`；该字段已在 content schema 中声明。
- 摘要前置保持现状（当前工具先拦 summary），不在本工作项放宽。
- 空 ops：已有草案时允许（只更新 `resolvedBy`/`ready`）；无草案时空 ops 仍 `empty-state`。

### 超时与失败

- `state-settle.ts` 的超时回执（`:370/:384/:430/:448`）仍可能带 `proposed`/`warnings`/`items`：**有可用 ops（factOps/hookOps/newHooks 任一非空且 revision 匹配）就写草案（ready=false）**；否则不写草案，`story_next` 仍指向 `story_settle`；
- `state-invalid`（无论是否带 ops）：**一律不写草案**——非法 op 落了草案也会在定稿时反复失败；错误原样返回，作者改用 `story_state` 手写合法 ops；
- 作者可用 `story_state` 创建草案 → `story_finalize`，这是“结算失败但仍能定稿”的路径；
- 对账退回且带 ops：写草案（`ready=false`）→ `story_apply_draft`。

### 动作落点

新增动作必须同时接四处，另加三处文案：

| 落点 | 文件 |
| --- | --- |
| 工具注册与输出 schema | `tools.ts` 的 `action()` |
| 阶段分派 | `workbench.ts` 的 `deriveWorkbench` case |
| 客户端标签与处理器 | `client.ts` 的 step 标签表（`:903-913`）、章节动作处理器（`:2150` 一带） |
| 面板数据源 | `deriveWorkbench` 输入扩展 + manifest 章节投影 |
| 技能文案 | `skills/storycraft-longform-chapter/SKILL.md:39`、`skills/storycraft-long-director/SKILL.md:60`、`skills/storycraft-long-settle/references/state-projection.md:15`（其 `:38` 的“只有 settle 追加事件”也要改） |
| README | `README.md:22/:123/:142`（`:123` 的“定稿优先用 story_settle 自动结算 / 首次空 payload 可定稿”要改） |

漏 `workbench.ts` 的 case 会落进 default（表现为“写章纲”按钮）；漏 `client.ts` 的处理器则按钮点了没反应；漏技能文案则模型会跳过 `story_finalize`。

### 面板数据源

`deriveWorkbench` 输入扩为 `{next, manifest, state:{draft?:{ready:boolean, revision:number}}}`；manifest 章节投影新增 `stateReadyRevision`。禁用原因来自 `draft.ready`（缺草案或 `ready=false` → `state-not-ready`）。

### 错误码

| 码 | 触发 |
| --- | --- |
| `draft-not-found` | 无当前 revision 草案 |
| `draft-stale` | 草案 revision ≠ 当前 revision（防御路径） |
| `state-not-ready` | 定稿时无 ready 草案或 `state_ready_revision ≠ current` |
| `summary-required` / `summary-stale` / `review-required` | 沿用现有语义 |

## 备选方案

- **A. 结算即入账、定稿只锁定**：定稿前改稿留下不可撤销事件，AC6 不成立。**不采用**。
- **B. 只给 settle 加 `applyProposed` 参数**：不解决“结算失败卡定稿”。**不采用**。
- **C. 三动作 + 草案延迟入账、定稿消费草案（本设计）**。**采用**。
- 命名：`state_draft`，与立项 `proposals`、虚拟 `state` 均区分。

## 对拍参考

- 参考工程无此状态机（`packages/**/*.ts` 检索，见 #80 记录）；
- 对账与投影沿用 `state-check.ts` / `state-settle.ts`，本设计只改入账时点与草案生命周期。

## 风险

- 草案删除不可恢复：定稿后改状态必须 reopen → 重结算（刻意不变量）。
- `story_state` 语义变更影响 `client.ts:909-910`、`:971-973`、技能文案与 README。
- `reviseChapter` / 章节移删若不接失效逻辑，草案残留学且 `nextStep` 误判。
- 注册点漏一处会 `artifact-invalid`；漏交叉校验会放过 id/content 不一致。
- 零 ops 草案与“空 ops 一律 empty-state”的旧断言冲突：需更新 `state-v2-settle.test.mjs` 与 `state-settle.test.mjs` 的空 delta 用例。
- `revision-limit` 必须排在 apply/finalize 之前。

## 验收条件

- 单元：settle 干净/零 ops/退回/超时带 ops/超时无 ops；apply 三错误；finalize 前置 + 事件条数 + 草案删除；story_state 合并（resolvedBy）与空 ops；reopen/rewrite/revise/move/delete 清就绪并删草案；空草案可定稿。
- 集成：一章“结算 → 草案 → 接受/改状态 → 定稿”，事件只在定稿增加、草案消失。
- 面板 E2E：主按钮切换、禁用原因来自 `draft.ready`、接受草案出现条件、`story_finalize` 落到正确按钮与文案。
- 真实链路：#50 一章回归。
- `node scripts/decisions/check.mjs` 通过。

## 未决

- 无。实现细节（字段落列、kind 名、错误码）按本 Note；产品行为变化回到 #82。
