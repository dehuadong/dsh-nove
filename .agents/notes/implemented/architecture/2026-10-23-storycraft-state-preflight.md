# Agent Note: 故事工坊：状态预检与对账边界

Status: implemented


## 问题

`story_state` 是未校验的写入口：`foldState` 只检查实体/伏笔必填、`used` 是否指向未解伏笔，以及 summary/review/stage 闸门；它不检查重复事实、同一伏笔重复流转，也不检查 `resolved` 是否指向真实伏笔；已定稿章节还能被再次 settle，重复写 events。

InkOS 在 writer 提交后有状态投影与 StateValidator；本项先做**确定性、无 LLM 的预检**，语义对账（事实是否被正文支持）另列 R9b。

## 决定

### 1. 位置

预检放在 `foldState` 事务内、现有 summary/review/stage 闸门之后、任何 INSERT 之前：

```text
story_state → summary 前置检查 → foldState
  → 章存在 / review / stage / summary 闸门
  → normalizeStateDelta(delta)
  → validateStateDelta(normalized, foldedBefore)
  → 有 error：抛错，事务回滚，不写 events/chapters
  → 有 warning：继续 INSERT，返回 warnings
```

- 不新增 `story_state` 前置调用，避免预检与写库之间的 TOCTOU；
- `foldState` 仍是唯一写入口，`storage.foldState` 也自动获得校验；
- 纯函数 `normalizeStateDelta` / `validateStateDelta` 放独立 `state-validation.js`，避免 `store-db.js` ↔ `bible.js` 循环。

### 2. 检查项

| 项 | 类型 | 行为 |
| --- | --- | --- |
| 实体/伏笔空字段 | error | 保留 `invalid-entity` / `invalid-hook` |
| 已定稿章节再次 settle | error | 新增 `chapter-settled`，在闸门处 |
| `used` 指向已解伏笔 | error | 新增 `duplicate-hook` |
| `used` 指向不存在伏笔 | error | 保留 `hook-not-open` |
| `resolved` 指向不存在伏笔 | error | 新增 `hook-not-found` |
| 同一 payload 重复/倒退 hook 状态（重复 `used` 除外） | error | 新增 `duplicate-hook` |
| 同一 payload 重复事实 | warning | 新增 `duplicate-fact` |
| 事实已在旧投影 | warning | 同一 code，指出已存在 |

伏笔状态机（按 payload 顺序应用）：

- `opened`：新伏笔或已存在未解伏笔都允许，但同一 payload 重复 `opened` 报 `duplicate-hook`；
- `used`：要求当前状态为 `opened` 或 `used`（重复使用允许，对应“再次被提及”）；
- `resolved`：要求当前状态为 `opened` 或 `used`；已是 `resolved` 再 resolve 报 `duplicate-hook`；
- `opened → resolved` 同 payload 合法；`resolved → used/opened` 报 `duplicate-hook`。

不检查“人物名是否已登记”：`characters` 默认空、`facts.js` 的白名单规则更宽，硬检查会产生噪音；留给 R9b 的语义对账。

### 3. 返回

`foldState` 返回 `warnings: string[]`，沿用 `story_write` / `story_revise` 的既有形状：

```text
duplicate-fact: 甲 — 已知道真相
duplicate-hook: 门后的信
```

`story_state` 原样返回 `warnings`；`counts` 仍来自折叠后状态。失败抛 `StoryError`，无 warnings。

### 4. 测试

新增 `tests/state-validation.test.mjs`：

- 合法 delta：无 warning，events 增加，章 settled；
- 同 payload 重复事实、旧投影已存在事实：warning；
- 同 payload `opened → resolved`：合法；
- 重复 `opened` / `resolved → used`：`duplicate-hook`；
- `resolved` 不存在：`hook-not-found`；
- `used` 不存在：`hook-not-open`；`used` 已解：`duplicate-hook`；
- 已定稿再次 settle：`chapter-settled`，events/stage 不变；
- 错误路径不写 events；warnings 不影响 counts；
- 既有 `store-chapter` / `storage` / `summary-binding` / `tools` 测试全过；33 个单测文件全过。

### 5. 文档

- `story_state` 工具说明补 warning 形状；
- README「状态与伏笔」补 hook 生命周期与 `chapter-settled`；
- 对拍矩阵“状态对账”改为“确定性 preflight 子集”；R9b 登记语义对账；
- 路线图 R9 移到已交付，新增 R9b（语义对账，需 LLM 调用测量）。

## 与既有记录

- 补充 #40；路线图 R9/R9b；对拍矩阵“状态对账”。
- 不改变 #19 委派合同、#24/#25 摘要绑定。
- InkOS `state-validator.ts:28-97` 只借“提交后、定稿前检查”的位置；不复制 LLM 对账与自动重投影。

## 备选方案

- **直接接 LLM validator**：要额外模型调用、prompt、失败策略；先做确定性预检，测量后再开 R9b。
- **把检查放在 `story_state` 动作前置**：store-only 调用绕过校验，且与写库之间有 TOCTOU；否决。
- **检查人物名是否登记**：默认 characters 为空、白名单规则更宽；会产生大量误报，留给语义层；否决。

## 后果

1. 合法 delta 落库，无 warnings。
2. 同 payload 重复事实、旧投影已存在事实返回 `duplicate-fact`。
3. `opened → resolved` 与重复 `used` 合法；重复 `opened`/`resolved`、`resolved → used` 返回 `duplicate-hook`。
4. `hook-not-found` / `hook-not-open` 在写库前拒绝，events 与 stage 不变。
5. 已定稿章节再次 settle 返回 `chapter-settled`，不重复写 events。
6. summary/review/stage 闸门不回归；33 个既有单测全过。
7. `story_state` 工具说明与 README 同步。

## 验证

- `node storycraft/scripts/ci.mjs --no-e2e`：34 个单测文件全过。
- `state-validation.test.mjs`：重复事实、旧投影重复、`opened → resolved`、重复/倒退 hook、`hook-not-found`/`hook-not-open`、二次归档、失败不写 events。
- 既有 review/summary/stage 闸门回归通过；`store-chapter` 更新为二次归档拒绝。
- E2E 未跑：本机 Playwright 环境/登录弹窗阻塞。
- `package.json` 的 `files` 已包含 `state-validation.js`，按 files 列表复制后可加载。

- 交付证据：34 单测全过；state-validation 覆盖重复事实、伏笔状态机、二次归档；E2E 未跑

## 风险

- 确定性检查不能判断“事实是否被正文支持”；R9b 前不能宣称语义对账。
- 重复事实用字符串精确匹配，同义改写不报；这是接受的限制。
- warning 只回给主会话，不自动改稿；作者可忽略。
