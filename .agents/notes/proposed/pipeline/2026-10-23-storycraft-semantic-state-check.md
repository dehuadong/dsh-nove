---
title: 故事工坊：语义状态对账（只读检查）
status: proposed
created: 2026-10-23
updated: 2026-10-23
---

# Agent Note：故事工坊：语义状态对账（只读检查）

## 问题

R9 的 `state-validation.js` 只做确定性检查：重复事实 warning、伏笔状态机、二次归档拒绝。它无法判断一条事实是否被本章正文支持、伏笔状态是否被正文推进，也无法发现正文里发生的重要变化没有写进 delta。

2026-10-23 对 `works/大朔营造` 的三章做了小样本核对（见「测量」）：这些 delta 都已通过 R9 预检并落库，但仍有 6 条事实不支持、2 条伏笔状态错误，每章还有 3 条以上重要变化没有记录。确定性层全部放过，说明语义对账不是重复劳动。

产品范围与验收由工作项拥有，不在这里。

## 测量

方法与样本：

- 作品：`works/大朔营造`（legacy 文件作品，11 章已写、9 章已定稿）。
- 样本：第 1 章 r2、第 4 章 r5、第 8 章 r4；各取该章 `state/events.jsonl` 的 entity/hook 记录。
- 判定：每章一个只读核对子代理，逐条判断「正文明确支持 / 正文矛盾或没有 / 只能推断」，并另列 3 条未记录的重要变化；不做改写。
- 限制：单作品、3 章、每章单次判定、无第二评判者；结果只说明方向，不是总体比例。

| 指标 | 第 1 章 | 第 4 章 | 第 8 章 | 合计 |
| --- | --- | --- | --- | --- |
| 事实 | 14 支持 / 3 不支持 / 4 模糊 | 21 / 3 / 2 | 18 / 0 / 5 | 53 / 6 / 11（70 条） |
| 伏笔 | 3 支持 / 0 不支持 / 2 模糊 | 3 / 2 / 2 | 7 / 0 / 1 | 13 / 2 / 5（20 条） |
| 未记录的重要变化 | 3 | 3 | 3+ | 每章至少 3 条 |

错误类型集中在：说话人归属（谁说的、谁做的）、给人物加了正文没有的动机、数字/人数/引语走样、伏笔状态该 `resolved` 却记成 `used`、重要变化漏记。它们都能通过实体名与字符串检查，只有语义判断能发现。

同时，三章里有大量合法的归一化（「自称能磨」「用掉一份」「少两块半」）；如果按严格字面判断，会把它们误报成错误。因此结果必须是**建议性**的，且允许「模糊」而不是强行二分。

## 提案

### 1. 只读动作 `story_state_check`

新增一个只读动作，输入与 `story_state` 相同的 delta：

```text
story_state_check(work, chapter, entities?, hooks?)
```

流程：

```text
只允许主会话调用；子代理调用返回 state-check-parent-denied
→ validate 参数（entities/hooks 至少一项；空 delta 返回 empty-state）
→ 章存在、有正文、未定稿（chapter-not-written / chapter-settled）
→ normalizeStateDelta
→ validateStateDelta(foldedBefore)：有 error 直接返回，不启动子代理
→ 记录正文 revision
→ 读当前正文、当前摘要（若 current；不要求摘要先存在）、章纲（缺失则省略）、delta 涉及的人物卡（缺失则省略）、折叠前状态
→ 启动一个 validator 子代理
→ 子代理通过 story_submit 提交 findings
→ 父代理复核正文 revision 未变；变了返回 state-check-stale
→ 返回紧凑 items；不写 events、不改阶段、不写摘要
```

上下文只带核对必需的部分：delta 里出现的人物的旧事实、全部未解伏笔与 delta 引用的伏笔、delta 里出现的人物的卡、当前章纲与当前摘要；不把其他章正文或整库倒进 prompt。

输出：

```json
{
  "ok": true,
  "workId": "…",
  "chapter": 4,
  "revision": 5,
  "checked": true,
  "items": [
    {
      "code": "fact-unsupported",
      "where": "霍七",
      "problem": "正文里挡住偷绳的人是韩松",
      "evidence": "「松手。」韩松说",
      "impact": "把功劳记到错误的人，后续关系与名册会跟着错",
      "severity": "major",
      "fix": "改记韩松，或删除该条",
      "evidenceVerified": true
    }
  ],
  "counts": { "facts": 26, "hooks": 7, "items": 1 },
  "warnings": [],
  "trace": { "durationMs": 18234 }
}
```

- `items` 最多 8 条，按 `major` / `minor` 排序；没有发现时是 `[]`，且 `checked: true` 只表示「这次没有观察到不一致」，不表示事实已被证明为真。
- 宿主对每条 `evidence` 做正文包含校验（空白归一化后）；`evidence` 必须是正文里的连续原文，不得用省略号拼接。有引文但对不上时标 `evidenceVerified: false` 并加一条 `evidence-unverified` 警告，不丢弃该条；`无对应段落` 时 `evidenceVerified: null`。
- `revision` 是本次核对的正文版本；正文改版后要重跑，旧结果不适用于新版本。检查期间正文被改，返回 `state-check-stale`。
- 字段上限：`where` / `impact` / `fix` 各 120 字，`problem` 160 字，`evidence` 240 字；超限的提交被 `story_submit` 拒绝，子代理在同轮收敛。
- 不返回整章正文、路径或其他章节内容；证据是有界片段。

### 2. 检查项与严重度

| code | 含义 | 默认严重度 |
| --- | --- | --- |
| `fact-unsupported` | 正文矛盾，或正文没有这件事 | major |
| `fact-ambiguous` | 正文只能推断，不能明确支持 | minor |
| `missing-change` | 正文发生了重要变化，delta 没记 | major / minor 按影响 |
| `hook-state-mismatch` | 正文支持的状态与 proposed 状态不同 | major |
| `hook-evidence-weak` | 伏笔的状态变化只有暗示 | minor |

- 只核对本次 delta，不重审旧投影里已经存在的事实；旧投影只作为伏笔状态与人物上下文的依据。
- 缺章纲、摘要或人物卡时省略对应上下文，仍用正文与旧投影检查；这些缺失不阻断。
- 不要求审稿或摘要先存在；只要求章存在、有正文、未定稿。
- 正文是唯一事实证据；摘要、章纲、旧投影只作上下文，不能当作「正文支持」的依据。
- `missing-change` 只列最重要的至多 3 条，不做完整抽取；不承诺「没有漏」。没有正文引文的 `missing-change` 不得提交。
- 所有发现都是建议，`story_state` 仍是唯一写入口，是否修改 delta 由主编/作者决定；没有自动改写、自动重试或自动重投影。
- 编排技能在定稿步骤点名：先 `story_state_check`，按 findings 改完 delta，再 `story_state`；不把 check 做成硬闸门。

### 3. 子代理与提交

新增角色方法技能 `storycraft-state-check`（放在 `review` 目录）：只定义判断标准、证据要求、模糊与不支持的区别、输出契约；不写正文、不给评分、不提出新的情节。

`story_submit` 增加 `validator` 角色：

```json
{ "items": [
  { "code": "fact-unsupported", "where": "霍七", "problem": "…", "evidence": "…", "impact": "…", "severity": "major", "fix": "…" }
] }
```

- 每次最多 8 条，字段长度有上限；超过时子代理先收敛，不把长文搬回父会话。
- 角色只负责本次 check；子代理不落盘、不改状态、不调用 `story_state`。prompt 按现有委派格式写 `delegationId 是 <id>`，并声明最终只回「已提交」。
- 复用现有 `subagents` 服务与 `story_submit` 通道；不新增模型/provider，不做自动调用。

### 4. 复用启动逻辑与打包

`delegate.js` 现有的「启动子代理 → 超时/取消 → 消费 submission → 清理」逻辑提取为一个内部助手，`delegateRole` 与 `runStateCheck` 共用；委派行为、回执与错误码不变，既有 `delegate.test.mjs` 全过。

`state-check.js` 加入 `package.json` 的 `files`；动作注册后总数从 30 变 31，`tools.test.mjs` 的动作清单与输出 schema 断言同步；`submission.test.mjs` 增加 validator 角色。

### 5. 失败与成本

- 无 `subagents` 服务/provider：`state-check-unavailable`，不返回「干净」。
- 子代理超时/异常：`state-check-failed`；没有通过校验的提交：`state-check-no-submission`。
- 子代理不可用或格式坏时**绝不**退化为「通过」；检查失败就是失败。
- 超时上限 180 秒；每次只跑一个子代理，不自动重试整轮。调用由主编显式发起，不藏在 `story_state` 里。
- 只在显式调用时产生一次模型调用；测量结果只用于判断是否值得做，不在写状态时偷偷加调用。

### 6. 测试

新增 `tests/state-check.test.mjs`，用临时 SQLite 与假 subagents：

- 合法 delta：子代理返回一条 `fact-unsupported`，父回执含 items；events/stage/revision/摘要不变。
- 空 delta、缺正文、已定稿：拒绝，且不启动子代理。
- 子代理调用被拒：`state-check-parent-denied`，不启动孙代理。
- 确定性 error（如 `hook-not-found`）：直接返回原错误，子代理未启动。
- 重复事实 warning：原样返回，同时继续语义检查。
- 检查期间正文改版：返回 `state-check-stale`，不返回旧 findings。
- 子代理返回 9 条 / 字段超长：提交被拒，子代理按契约收敛；父回执不超过 8 条。
- 引文能在正文找到：`evidenceVerified: true`；引文对不上：`false` 并带 `evidence-unverified` 警告，不丢条目。
- 无服务、超时、无提交、坏 payload：分别返回既定错误码，且不写库。
- `story_submit` 的 `validator` 角色：合法 payload 通过，缺字段/非法 severity 可重试，第 4 次耗尽。
- 工具注册：动作在 `story_*` 作用域内，声明输出 schema，只读；动作总数 31，`tools.test.mjs` 同步；`skills.test.mjs` 的 `all` 10 个、`review` 2 个同步。
- 缺章纲、摘要、人物卡仍能检查；prompt 不含其他章正文或路径。
- 父回执不含整章正文；items 的证据片段有界。

## 备选方案

- **把校验塞进 `story_state`，自动加一次 LLM 调用**：每次定稿都付费、失败策略与写事务耦合，且容易把建议误当阻断；本项改为显式只读动作。否决。
- **只让 reviewer 在审稿时顺带查状态**：reviewer 看得到正文与旧状态，但看不到尚未提交的 delta，无法核对本次新增事实与伏笔状态；它只能覆盖「正文与旧状态矛盾」的一部分。否决为本项主路径，保留为后续补充。
- **要求每条事实带正文引文，做确定性匹配**：改事实 schema，旧数据与既有测试全要迁移，且引文正确不代表语义归属正确；否决。
- **宿主直接调 `ctx.llm`**：少一层子代理，但引入直接模型依赖、输出解析与另一套失败路径；继续用 subagents 与 `story_submit`。否决。
- **自动重投影/自动改 delta**：会掩盖作者判断，且当前没有 settler；R11 再谈。否决。

## 验收条件

1. `story_state_check` 是只读动作且只允许主会话：调用前后 events、章节 stage、current revision、摘要均不变；子代理调用返回 `state-check-parent-denied`。
2. 确定性 error 在启动子代理前返回；假服务的 `startActivation` 未被调用。
3. 合法 delta + 假子代理 findings：父回执含 ≤8 条 items、`revision`、`counts`、`warnings`、`durationMs`，不含整章正文（证据是有界片段）；字段超限的提交被拒；引文能/不能对上分别给出 `evidenceVerified: true/false`。
4. 无发现时 `checked: true`、`items: []`；缺正文/已定稿/空 delta 分别返回 `chapter-not-written` / `chapter-settled` / `empty-state`；无服务/超时/无提交/坏 payload/正文改版返回对应错误码，绝不返回干净结果。
5. `validator` 角色的 `story_submit` 形状校验与重试上限生效。
6. `story_state`、`story_delegate`、阶段机、落盘路径无行为变化；35 个既有单测全过；`state-check.test.mjs` 与 `submission.test.mjs` / `tools.test.mjs` 的增量全过。
7. 新增技能被 `all` 挂载，动作 prompt 点名；编排技能在定稿步骤点名 check；README、对拍矩阵、路线图同步。

## 风险

- 单作品 3 章、单次判定，测量只能证明「值得做」，不能证明误报率；语义判断仍有主观性。
- 对话无提示语、跨章承接、合法归一化都会造成误报；因此只出 advisory，严重度不等于阻断，且允许 `fact-ambiguous`。
- `missing-change` 不是完整抽取；它只提醒最重要的几条，不能替代 R11 settler。
- 子代理可能编造证据；技能要求逐条引正文，测试只能校验结构与边界，不能证明每次判断正确。
- 每次检查多一次模型调用；不自动调用，由主编在改完 delta 后显式运行。
- 正文改版后旧检查失效；回执带 `revision`，主编应在 `story_state` 前对当前版本重跑；检查期间改版返回 `state-check-stale`。
- 显式动作依赖主编记得调用；技能点名与回执可见性只能降低漏跑，不能证明每次运行。若日后需要硬闸门，另立工作项，不把建议性检查偷偷升级成阻断。
