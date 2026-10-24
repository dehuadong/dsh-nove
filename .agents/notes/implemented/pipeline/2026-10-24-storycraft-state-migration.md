---
title: 故事工坊：L-R10a S3 hooks/facts 迁移
status: implemented
created: 2026-10-24
updated: 2026-10-24
verification: hooks/facts v2 事件与 settle writer 已落地，CI 通过；证据见 #58。
---

# Agent Note：故事工坊：L-R10a S3 hooks/facts 迁移

## 问题

v2 hook/fact 事件与投影已由 #47 落地（[`storycraft/state-events.js`](../../../../storycraft/state-events.js)）：`fact.upsert`/`fact.expire`、hook 的 `upsert`/`progress`/`mention`/`defer`/`resolve`/`supersede` 与转移表都在，`projectState` 能重建投影。

但**没有任何生产者调用它**：settle 仍由 `foldState` 写旧 text-hook/string-fact（`entities`/`hooks` 形状），面板、brief、context、facts 白名单与检索都读旧 `foldEvents`。合同与运行分叉，同一份“当前状态”有两条互不相认的链路。

S3 把生产者与消费者整体切到 v2 事件，旧格式退出运行。

## 对拍参考

- `inkos-master/packages/core/src/agents/settler-tool.ts`：`SettlementToolSchema` 的 settlement 形状是 `factOps{upsert,expire}`、`hookOps{upsert,mention,resolve,defer}`、`newHookCandidates`（描述明确“Do not assign a hook id; the host assigns the canonical id”）与 `postSettlement`；结算与摘要同一次提交。
- `inkos-master/packages/core/src/models/runtime-state.ts`：`HookRecordSchema`（hookId/startChapter/type/status/lastAdvancedChapter/expectedPayoff/notes）、`CurrentStateFactSchema`（subject/predicate/object/validFromChapter/validUntilChapter/sourceChapter）、`StateManifest`（projectionVersion/lastAppliedChapter）。
- `inkos-master/packages/core/src/state/state-reducer.ts`：`applyRuntimeStateDelta` 校验后归约 snapshot，hooks/current_state/chapter_summaries 都是派生投影。
- `docs/report/inkos/01.md`：记录参考实现的弱点——事实是自由文本候选而非因果边，历史修订后下游状态不重算。
- 我们的裁决：
  - **采纳** op 化提交面、宿主铸造 hookId、事件为源/投影可重建。
  - **等价适配**：参考实现持久化 snapshot + manifest（projectionVersion/lastAppliedChapter）；我们以 `events` 表为唯一源，投影在读取时重建，不写 snapshot 文件。
  - **不采纳** `postSettlement` 与“结算顺带写摘要”：摘要生产已由 S2 的独立 summarizer 承担。
  - 参考实现的“下游不重算”是已知弱点，本项不复制；reopen 后的事件追加与投影重建由 settle 路径保证。

## 与既有记录

- 切片排序与 owner 由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本 Note 承接其中 S3。
- 事件形状、转移表、`hookId` 由宿主生成、fact 有效期与投影字段由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) §5 拥有；本 Note 只补“新建伏笔的提交面”（`newHooks`）与运行化路径。
- `state-events.js`（#47）拥有 op 校验与投影；本 Note 不改它的语义，只接生产者与消费者。
- [`2026-10-23-storycraft-settler-auto-projection.md`](../../implemented/pipeline/2026-10-23-storycraft-settler-auto-projection.md) 的闸门顺序（审稿→修订→摘要→settle）不变。
- [`2026-10-23-storycraft-longform-method-references.md`](../../implemented/pipeline/2026-10-23-storycraft-longform-method-references.md) 的“hook 三态、text 身份”在 L 交付时被合同 v2 §5 替代；S3 交付时同步该记录。
- observation/reviews 生命周期归 #52；本 Note 不改审稿链。

## 决定

### 1. 提交面

settler 与手动 `story_state` 使用同一形状：

```json
{
  "factOps": {
    "upsert": [{ "subject": "string", "predicate": "string", "object": "string", "source": "string?" }],
    "expire": [{ "subject": "string", "predicate": "string", "object": "string?" }]
  },
  "hookOps": {
    "progress": ["hookId"], "mention": ["hookId"], "defer": ["hookId"],
    "resolve": ["hookId"], "supersede": ["hookId"]
  },
  "newHooks": [{ "text": "string", "type": "string?", "expectedPayoff": "string?", "notes": "string?" }]
}
```

- `hookId` 由宿主铸造：`h-<sha1(text) 的前 8 位>`；同一 text 已存在时不新建，按 `mention` 记账。
- 限额：`factOps.upsert` ≤20、`factOps.expire` ≤20、`hookOps` ≤30、`newHooks` ≤8，各字符串字段 ≤240 字；手动与委派两个入口共用同一组限制。
- 空 payload（无任何 op 且无 `newHooks`）：委派提交面接受 `{}`（settler 可以报告“本章无可记录变化”），手动 `story_state` 返回 `empty-state`；`settleState` 的 `allowEmpty` 只给自动结算路径用。
- 每个 op 走 `state-events.js` 的 `applyHookOp`/`applyFactOp`：非法转移、未知 hookId、无可失效 fact 分别返回 `hook-transition-invalid`、`hook-not-found`、`fact-not-found`，**不写任何事件**。
- 旧形状（`entities`/`hooks`）不再出现在调用面：手动 `story_state` 由工具 schema 拒绝，委派提交返回 `submit-invalid`；不做翻译。

### 2. 单一 settle writer

- store 新增 `settleState(root, input)`：`assertStateGate`（审稿、摘要）→ 校验 ops → 按顺序追加 v2 事件（同一事务内同步检索文档）→ 追加 `settle` 标记 → 设 `stage='settled'` → 返回 `{counts:{facts, hooks, newHooks}, hooks, facts, seq}`；`counts` 按**实际写入的事件**统计，被 `allowReapply` 吞掉的 no-op 不计入。
- 自动 settle（`state-settle.js`）与手动 `story_state` 都调用它；`foldState` 删除，不再保留第二条 settle 路径。
- 模块边界：纯 op 校验与投影移到 store 可导入的模块（`state-projection.js`），`state-events.js` 保留面向 store 的 append 包装，避免 store 与 state-events 互相导入。
- `settle` 标记不是 v2 op 事件，仍按现有 `kind='settle'` 写入；`appendStateEvent` 的 hook/fact 限制不变。
- 重新 settle：reopen 不撤回既有状态事件；`settleState` 对“本章上次 settle 已被 reopen 作废”的路径传 `allowReapply`，同状态 hook op 与重复 fact upsert 视为幂等 no-op，其余非法转移仍然失败。
- 委派 settler 的落盘改调 `settleState`；提交校验换成 v2 形状，回执仍给计数与 `submissionAttempts`；`state-check`/`state-settle` 的 prompt 与 schema 同步改为 v2 ops，重试 `feedback` 说明不变。

### 3. 投影与消费者

| 消费者 | 切换 |
| --- | --- |
| `readFoldedState` / `foldedOf` | `projectState(readEvents(...))`；旧 `foldEvents` 退出运行 |
| `readWork` / `status` | folded 改为 `{facts, hooks}`（v2 形状）；状态计数按 hook status 计算 |
| 面板 `client.js` | 按 `subject` 分组 facts 渲染实体卡；hooks 显示 `status`/`text`/`lastAdvancedChapter` |
| brief 伏笔段 | 未解（open/progressing/deferred）hooks 的 `text`；resolved/superseded 不进入 |
| `context.js` 状态段 | facts 按 subject 分组；hooks 同上 |
| `facts.js` 白名单 | v2 facts 的 `subject`（hook 的 `text` 是句子，不进人名白名单） |
| 检索 hooks | `searchMemory` 读 v2 hook 事件与投影状态；旧事件忽略 |
| 导出 | `state/events.jsonl` 原样输出 v2 事件；不生成兼容投影 |

- 工具描述与编排技能同步：`story_state` 的参数说明、`storycraft-studio-orchestration` 的手动兜底段、README 的状态/伏笔说明都改为 v2 ops，删除 `entities`/`hooks` 旧形状，否则模型会继续提交旧 payload。

### 4. 边界

- 没有旧作品：事件只写 v2 合同，不读、不翻译合同外事件；测试作品删除重建。
- reopen 不撤回既有状态事件：状态是事件源的投影，重开只允许重写正文与重走审稿/摘要/settle；同一变更的重复提交靠 `allowReapply` 的幂等规则消化。
- 不生产 `state` artifact：事件是源，投影在读取时派生；artifact registry 里的 `state` kind 留给后续（R12 的 context/trace 与统一投影一起定），本项不写快照、不宣称 state artifact 有生产者。
- `threadRefs` 的 hookId 校验不在 S3：memo 渲染已展示引用，校验要等 hookId 合同稳定后另立。
- 不改 observation/reviews（#52），不改审稿阶段机。

## 备选方案

- **保留 `entities`/`hooks` 手动形状、宿主翻译成 op**：出现两套词汇，且翻译会丢有效期与状态机信息；否决。
- **child 自己给 hookId**：会伪造/冲突，参考实现也由宿主铸；否决。
- **保留 `foldState` 与 v2 并存**：双源，面板与 brief 会看到两个“当前状态”；否决。
- **reopen 时回滚该章状态事件**：事件日志是追加写，删改历史会破坏 seq 与检索；用 `allowReapply` 的幂等规则替代；否决。
- **写 `state` artifact 快照**：快照可重建但引入 revision/一致性合同，且没有消费者；S3 不做，留 R12。
- **迁移旧事件**：全项目不做旧作品迁移；否决。
- **结算顺带写摘要（参考实现方式）**：摘要归 S2 的独立 summarizer，合并会破坏阶段机的摘要前置；否决。

## 后果

hooks/facts 写 v2 事件；自动 settle 与手动 `story_state` 共用同一 writer。

## 验证

实际验证：state/settle 测试与 `ci --no-e2e` 通过；证据见 #58。

1. settler 与手动 `story_state` 只写 v2 hook/fact 事件；`entities`/`hooks` 旧形状被拒，错误码稳定。
2. `hookId` 由宿主铸造、同 text 复用；`progress`/`mention`/`defer`/`resolve`/`supersede` 按转移表更新投影；非法转移不写事件。
3. `settleState` 是唯一 settle 写入口；`foldState` 不再导出、无调用方。
4. `readFoldedState`/`readWork`/`status`/`brief`/`context`/`facts`/检索全部读 v2 投影；旧事件被忽略且不报错。
5. 面板展示从 v2 投影派生（facts 按 subject 分组、hooks 带状态），不读旧形状。
6. reopen 后再次 settle：`allowReapply` 让同状态 op 与重复 fact upsert 幂等，其余非法转移仍失败；计数正确。
7. 错误码覆盖 `hook-transition-invalid`/`hook-not-found`/`fact-not-found`/`state-op-invalid`/`empty-state`。
8. 工具描述、编排技能与 README 同步为 v2 形状，旧 `entities`/`hooks` 不再出现在调用面。
9. `state-v2-settle.test.mjs` 覆盖生产、转移、投影、消费者、旧事件忽略、reopen 重 settle；更新 `state-validation`/`state-settle`/`state-check`/`tools`/`delegate`/`context`/`facts`/`retrieval`/`bible`/`store-chapter`/`export` 中受影响断言；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
10. 不改 #52/observation；不迁移旧作品；不生产 `state` artifact。

## 风险

- 面板 folded 形状从 entities 改 facts，客户端渲染与文案要一起改；E2E 仍阻塞，只能靠单测与手动核对。
- 状态投影为空时面板要显示原因，不能静默显示零实体。
- hookId 用 text 哈希铸造：同 text 不同语义会被合并；`text` 改写不改 ID 是合同规定的，但会让作者误以为是新伏笔，需要提示。
- 手动 `story_state` 的调用面变化，工具描述、技能与 README 必须同步，否则模型会继续提交旧形状。
