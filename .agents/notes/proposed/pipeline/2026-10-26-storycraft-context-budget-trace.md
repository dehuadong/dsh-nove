---
title: 故事工坊：上下文 token 预算与持久化 trace（R12）
status: proposed
created: 2026-10-26
updated: 2026-10-26
---

# Agent Note：故事工坊：上下文 token 预算与持久化 trace（R12）

## 问题

`story_context` 与 `story_brief` 现在按**字符/字节**预算：`context.ts` 用 `DEFAULT_CONTEXT_BUDGET = 8000` 字符，`bible.ts` 用 `BRIEF_BUDGET_BYTES = 8192` 字节。两者口径不同、都无法换算成模型实际收到的 token；装配 trace 只存在于本次调用的回执里，落盘后查不到“这次为什么丢了检索段”。

产物合同 v2 定义了 `trace` 的字段与 `validateChapterTrace`，但没有生产者、校验器也没注册；回执里的 trace（`tools.ts` 的 `OUTPUT_PROPERTIES.trace`）已经在产出 `missing`/`overflow`/`sections[].chars/dropped/trimmed`，与合同字段集不一致。`context`/`trace` 的 artifactId 方案按合同归本项决定，并要接入章节重编号/删除的 identity 变更规则。

## 对拍参考

- `inkos-master/packages/core/src/models/input-governance.ts:35-70`：`ChapterTraceSchema` 定义 `chapter/plannerInputs/composerInputs/selectedSources/contextTiers/tokenBudget/compression/retrieval/notes`。本包的合同 v2 是它的投影，但 `sections/trimmed/dropped/budget` 与本次新增的逐段 `chars/tokens/reason`、`missing`、`overflow` **无参考实现**（来自本包既有回执 trace 与合同 v2 扩展），按“无参考实现”声明。
- `inkos-master/packages/core/src/utils/context-assembly.ts:20-60`：trace 按 `protection` 分档求和；`compression`/`retrieval` 只在存在时写。
- `inkos-master/packages/core/src/llm/provider.ts:539`：token 估算 `ceil(cjk + nonCjk/4)`；CJK 1 字符≈1 token。
- `inkos-master/packages/core/src/agents/base.ts:158`：预算由模型窗口减去输出上限与保留量得出。
- 差异：参考实现按模型窗口算预算；本包装配零依赖、拿不到模型窗口，改用可配置默认值（等量于现有内容），预算数字进 trace 供后续按模型调整。

## 与既有记录

- [`2026-10-23-storycraft-skill-organization-v2.md`](2026-10-23-storycraft-skill-organization-v2.md)：compose 必须复用同一 trace 合同、不重复实现；本项是该合同的唯一实现者，`skill-evidence` 不属本项。
- [`2026-10-24-storycraft-chapter-artifact-remap.md`](../../implemented/pipeline/2026-10-24-storycraft-chapter-artifact-remap.md)、[`2026-10-24-storycraft-chapter-identity-approval.md`](../../implemented/pipeline/2026-10-24-storycraft-chapter-identity-approval.md)：`context`/`trace` 的 ID 方案与重映射归 R12。
- [`2026-10-23-storycraft-artifact-contract-v2.md`](../../implemented/pipeline/2026-10-23-storycraft-artifact-contract-v2.md)：trace 字段属主；本项按它声明的“R12 增量”做合同修订（字段表 + 校验器 + 注册），修订与该 Note 同步。

## 提案

### 1. 统一计数（新模块 `accounting.ts`）

- `estimateTokens(text)`：CJK 字符 1 token、其余每 4 字符 1 token，向上取整。
- `accountOf(text) → { chars, tokens }`；`sumAccounts(items)`。
- 不引入 tokenizer：零依赖、离线安装；每份 trace 的 `notes` 写明 `tokens 为估算值（cjk 1:1，其它 4:1）`。

### 2. context 预算与裁剪

- 总预算默认 **8000 tokens**（等量于现有 8000 字符）；`budget` 必须是正整数（tokens），缺失或非法时回退默认值——与现有 `input.budget` 的容错一致，不新增错误码。
- 可压缩段上限：`state 600`、`recent 1000`、`retrieval 800`、`style 400`、`characters 600`、`volumeMap 800`；上限与总预算独立生效：先按段上限压缩，再处理总量。
- **protected 段不设上限、永不压缩或丢弃**（`authority`/`task`/`constraints`/`plan`/`body`/`standard`，writer 章纲在 `task` 内）：protected 自身超过总预算时置 `overflow: true` 并写一条 `notes`。
- 裁剪顺序：`retrieval → recent → state → characters → volumeMap → style`，先压缩，仍不足则整段丢弃；压缩保持“头 70% + 尾 25% + `…（已压缩）…`”与既有文案。
- 除单位、段上限与 trace 之外，段内容、顺序、来源字符串都不改。

### 3. brief 同口径

- `BRIEF_BUDGET_BYTES = 8192` → `BRIEF_BUDGET_TOKENS = 2600`；`budget` 的容错规则与 context 相同。
- `assembleBrief` 的 `budget` 改为 `{ limit, used, unit: 'tokens', overBudget }`（保留 `overBudget`，面板已在用），`dropped[].reason` 保持 `'budget'`；丢弃顺序不变；`client.ts` 的用量文案从“字节”改为 token 估算值。

### 4. trace 合同与持久化

**字段（落盘与回执共用一份，回执只多一个 `review`）**：

```
chapter, plannerInputs, composerInputs, selectedSources,
contextTiers{protectedSources, compressibleSources},
tokenBudget{protectedTokens, compressibleTokens, totalSelectedTokens},
retrieval{engine, query, selectionMode, candidates[{id,kind,source,score}], semanticSelectedIds},
notes, trimmed, dropped, budget{limit, used, unit},
sections[{name, protection, sourceIds, chars, tokens, dropped?, trimmed?, reason?}],
missing[{name, reason}], overflow
```

- `plannerInputs` = role 为 planner 时的 `selectedSources`，否则空数组；`composerInputs` = role 为 writer 时同值，否则空数组；`selectedSources` 恒为实际发出段的来源 id（按段的 `source` 以 ` + ` 拆分）。
- `retrieval` 只在启用检索时写：`engine: 'sqlite-fts5-bm25'`、`selectionMode: 'complete'`、`candidates` 为被选中的命中、`semanticSelectedIds: []`；检索失败原因进 `notes`。这是对回执现有 `retrieval` 形状的替换（`enabled`/`error` 由字段存在性与 `notes` 表达），合同与回执同步改。
- 不写 `compression`：本装配器没有“编译后单一来源”，逐段 `tokens`/`trimmed` 已表达压缩结果，该字段保持可选未用。
- 合同修订：上述字段同时写进产物合同 v2 的 trace 块与 `validateChapterTrace`（严格白名单加这些可选键），并注册进 `ARTIFACT_CONTENT_VALIDATORS`。
- 部分替代：回执 trace 现有的 `sections[].source` 字段改为 `sourceIds`、`retrieval.hits[].sent` 随合同形状取消；两处描述由 README 的验证/回执段与角色输入合同同步更新，旧读法不保留兼容。

**artifactId**：`trace:<chapter>:<role>`（`writer|planner|reviewer|reviser|summarizer`），`kind:'trace'`、`scope.chapter` 必填；revisionId 沿用内容哈希。作品级装配（无章号）不落盘，回执里的 trace 省略 `chapter`，其余字段照常。

**写入点**：动作边界（`delegate` 启动子代理前；`planner` 在 plan 落库后），也就是真正把上下文交给模型的时刻；`story_context`/`story_brief` 保持只读（不改 `mutates`）、面板 `/brief`（GET）与装配函数都不写，trace 只在回执里返回。`story_brief` 不落盘（它没有派发，回执里的 trace 就是全部）；`planner` 的 trace 在 plan 落库后写——派发时章行还不存在，写前写会以 `chapter-not-found` 被拒；其余角色仍在派发前写；手动 `story_context` + 自己派 subagent 的路径同样不落 trace——这是有意的取舍，该路径的成本由 #65 的主会话测量覆盖。
- 写入 best-effort：失败不阻断派发，回执 trace 追加 `notes: ['trace 未持久化：<code>']`。
- 同一章同一角色内容相同 → `artifact-revision-exists` 视为幂等成功（不加 revision、不报错）；内容变化才产生新 revision。
- 已定稿章节：`putArtifactOnDb` 的 `allowSettled` 放开到 `trace`（记录读取，不改章内容）。

**读取面**：`story_read` 增加 `trace` 分支，规则与其他章节 artifact 一致——只能读**当前章**（#22 的不跨章读取仍然成立）；跨章查看归 #66 面板，不在本项。

### 5. identity 变更

- `ARTIFACT_IDENTITY` 增加 `trace: /^trace:([1-9]\d*):(writer|planner|reviewer|reviser|summarizer|brief)$/`，`chapterScoped: true`。
- `remapChapterArtifacts` 增加 trace：ID 章号段随映射改写、`content.chapter` 同步、删除章节时一并删除（与 `plan`/`summary`/`review` 同一条 identity-change 例外）。
- `context` kind 本项不引入生产者。

### 6. 回执

- `story_context` 回执的 `trace` = 上述字段 + 动作专属 `review{round,revision}`；同一装配下与落盘 trace 逐一相等（单测直接比对去掉 `review` 后的对象）。`story_brief` 的 trace 不落盘，字段相同但省略 `chapter`。
- 动作 schema 增加可选 `budget`（tokens）；`OUTPUT_PROPERTIES.trace` 的 `budget` 由整数改为 `{limit, used, unit}`，补 `tokenBudget`/`contextTiers`/`sections[].tokens`/`missing`/`overflow`，`retrieval` 换成合同形状。

## 备选方案

- **加 tokenizer**：零依赖、离线安装、模型可切换；否决，误差由余量吸收。
- **继续用字符、只加 trace**：#64 的目标就是 token 口径；否决。
- **在装配函数或只读动作里写**：面板 GET 与手动预览都会写，还会迫使只读动作标 `mutates`（子代理守卫会拒）；否决，只在派发时写。
- **trace 只进回执不落盘**：跨会话查不到派发理由；否决。
- **给 protected 段设上限**：破坏“protected 永不丢”；否决，超限只标记。
- **语义重排/embedding**：等测量证明词法排序不够再做。

## 验收条件

产品验收归 #64；以下是本设计要交付并能逐条验证的切入点。

- 计数：CJK/ASCII/混合/空串的估算与求和；`budget` 非法值回退默认。
- 预算：恰好用满、超 1 token、可压缩段上限与总量叠加、裁剪顺序、protected 不被压缩或丢弃、`overflow` 只在 protected 自身超预算时出现。
- 合同：落盘 trace 通过注册后的 `validateChapterTrace`；字段表与合同 Note 一致；回执去掉 `review` 后与落盘逐一相等。
- 持久化：writer/reviewer/reviser/summarizer 在派发时写、`planner` 在 plan 落库后写；相同内容幂等；内容变化产生新 revision；重编号后 ID/`scope.chapter`/`content.chapter` 同步、删除后消失；无章号、`story_context`、`story_brief` 与面板 GET 都不产生写入。
- 读取：`story_read` 能按 `trace:<n>:<role>` 读回当前章的最近一次与指定 revision；跨章读取被拒绝。

## 风险

- 估算偏差（CJK 1:1）：用余量与 `notes` 吸收；若以后拿到模型窗口再按窗口推导。
- protected 不设上限意味着长正文可吃满预算并挤掉可压缩段：既有语义，本项只把 `overflow` 显性化；是否给正文设硬上限属产品决定，留给测量。
- 每次派发一次 artifact 写入会增长作品库：内容哈希去重，暂不做保留期清理。
