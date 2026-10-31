# Agent Note: 故事工坊：B2b 技能上下文检索

Status: implemented

工作项：当前任务 B2b（不新建 GitHub issue）。B2 面板/API 已交付；本项只把技能参考接入 `story_context`。

## Problem

B2 已能在面板查技能参考，但写手/审稿人实际拿到的 `story_context` 仍只检索故事记忆与素材：

- 技能 reference 只在角色启动时整篇加载，无法按本章任务取到相关段；
- 上下文 trace 没有技能候选，无法证明模型看的是哪条技能段；
- 现有 trace 合同固定 `{id,kind,source,score}` 和 engine `sqlite-fts5-bm25`，源字段按作品 artifact 设计，技能是全局资源。

`story_brief` 没有 role，本轮不改；它继续只取记忆/素材。

## 对拍参考

- `inkos-master/packages/core/src/agents/base.ts:139-164` 把 query 检索到的 skill guidance 作为 **protected** source 注入 worker messages；`agent/skill-tool.ts:167-210` 在技能内按 query 取 top-4 references。合并进上下文不是偏差；单 reference 收窄、per-kind 配额、compressible 放置是登记偏差。
- `inkos-master/packages/core/src/retrieval/local-search.ts:27-31` 用统一投影支持记忆/素材/技能多 scope。
- 本项目 `context.ts:444-470` 合并候选；`retrieval.ts:95-141` 的 `select` 只保留 id/kind/sourceIds/score/sent，且丢弃超 budget 的整段；`tools.ts:213-239` 固定 trace candidate；`artifact-contract.ts:498-505` 固定 engine。
- 既有 [2026-10-22 unified-retrieval](../../implemented/feature/2026-10-22-storycraft-unified-retrieval.md)：§11 排除技能、§65 sourceIds 仍是 artifact ID、§76 同源；本项部分取代这三处，并新增 trace location/engine。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| query 命中技能段作为 protected source | 并入 retrieval 段，compressible | 复用工作上下文预算 | 偏差 | 单元 |
| 技能内 top-4 references | 仅 roleMethod 允许的单个 reference | 角色节点只授权一页 | 收窄 | 单元 |
| 统一检索投影 | 作品 FTS + host 技能段合并 | 复用 select/budget | 等价适配 | 单元 |
| trace 只记作品 artifact | trace 增加 skill source/location | 需要来源证据 | 合同扩展 | schema 测试 |

## Decision

### 角色范围

新增 `skill-routing.ts` 的 `skillReferenceScope(role, form)`：

- `roleSkills(role, form)` 给出允许技能；
- `roleMethod(role, form)` 给出该节点唯一允许的 reference；
- 每个技能只检索 `SKILL.md` +（若 method.skill 匹配）该 reference；没有 method 的技能只检索 `SKILL.md`；
- planner 的 `story_outline` reference（foundation-design.md）不属于 `roleMethod('planner')`；本轮接受“planner 只取 chapter-plan”，并在 Note 登记，不擅自扩权；
- `searchSkillReferences` 增加 `references?: Record<skill, string[]>`：提供时 SKILL.md 永远检索，`references/` 只检索列出的相对路径；未提供时保持全 references（面板 B2 不传，行为不变）；context 只传 `skillReferenceScope` 的结果。

### 上下文合并

`context.ts`：

- `searchMemory` 注入保持不变；新增 `searchSkills` 注入点，默认 `searchSkillReferences`；
- 技能命中先用 `snippetFor(hit.text, searchTokens(query).split(' '), 400)` 截断**再**合并，避免 `select` 因整段超 1200 丢弃；
- 合并后 `select` 仍按 limit/budget/per-kind；技能 `kind='skill'`、`chapter=null`；技能候选带 `priority=1`，让 `select` 至少给技能一个槽位（作品候选 priority 0），避免被高分记忆全部挤掉；
- `select` 的 hit 增加 `source` 与可选 `location`；context trace 对作品取 `sourceIds[0]`（保持 artifact ID），对技能取 `source`；技能只出现在 retrieval trace，不进入 section `sourceIds`/`selectedSources`；
- 技能检索出错时 `searchSkillReferences` 通过 `onError` 上报，context 记 note 并继续使用记忆命中；不把技能异常混进作品检索失败；
- 检索门槛保持“已写 ≥3 章且 role != summarizer”。

### Trace 合同

- candidate 增加可选 `location`；
- engine：**有 skill 被 sent** 时为 `'sqlite-fts5-bm25+host-lexical'`，否则保持 `'sqlite-fts5-bm25'`；用 `sent` 判定，不用未发送前缀；
- `source` 技能为 `skill:<id>/<path>`；作品仍为 artifact ID；
- 更新 `tools.ts` trace schema、`artifact-contract.ts` engine 枚举、[context-budget-trace](../../implemented/architecture/2026-10-26-storycraft-context-budget-trace.md) 与 [artifact-contract-v2](../../implemented/architecture/2026-10-23-storycraft-artifact-contract-v2.md) 的 engine/candidate 形状、unified-retrieval Note 的 §13/§20/§78 指针与测试。

### 展示

- retrieval section 有 sent 技能时标题“相关参考”，否则仍“相关往事”；
- section sourceIds 保持作品来源，不加入技能；
- `story_brief` 不改。

## Alternatives considered

**A. 只改 prompt、不进 trace。** 最强理由是少改合同。否决原因：无法证明模型拿到哪条技能段。

**B. 把技能段写进作品 `search_docs`。** 最强理由是复用 FTS。否决原因：全局技能重复、revision 失效复杂，B2 已否决。

**C. 所有 references 都检索。** 最强理由是覆盖广。否决原因：角色节点只授权一个 reference；参考实现 top-4 也限定在当前 skill 内，本项再按 role 收窄。

**D. 同时改 brief。** 最强理由统一。否决原因：brief 无 role，强塞技能破坏材料-only 合同。

## Testing

- `tests/context-retrieval.test.mjs`：role scope、技能 source/location、hybrid engine、技能 400 截断、section sourceIds 排除、技能 fail-open、retrieval 被 drop 时 base engine。
- `tests/retrieval.test.mjs`：priority 候选在 limit 1 下抢占槽位。
- `tests/search.test.mjs`：writer/planner/reviser 的 skillReferenceScope。
- 完整 CI：92 单元 + 47 E2E。

## Consequences

- trace 合同扩展影响 tools schema/artifact-contract/tests；需同步；
- 技能与作品分数不可比；per-kind 配额控制，不做跨 kind 归一；
- 技能 reference 截断 400 可能丢上下文；消费者仍可按 source/location 读全文；
- planner outline reference 不在本轮 scope；
- 早期章节仍不检索技能；另做门槛裁决。
