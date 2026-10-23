---
title: 故事工坊：settler 自动投影与语义对账
status: proposed
created: 2026-10-23
updated: 2026-10-23
---

# Agent Note：故事工坊：settler 自动投影与语义对账

## 问题

R9b 的 `story_state_check` 能让主编在定稿前核对 delta，但 delta 仍由主编手写。测量显示手写 delta 会漏记重要变化、把叙述归属记错、把数字和伏笔状态写走样；检查只是事后发现，主编还要自己把正文事实转成 delta。

R11 要做的是把这一步交给 settler 子代理：从本章正文抽取增量事实与伏笔变化，先过确定性预检，再过 R9b 语义检查；发现可重算的差异时带反馈重算一次，仍不一致就不自动定稿。`story_state` 保留为手动入口。

产品范围与验收由工作项拥有，不在这里。

## 参考实现

InkOS 在 Writer 的 `settleChapterState()` 里自动抽取状态，`StateValidatorAgent` 比较旧/新 state 与 hooks、正文和权威上下文；不一致时 `reconcileChapterStateAfterReview()` 带 observation 反馈重算一次，再校验一次。仍不一致时保留旧运行时状态、章节照常落盘并记录 observations；validator 不可用也保留旧状态。

我们借它的**位置与顺序**（抽取 → 校验 → 最多一次重算 → 未解决不写错状态），不复制它的 hookId、factOps expire、superseded 等对象；本实现的事实是 `entities[].facts[]`，伏笔以 `text` 精确文本为身份，只有 `opened` / `used` / `resolved`。

## 提案

### 1. 新动作 `story_settle`

在定稿步骤新增自动动作（只允许主会话调用）：

```text
story_settle(work, chapter)
```

流程：

```text
闸门：章未定稿、有正文、审稿覆盖当前版本且无未处理条目、阶段已修订或清稿、摘要 current
→ 读正文 revision、折叠前状态、摘要、章纲、delta 涉及的人物卡、baseline 事件序号
→ 第 1 次 settler 子代理（无反馈）
→ settler 返回空 delta：跳过校验，foldState(allowEmpty) 只写 settle 事件并定稿
→ normalizeStateDelta + validateStateDelta：error 作为反馈，进入第 2 次
→ 用 R9b 的 story_state_check 校验候选 delta
   - 无 major：接受（minor 只作 warnings）
   - 有 major 或确定性 error：作为反馈，进入第 2 次
→ 第 2 次 settler（带反馈）
→ 再校验：仍有 major/确定性 error → settled:false，不写库，返回 proposed + items + reason
→ 复核正文 revision 与事件序号；任一变化返回 state-settle-stale
→ foldState(proposed)：写 events、定稿
→ 返回 settled:true、revision、counts、warnings、attempts
```

- 只重算一次，不循环；不做后台任务。
- 安静章允许空 delta：settler 返回空时跳过语义校验，`foldState` 以 `allowEmpty` 只写 settle 事件；手动 `story_state` 仍拒绝空 delta。
- 第 1 次校验只有 minor findings 时直接接受，不花第二次调用；minor 写进 `warnings` 与可选 `items`。
- 第 2 次仍 unresolved 时不写 events、不改阶段；返回 `settled:false`、`reason: state-reconcile-required` 或 `state-invalid`、`proposed`、`items`、`warnings`，供主编改用 `story_state` 手动修订。
- 基础设施失败：无服务 `state-settle-unavailable`、超时/异常 `state-settle-failed`、无合格提交 `state-settle-no-submission`、正文改版 `state-settle-stale`；这些都不写库，也不退化为「干净」或自动定稿。
- `foldState` 仍会二次校验阶段与闸门。

输出形状：

```json
// 成功
{ "ok": true, "settled": true, "workId": "…", "chapter": 4, "revision": 5,
  "counts": { "entities": 2, "opened": 1, "used": 1, "resolved": 0, "open": 2 },
  "warnings": [], "items": [], "attempts": { "settler": 1, "validator": 1 },
  "artifact": { "workId": "…", "artifactId": "state", "revisionId": "seq:37", "kind": "state" } }

// 未解决
{ "ok": true, "settled": false, "workId": "…", "chapter": 4, "revision": 5,
  "reason": "state-reconcile-required", "proposed": { "entities": [], "hooks": [] },
  "warnings": [], "items": [], "attempts": { "settler": 2, "validator": 2 } }
```

- 成功时 `counts` 沿用 `foldState` 的计数；`items` 只含被接受的 minor findings。
- 未解决时 `reason` 是 `state-reconcile-required` 或 `state-invalid`；`state-invalid` 额外带 `message`。两种情况都不返回 `artifact`。

### 2. settler 子代理与技能

新增 `storycraft-state-settler` 技能（`review` 目录）：把本章正文投影成增量 delta，只写正文明确发生的事实与伏笔变化；不写正文、不做审稿、不写摘要。

`story_submit` 增加 `settler` 角色，payload 与 `story_state` 同形：

```json
{ "entities": [{ "name": "甲", "facts": ["一条可核对的事实"] }],
  "hooks": [{ "text": "账本里已有的伏笔原句", "state": "opened|used|resolved" }] }
```

- 事实只追加，不提供删除/过期；伏笔只使用账本已有 `text`，新伏笔用最终措辞；不把章纲当已发生事件。
- 上限：entities ≤ 30、每实体 facts ≤ 20、hooks ≤ 30；name/fact/hook text 各 ≤ 240 字；payload 仍受 64KB 限制。
- 子代理通过 `story_submit` 提交，最终只回「已提交」；不落盘、不调用 `story_state`/`story_settle`。

### 3. 校验与反馈

复用 R9b，不另造一套判断：

- settler 候选 delta 先过 `normalizeStateDelta` / `validateStateDelta`；确定性 error 直接作为反馈。
- 语义校验调用 `checkChapterState`（与 `story_state_check` 同一实现），得到 findings 与 revision。
- `major`（`fact-unsupported` / `missing-change` / `hook-state-mismatch`）触发第二次 settler；`minor`（`fact-ambiguous` / `hook-evidence-weak`）只记录，不阻断。
- 反馈文本列出 `code / where / problem / fix`，以及确定性 error 的 message；不让 settler 重写正文。

### 4. baseline 与幂等

- 不新增候选表、不改 schema：settler 在定稿时按需运行，不提前持久化候选。
- baseline 是本次读取的正文 `revision`、折叠前状态与事件序号；prompt 明确「只投影这版正文」。
- settler 与校验之间、fold 之前都复核 revision 与事件序号；任一变化就 stale，不写。
- 已定稿再次调用返回 `chapter-settled`；手动 `story_state` 的闸门与错误码不变。

### 5. 入口与回退

- `story_next` 的定稿步骤改为返回 `action: story_settle`；主编优先自动结算。
- `story_state` 保留为手动入口：settler 未解决、作者明确要求手写、或自动链路不可用时使用。
- 面板「定稿」固定指令改为「优先 `story_settle`；返回 `settled:false` 时把 proposed 与 findings 报给作者，按作者决定用 `story_state` 修正」。
- 失败或 unresolved 时不自动改正文、不自动重派、不跳过作者决定。

### 6. 测试

新增 `tests/state-settle.test.mjs`，用临时 SQLite 与假 subagents：

- 成功：settler 提交 delta → 校验无 findings → fold；events/stage 改变，返回 revision/counts/attempts。
- 空 delta：跳过 validator，只写 settle 事件，counts 为零；手动 `story_state` 仍拒绝空 delta。
- 只有 minor findings：直接 settled，warnings 含 minor，不启动第二次 settler。
- major findings：第二次 settler 带反馈；第二次校验通过后 settle；attempts 为 2/2。
- 两次仍 major：`settled:false`，events/stage/revision 不变，返回 proposed + items。
- 第一次确定性 invalid（如 `hook-not-open`）：反馈后第二次有效则 settle；两次 invalid 则 `settled:false, reason:'state-invalid'`，不写库。
- 闸门：缺正文、已定稿、未修订、无摘要/摘要过期、未处理审稿，均在启动子代理前拒绝。
- 无服务、超时、无提交、坏 payload：分别返回 `state-settle-unavailable` / `state-settle-failed` / `state-settle-no-submission`，不写库，不返回干净。
- 正文改版：`state-settle-stale`。
- settler prompt 含正文、baseline、折叠前状态；不含其他章正文或路径。
- `story_submit` 的 settler 形状与上限；动作总数 32；技能 `all` 11 / `review` 3；`story_next` 定稿步骤返回 `story_settle`，手动 `story_state` 仍可用。

## 备选方案

- **保持手动 `story_state`，只保留 R9b check**：不会减少手写 delta 的错误，也不满足 R11 的自动投影；否决。
- **把 settler 直接塞进 `story_state`**：每次手写和自动混在一起，失败分支与写事务耦合，且无法在不写库时返回 proposed/findings；改为独立动作。否决。
- **writer/reviser 提交后立刻 settler，持久化候选**：需要新表、候选失效与迁移，且 review/revise/summary 期间正文还会变；改为定稿时按需运行。否决。
- **没有校验，直接 fold settler 输出**：会把 settler 的归属/漏记错误写进正史；必须复用 R9b。否决。
- **校验失败后循环重算**：成本不可控，且同一输入容易反复；只重算一次。否决。
- **照搬 InkOS 的 hookId / factOps expire / superseded**：本实现没有这些字段；改写会破坏既有状态机。否决。

## 验收条件

1. `story_next` 在定稿步骤返回 `story_settle`；手动 `story_state` 仍可调用且行为不变。
2. 自动成功：settler + 校验 + fold 一次完成，返回 `settled:true`、revision、counts、attempts；不需要手写 delta；空 delta 也能以零 counts 定稿。
3. minor findings 直接 settled 并进 warnings；major findings 触发一次带反馈重算；第二次通过则 settled。
4. 两次仍 major 或两次确定性 invalid：`settled:false`，不写 events、不改 stage、返回 proposed 与 items/reason。
5. 闸门、stale、无服务/超时/无提交/坏 payload 都在正确边界失败，不产生半成品、不返回干净。
6. 不新增表/schema；既有 `story_state`、`story_delegate`、阶段机、落盘路径行为不变；36 个既有单测不回归。
7. 测试、README、对拍矩阵、路线图同步；动作 32、`all` 11、`review` 3。

## 风险

- 自动链路最坏 2 次 settler + 2 次 validator，成本和时延高于手动；由主编显式调用，不做后台。
- minor findings 被接受后仍可能有错；`missing-change` 不是完整抽取，`fact-ambiguous` 只是建议。
- settler 质量依赖模型与技能；dev 测试用假子代理，不能证明真实抽取正确；最终真实链路仍由作者验收。
- 事实只追加、不能撤回；settler 写错旧事实只能用后续事实覆盖或手动修库，需在作者可见处保留 warnings。
- 与 InkOS 的差异：未解决时 InkOS 仍落盘章节、保留旧状态；我们未解决就不定稿，避免 `settled` 但状态未应用。
- `story_next` 改自动动作会影响面板固定指令与既有测试；必须同步 `client.js`、README 与测试。
