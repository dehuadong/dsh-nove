---
title: 故事工坊：settler 自动投影与语义对账
status: implemented
created: 2026-10-23
updated: 2026-10-24
verification: 37 单测全过（含 state-settle/submission/tools/skills）；动作 32、all 11、review 3；docs check 通过；E2E 未跑
---

# Agent Note：故事工坊：settler 自动投影与语义对账

## 问题

R9b 的 `story_state_check` 能让主编在定稿前核对 delta，但 delta 仍由主编手写。R9b 的测量显示手写 delta 会漏记重要变化、把叙述归属记错、把数字和伏笔状态写走样；检查只是事后发现，主编还要自己把正文事实转成 delta。

R11 把这一步交给 settler 子代理：从本章正文抽取增量事实与伏笔变化，先过确定性预检，再过 R9b 语义检查；发现可重算的差异时带反馈重算一次，仍不一致就不自动定稿。`story_state` 保留为手动入口。

## 部分替代（2026-10-24）

[L-R10a 生产者/消费者迁移](../../proposed/pipeline/2026-10-24-storycraft-consumer-migration.md) 的 S3 **部分替代**本 Note 的 settler payload `{entities,hooks}` 与 `foldState` 的阶段/事件写入：v2 合同要求 hookOp/factOp 与 fact 有效期，旧 payload 无法表达。

保留：审稿→修订→摘要→settle 的闸门顺序、最多一次重算、未解决不写状态的失败策略。R11 的旧引用不进入新作品；S3 完成后本 Note 的 payload/foldState 部分以新 Note 为准。

## 参考实现

InkOS 在 Writer 的 `settleChapterState()` 里自动抽取状态，`StateValidatorAgent` 比较旧/新 state 与 hooks、正文和权威上下文；不一致时 `reconcileChapterStateAfterReview()` 带 observation 反馈重算一次，再校验一次。仍不一致时保留旧运行时状态、章节照常落盘并记录 observations；validator 不可用也保留旧状态。

我们借它的**位置与顺序**（抽取 → 校验 → 最多一次重算 → 未解决不写错状态），不复制它的 hookId、factOps expire、superseded 等对象；本实现的事实是 `entities[].facts[]`，伏笔以 `text` 精确文本为身份，只有 `opened` / `used` / `resolved`。

## 决定

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
→ 首次空 delta：跳过校验，foldState(allowEmpty) 只写 settle 事件并定稿
→ normalizeStateDelta + validateStateDelta：error 作为反馈，进入第 2 次
→ 用 R9b 的 story_state_check 校验候选 delta
   - 无 major：接受（minor 只作 warnings）
   - 有 major 或确定性 error：作为反馈，进入第 2 次
→ 第 2 次 settler（带反馈）
→ 再校验：仍有 major/确定性 error → settled:false，不写库，返回 proposed + items + reason
→ 被 major 拒绝后的第二次空 delta 也视为未解决，不静默接受空状态
→ 复核正文 revision 与事件序号；任一变化返回 state-settle-stale
→ foldState(proposed)：写 events、定稿
→ 返回 settled:true、revision、counts、warnings、attempts
```

- 只重算一次，不循环；不做后台任务。
- 安静章允许首次空 delta；被 major 拒绝后的第二次空 delta 不写库。手动 `story_state` 仍拒绝空 delta。
- 第 1 次校验只有 minor findings 时直接接受，不花第二次调用；minor 写进 `warnings` 与可选 `items`。
- 第 2 次仍 unresolved 时不写 events、不改阶段；返回 `settled:false`、`reason: state-reconcile-required` 或 `state-invalid`、`proposed`、`items`、`warnings`，供主编改用 `story_state` 手动修订。
- 基础设施失败：无服务 `state-settle-unavailable`、超时/异常 `state-settle-failed`、无合格提交 `state-settle-no-submission`、正文改版 `state-settle-stale`；这些都不写库，也不退化为「干净」或自动定稿。
- `foldState` 仍会二次校验阶段与闸门。

成功与未解决输出：

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
- settler 与校验之间、fold 之前都复核 revision 与事件序号；任一变化就 `state-settle-stale`，不写。
- 已定稿再次调用返回 `chapter-settled`；手动 `story_state` 的闸门与错误码不变（`statePreflight` 的额外正文检查只用于 `story_settle`）。

### 5. 入口与回退

- `story_next` 的定稿步骤改为返回 `action: story_settle`；主编优先自动结算。
- `story_state` 保留为手动入口：settler 未解决、作者明确要求手写、或自动链路不可用时使用。
- `storycraft-studio-orchestration` 与 `storycraft-longform-chapter` 的定稿步骤点名 `story_settle`，`story_state` 作为回退。
- 面板「定稿」固定指令改为「优先 `story_settle`；返回 `settled:false` 时把 proposed 与 findings 报给作者，按作者决定用 `story_state` 修正」。
- 失败或 unresolved 时不自动改正文、不自动重派、不跳过作者决定。

### 6. 测试与打包

新增 `tests/state-settle.test.mjs`，用临时 SQLite 与假 subagents：成功、首次空 delta、minor、major→重算成功、两次仍 major、两次 invalid、被 major 拒绝后的空重算、闸门、stale、无服务/超时/无提交/坏 payload、prompt 边界、技能路由。

- `state-settle.js` 加入 `package.json` 的 `files`；动作 31→32；`story_submit` 的 settler 形状与上限。
- `skills.test` 同步 `all` 11、`review` 3；`tools.test` 动作 32 与输出 schema。
- `client-instructions.test` 校验面板固定指令。
- README、对拍矩阵、路线图同步。

## 备选方案

- **保持手动 `story_state`，只保留 R9b check**：不会减少手写 delta 的错误，也不满足 R11 的自动投影；否决。
- **把 settler 直接塞进 `story_state`**：每次手写和自动混在一起，失败分支与写事务耦合，且无法在不写库时返回 proposed/findings；改为独立动作。否决。
- **writer/reviser 提交后立刻 settler，持久化候选**：需要新表、候选失效与迁移，且 review/revise/summary 期间正文还会变；改为定稿时按需运行。否决。
- **没有校验，直接 fold settler 输出**：会把 settler 的归属/漏记错误写进正史；必须复用 R9b。否决。
- **校验失败后循环重算**：成本不可控，且同一输入容易反复；只重算一次。否决。
- **照搬 InkOS 的 hookId / factOps expire / superseded**：本实现没有这些字段；改写会破坏既有状态机。否决。

## 后果

1. 定稿默认走 `story_settle`：settler 自动抽取、R9b 校验、一次反馈重算，减少主编手写 delta。
2. 首次空 delta 可以零 counts 定稿；被 major 拒绝后的第二次空 delta 不写库，避免静默接受空状态。
3. `story_state`、`story_delegate`、阶段机、落盘路径无行为变化；短篇、剧本不走自动 settler。
4. 最坏一次结算 2 次 settler + 2 次 validator；显式调用，不做后台或自动循环。
5. minor findings 被接受后仍可能有错；`missing-change` 不是完整抽取，`fact-ambiguous` 只是建议。
6. 事实只追加、不能撤回；settler 写错旧事实只能用后续事实覆盖或人工处理。
7. 与 InkOS 的差异：未解决时 InkOS 仍落盘章节、保留旧状态；我们未解决就不定稿，避免 `settled` 但状态未应用。

## 验证

- `node storycraft/scripts/ci.mjs --no-e2e`：37 个单测文件全过；新增 `state-settle.test.mjs`，既有 36 个不回归。
- `state-settle.test.mjs`：成功、首次空 delta、minor、major→重算、两次 major、两次 invalid、空重算 unresolved、闸门（正文/审稿/摘要/已定稿）、stale（revision 与 seq）、无服务/超时/无提交/坏 payload、validator 不可用、prompt 边界、技能路由。
- `submission.test.mjs`：settler 形状与 entities/facts/hooks 上限；`tools.test.mjs`：动作 32、输出 schema、子代理拒绝；`skills.test.mjs`：all 11、review 3。
- `node scripts/decisions/check.mjs` 通过。
- `package.json` 的 `files` 已包含 `state-settle.js`；README、对拍矩阵、路线图已同步。
- E2E 未跑：本机 Playwright/DSH 登录弹窗仍阻塞，不能声称 E2E 通过。
