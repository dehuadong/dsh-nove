---
title: 故事工坊：产物合同 v2（数据模型与初始化）
status: proposed
created: 2026-10-23
updated: 2026-10-24
---

# Agent Note：故事工坊：产物合同 v2（数据模型与初始化）

## 问题

当前真值是五件自由文本/六字段 JSON，事件是 text-hook/string-fact；短篇、剧本没有独立产物，只能复用长篇章节表。全量对拍确认这不是功能等价：story_frame、volume_map、book_rules、角色卡、ChapterMemo、结构化摘要、hookId/生命周期、fact 三元组/有效期、observation、ContextPackage/Trace 的信息都在现有结构里丢失或被压扁。

本 Note 定字段级数据合同、消费者与初始化；它不实现代码，也不决定 R10 的具体生成流程。产品范围与验收归 #45。

## 与既有记录

- **artifact 身份语法由 [`2026-10-20-storycraft-artifact-identity.md`](2026-10-20-storycraft-artifact-identity.md) 拥有**；本 Note 只扩展 kind/字段，不另起一套 ID 语法。新增/变更的 ID 在 §2 表中列明；旧表（outline/plan/chapter/summary/state/bible）在 [L-R10a 生产者/消费者迁移](2026-10-24-storycraft-consumer-migration.md) 的对应切片迁移前仍是现行运行路径，迁移后不再写读；review/reviews 由 #52 单独迁移，volume/material/export/backup 仍按现有表/路径运行、R10a 不迁移。本 Note 不把旧表当作 A0 后的长期权威。本 Note 的“静态 artifact 保留历史 revision”**部分替代**该 Note 的“upsert 不保留历史”；L 交付时更新该 Note 的状态/验收并互相链接。
- R6a 的 [`2026-10-23-storycraft-longform-method-references.md`](../../implemented/pipeline/2026-10-23-storycraft-longform-method-references.md) 记录 hook 只有三态、text 身份、不引入 `superseded`/`lastAdvancedChapter`。本 Note 的 hookId/生命周期与该记录**部分替代**：R6a 在 L 交付前仍是现行运行契约；L 交付时更新 R6a 的状态/验收并互相链接，不提前把新字段用于现有代码。
- R11 的 [`2026-10-23-storycraft-settler-auto-projection.md`](../../implemented/pipeline/2026-10-23-storycraft-settler-auto-projection.md) 已交付；本 Note 不改变其“审稿→修订→摘要→settle”的闸门顺序，只把产物迁到新模型（L 阶段）。
- 旧 R10 方案已 rejected：[`2026-10-23-storycraft-foundation-delegation.md`](../../rejected/pipeline/2026-10-23-storycraft-foundation-delegation.md)。

## 提案

### 1. 共同原则

- **一个概念一个属主**：可读长文用 Markdown，机器字段用 JSON；两者同属一个 artifact，不互相替代。
- **只支持新库**：本项目没有正式旧作品；现有测试作品直接删除重建。只支持 v6，不设计兼容/迁移层。
- **事件是状态源，投影是派生**：fact/hook 的变更写事件；当前状态由投影/折叠得到，可重建。
- **artifact 有稳定身份**：`artifactId + revisionId`；正文 revision 与状态事件序号分开。
- **消费者显式**：每个 artifact 写明 brief/context/检索/审稿/结算/UI/导出中的消费者。
- **三种形态各自流水线**：共享 Work/Book 级合同，不共享短篇/剧本的阶段机（详见技能组织 Note）。

### 2. Work 与 Book 级

```json
// WorkConfig
{
  "workId": "string",
  "title": "string",
  "form": "longform|short|script",
  "platform": "string?",
  "genre": "string?",
  "status": "incubating|outlining|active|paused|completed|dropped",
  "targetChapters": "integer?",
  "chapterWordCount": { "min": "integer", "max": "integer", "target": "integer?" },
  "language": "zh|en",
  "parentWorkId": "string?",
  "fanficMode": "string?",
  "tags": ["string"],
  "planApproval": "required|off",
  "outline": { "writtenAt": "ISO-8601?", "approvedAt": "ISO-8601?" },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

```json
// ArtifactEnvelope
{
  "workId": "string",
  "artifactId": "string",
  "kind": "outline|plan|chapter|summary|review|state|context|trace|world|style|intent|current_focus|story_frame|volume_map|book_rules|role_index|role_card|volume|material|export|backup|short_story|script|storyboard|interactive_film|play_world|cover|translation",
  "scope": { "chapter": "integer?" },
  "revisionId": "string",
  "content": "object|string",
  "provenance": "generated|imported|edited",
  "createdAt": "ISO-8601"
}
```

身份语法由 [`2026-10-20-storycraft-artifact-identity.md`](2026-10-20-storycraft-artifact-identity.md) 拥有。新增/变更：

| 对象 | artifactId | revisionId |
| --- | --- | --- |
| 全书计划 | `outline` | 内容哈希 |
| 章纲 | `plan:<n>` | 内容哈希 |
| 正文 | `chapter:<n>` | `r1/r2…` |
| 审稿 | `review:<n>:r<bodyRev>:<round>` | 内容哈希 |
| 摘要 | `summary:<n>` | 内容哈希 |
| 状态 | `state` | `seq:<n>` |
| 世界/文风/意图/焦点 | `bible:world` / `bible:style` / `bible:intent` / `bible:current_focus` | 内容哈希 |
| story_frame / volume_map / book_rules | `bible:story_frame` / `bible:volume_map` / `bible:book_rules` | 内容哈希 |
| roles 索引/卡 | `roles:index` / `role:<slug>` | 内容哈希 |
| 卷 | `volume:<id>` | 内容哈希 |
| 素材 | `material:<id>` | 内容哈希 |
| 短篇/剧本/分镜 | `short:<id>` / `script:<id>` / `storyboard:<id>` | 内容哈希 |
| R8 产物 | `interactive_film:<id>` / `play_world:<id>` / `cover:<id>` / `translation:<id>` | 内容哈希（字段合同 R8） |
| 导出/备份 | `export:<workId>` / `backup:<workId>:<ts>` | 覆盖式/时间戳 |

`scope.chapter` 对按章 artifact 必填；`state` 的 revision 是事件序号，正文是真实版本，静态文本是内容哈希。

章节重编号/删除是 **identity 变更**：按章号编码的 artifact（plan/summary/review）不保留旧 chapter ID 下的历史 revision；旧 ID 的内容不保留，编号可被后续新章重新使用，但必须是新内容/新 revision，不得把旧 memo 复制给新章。该例外由 [L-R10a S1b](2026-10-24-storycraft-chapter-artifact-remap.md) 实现：plan/summary/review 的 ID 章号段、`scope_chapter` 与 `content.chapter` 一起改号；context/trace 的 ID 方案归 R12，在此之前只同步 `scope_chapter`；state 是作品级，不参与重映射。非 artifact 章节字段与批准清空归章节编辑本身，#52 只拥有 observation 语义。

新库没有 `bible` 兼容 kind：`bible:world` 等只作为 artifactId 前缀，kind 使用具体的 `world`/`story_frame`/`book_rules`；不再产生旧 `bible` kind。

### 3. Foundation 产物

**world**（Markdown，可读）：世界硬规则、地理/时代、社会/力量体系、禁区。必需标题由作者/技能约定；不与 story_frame 的故事前提重复。消费者：architect/planner/writer/reviewer。

**style / intent / current_focus**（Markdown）：沿用现有 `bible/style`、`bible/intent`；新增 `current_focus` 独立文件（当前任务焦点，不混入长期意图）。消费者：writer/brief、planner。

**story_frame**（Markdown，可读；不拆成机器字段，避免把叙事压成标签）

必需标题：`## 前提`、`## 核心冲突`、`## 主角动机`、`## 约束`、`## 因果解决`。作者可加节；消费者是 architect/planner/writer/reviewer。

**volume_map**（Markdown，可读）

每个卷一节：卷目标、起止章方向、关键因果节拍、卷末承诺，实现为 `卷目标：`、`起止章：`、`关键节拍：`、`卷末承诺：` 四个标签；消费者 planner/composer/writer。结构化 `volumes` 仍单独存在，`volume_map` 是计划，不是已发生事实。

**book_rules**

```json
{
  "version": "2",
  "narrativePerson": "string",
  "prohibitions": ["string"],
  "protagonist": {
    "name": "string",
    "personalityLock": ["string"],
    "behavioralConstraints": ["string"]
  },
  "genreLock": { "primary": "string", "forbidden": ["string"] },
  "enableFullCastTracking": "boolean",
  "fanficMode": "string?",
  "allowedDeviations": ["string"],
  "markdown": "string"
}
```

`markdown` 是可读规范；JSON 字段供 writer/settler/validator 读取。消费者：writer（规则输入）、reviewer（禁区）、settler（约束）、UI。

**roles index + card**

```json
// roles/index
{
  "roles": [
    { "name": "string", "tier": "major|minor", "role": "string",
      "want": "string", "fear": "string", "limit": "string", "voice": "string" }
  ]
}
```

```json
// roles/<tier>/<slug>
{
  "slug": "string",
  "name": "string",
  "tier": "major|minor",
  "motivation": "string",
  "knowledge": "string",
  "relationshipPressure": "string",
  "limits": "string",
  "arc": "string?",
  "markdown": "string"
}
```

索引保留现有六字段用于 brief 匹配/筛选；卡承载参考实现的动机、已知信息、关系压力、能力边界与可选弧光。六字段只属索引，卡不重复 want/fear/limit/voice；brief 先读索引，需要时读卡；不把卡全文塞进每章 brief。卡的 `slug` 是稳定身份，改名不改 ID；索引按 name 匹配，卡按 slug 寻址。

### 4. 章节产物

```json
// ChapterIntent
{ "chapter": 1, "goal": "string" }
```

```json
// ChapterMemo
{
  "chapter": 1,
  "goal": "string",
  "body": "string",
  "threadRefs": ["hookId"],
  "perspective": "string?",
  "obstacle": "string?",
  "cost": "string?",
  "turn": "string?"
}
```

保留现有章纲五项（perspective/goal/obstacle/cost/turn），新增 `body` 与 `threadRefs`；消费者 planner/writer/reviewer/reviser。

- `ChapterMemo` 是章纲的唯一权威，存为 `plan:<n>`；`ChapterIntent` 只是从 memo 的 `goal` 派生的只读视图，不单独存储，避免 goal 双写。
- 作者确认绑定 memo 内容版本：`chapters.plan_approved_at` + `plan_revision`（memo 内容哈希）。未确认/改版后旧批准失效；`story_next` 的 gate 读同一字段。

```json
// ChapterMeta
{
  "number": 1,
  "title": "string",
  "wordCount": 0,
  "stage": "planned|written|reviewed|revised|settled",
  "planApprovedAt": "ISO-8601?",
  "planRevision": "string?",
  "provenance": "generated|imported|edited",
  "lengthTelemetry": { "target": 0, "actual": 0, "unit": "words|non-whitespace-characters" }?,
  "tokenUsage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 }?,
  "observationIds": ["review:<n>:<bodyRev>:<round>"]
}
```

`ChapterMeta` 是 `chapter:<n>` 的投影，不单独占一个 artifact kind；`observationIds` 引用 review observation，不复制正文。

```json
// ChapterSummary
{
  "chapter": 1,
  "title": "string",
  "characters": "string",
  "events": "string",
  "stateChanges": "string",
  "hookActivity": "string",
  "mood": "string",
  "chapterType": "string",
  "bodyRevision": 3,
  "rawText": "string"
}
```

`rawText` 是摘要渲染/原文来源，不是旧格式兼容；结构化字段供检索/审稿/brief。`bodyRevision` 是摘要针对的正文版本（stale 判定用它）；`artifactId=summary:<n>` 的 revisionId 仍是内容哈希，两者不能混用。消费者：brief（可渲染）、检索、reviewer、settler。

```json
// Observation
{
  "code": "string",
  "summary": "string",
  "evidence": ["string"],
  "category": "execution|quality|scope",
  "assessment": "issue|resolved|unavailable|observation",
  "scope": "string?",
  "target": { "workId": "string", "artifactId": "string", "revisionId": "string" }?,
  "sourceRefs": [{ "sourceId": "string", "quote": "string" }],
  "severity": "blocking|major|minor?",
  "fix": "string?",
  "mode": "patch|polish|rewrite|deslop?"
}
```

`severity/fix/mode` 保留现有审稿契约；`sourceRefs` 必须落在可核对的正文/计划文本上。消费者：reviewer、reviser、UI、导出。

### 5. 状态：fact 与 hook

事件操作（追加写；投影可重建）：

```json
// fact.upsert / fact.expire
{ "kind": "fact", "op": "upsert",
  "fact": { "subject": "string", "predicate": "string", "object": "string" },
  "chapter": 12, "source": "string" }
{ "kind": "fact", "op": "expire",
  "selector": { "subject": "string", "predicate": "string", "object": "string?" },
  "chapter": 18 }
```

投影后的 fact：

```json
{ "subject": "string", "predicate": "string", "object": "string",
  "validFromChapter": 12, "validUntilChapter": null, "sourceChapter": 12 }
```

```json
// hook ops
{ "kind": "hook", "op": "upsert", "hook": {
  "hookId": "string", "startChapter": 0, "type": "string",
  "status": "open|progressing|deferred|resolved|superseded",
  "lastAdvancedChapter": 0, "expectedPayoff": "string",
  "notes": "string", "dependsOn": ["hookId"], "paysOffInArc": "string?",
  "text": "string" } }
{ "kind": "hook", "op": "progress|mention|defer|resolve|supersede",
  "hookId": "string", "chapter": 12 }
```

状态转移：

| 当前 | 允许 |
| --- | --- |
| open | progressing / deferred / resolved / superseded |
| progressing | deferred / resolved / superseded |
| deferred | progressing / resolved / superseded |
| resolved | superseded（仅纠正误记） |
| superseded | 终态 |

- `upsert` 只创建新 hook 或更新 `text/type/expectedPayoff/notes/dependsOn/paysOffInArc` 等元数据；已有 hook 的 `status` 必须省略或等于当前状态，状态变化只能走 `progress/mention/defer/resolve/supersede`，不能经 upsert 绕过转移表。
- `mention` 只记被提及，不改 status/lastAdvanced；`progress` 改 progressing + lastAdvanced；`defer` 改 deferred；`resolve` 改 resolved；`supersede` 改 superseded。
- 非法转移（如 resolved→open、superseded→progressing）返回 `hook-transition-invalid`，不写事件。
- `hookId` 由宿主生成，不复用 text；`text` 是展示原句，改写不改 ID。
- hooks/facts 是 `state` 投影，不各自占 artifact kind：hook 用 `hookId` 寻址，fact 用 `subject/predicate/object` + 有效期寻址；`ChapterMemo.threadRefs` 引用 `hookId`。
- `fact` 的当前状态由 `fact.upsert`/`expire` 投影；`validFrom/validUntil/source` 由投影生成。
- 新库不接收旧 text-hook/string-fact 事件；测试作品重建，不做兼容解析。
- **运行边界（A0）**：v2 事件操作与投影由 `state-events.js` 拥有；现有 `state-validation`/`state-check`/`state-settle` 仍消费旧 text-hook/string-fact，直到 L 迁移；两者不互相翻译。

### 6. 上下文

```json
// ContextSource
{ "source": "string", "reason": "string", "excerpt": "string?",
  "protection": "protected|compressible" }
```

```json
// ContextPackage
{ "chapter": 1, "selectedContext": ["ContextSource"] }
```

```json
// ChapterTrace
{
  "chapter": 1,
  "plannerInputs": ["string"],
  "composerInputs": ["string"],
  "selectedSources": ["string"],
  "contextTiers": { "protectedSources": ["string"], "compressibleSources": ["string"] },
  "tokenBudget": { "protectedTokens": 0, "compressibleTokens": 0, "totalSelectedTokens": 0 },
  "compression": { "compiledSource": "string", "protectedSources": ["string"], "compressedSources": ["string"], "protectedTokens": 0, "compressibleTokens": 0, "budgetTokens": 0 }?,
  "retrieval": { "engine": "sqlite-fts5-bm25", "query": "string", "selectionMode": "semantic|complete", "candidates": [], "semanticSelectedIds": [] }?,
  "notes": ["string"],
  "sections": [{ "name": "string", "protection": "protected|compressible", "sourceIds": ["string"] }]?,
  "trimmed": ["string"],
  "dropped": ["string"],
  "budget": { "limit": 0, "used": 0, "unit": "characters|tokens" }?
}
```

`sections/trimmed/dropped/budget` 保留现有 `context.js` trace；`contextTiers/tokenBudget/compression/retrieval` 是 R12 的增量。消费者：brief/context、检索、R12 token 预算、UI trace。

### 7. 短篇与剧本产物

短篇不映射到 Chapter：

```json
// ShortStory
{
  "storyTitle": "string",
  "openingHook": "string?",
  "chapters": [{ "number": 1, "title": "string", "content": "string", "charCount": 0 }],
  "rawContent": "string",
  "outline": "string",
  "draftReview": "string",
  "revisionPlan": "string",
  "salesPackage": { "title": "string", "intro": "string", "sellingPoints": ["string"], "coverPrompt": "string" },
  "measurements": { "chapterCount": 0, "totalLength": 0, "unit": "words|non-whitespace-characters", "openingHookLength": 0, "chapterLengths": [] }
}
```

剧本不映射到 Chapter：

```json
// Script
{
  "title": "string",
  "sourceKind": "string?",
  "targetFormat": "vertical_short_drama|screenplay|audio_drama|interactive_script|general_script",
  "episodeCount": "integer?",
  "episodeDuration": "string?",
  "spec": "string",
  "script": "string",
  "episodes": [{ "number": 1, "title": "string", "scenes": [{ "slug": "string", "location": "string", "time": "string", "action": "string", "dialogue": [] }] }]
}
```

**Storyboard（R8 预留）**：A0 只登记 kind/envelope 与阶段归属；字段合同在 R8 规划补。

Storyboard / interactive film / play / translation / cover 是 R8 产物：A0 只登记 kind/envelope 与阶段归属；字段合同在 R8 规划时补，不能从 A0 范围静默消失（#45 记录此边界）。

### 8. 消费者与投影

| 产物 | brief/context | 检索 | 审稿 | 结算/对账 | UI/导出 |
| --- | --- | --- | --- | --- | --- |
| story_frame / volume_map / book_rules | 计划/写作 | 计划检索 | 规则检查 | 约束 | 真值编辑 |
| roles index/card | 人物段 | 角色检索 | 角色一致性 | 约束 | 角色卡编辑 |
| intent/memo | 章纲/写作 | 计划检索 | 对照目标 | 约束 | 章纲 |
| summary | 历史摘要 | FTS | 历史一致性 | 摘要 | 摘要 |
| hooks/facts | 未解伏笔/状态 | 状态检索 | 对账 | 投影 | 状态面板 |
| observations | — | 审稿检索 | 问题/证据 | 修订输入 | 审稿 |
| short_story / script | 独立流水线 | 素材/历史 | 短篇/剧本审稿 | — | 打包/导出 |
| context/trace | 上下文/trace | — | — | — | 调试 |

### 9. 库版本与初始化

- 只支持 v6；新作品直接建 v6，所有 artifact 使用本合同。
- 本项目没有正式旧作品；现有旧作品都是测试数据，直接删除/重建，不设计 v5 兼容、legacy 读、迁移或 `artifact_contract` 标志。
- `openWork` 遇到非 v6 直接返回 `schema-version-mismatch`，提示重建测试作品；不做自动升级。
- 测试 fixture 每次创建新库；不保留兼容 fixture。
- `FORM_META`/技能路由同步为 longform/short/script 三条流水线，不保留旧技能别名。
- 唯一例外：参考实现的 R8 产物（storyboard/interactive film/play/translation/cover）字段合同延后到 R8，不是旧格式兼容。

## 备选方案

- **为测试旧作品设计兼容/迁移层**：没有真实用户数据，只会增加双模型与测试负担；否决。
- **一次性猜测 story_frame/book_rules/hook 类型**：会伪造语义；新库不存在旧数据，不需要；否决。
- **继续用 text-hook/string-fact**：无法表达 expire/superseded/expectedPayoff；会继续返工；否决。
- **把短篇/剧本压进 Chapter**：产物字段和流水线不同，信息损失；否决。
- **保留 v5 读、v6 写**：测试作品可直接重建，双读没有收益；否决。

## 验收条件

1. A0 覆盖的每个 artifact（world/style/intent/current_focus/story_frame/volume_map/book_rules/roles/plan/summary/hooks/facts/observations/context/trace/short_story/script）都有字段、权威、生命周期、消费者；R8 的 storyboard/interactive_film/play_world/cover/translation 在 A0 只验收 kind/envelope/identity，字段与消费者验收明确归 R8；
2. 只支持 v6；旧版本/测试旧作品直接报 `schema-version-mismatch` 并重建，没有兼容/迁移路径；
3. 新作品只写本合同；不存在 `legacy`/`unverified`/迁移字段；
4. A0 定义每个 artifact 的消费者映射与可测试契约；真实生产者/消费者由 L-R10a #51 按 artifact 矩阵验收（短篇/剧本 S/D，context/trace R12，observation/reviews 由 #52 单独验收），只按 channel 抽样不算；
5. 短篇/剧本/分镜的产物不映射到 Chapter；R8 产物的字段 deferral 在 #45 记录；
6. 作者闸门 `planApproval`/outline approved/`planApprovedAt` 在 WorkConfig/ChapterMeta 中保留；
7. 结构合同测试覆盖必填、拒绝和消费者；测试库每次重建；矩阵与 #45 互链。

## 风险

- 没有旧作品兼容层，但测试 fixture 必须全部重建；旧测试若仍假设 v5 会失败，需同步更新。
- 事件源 + 投影需要重建/回滚测试；只写投影会失去可审计性。
- 角色卡/规则/摘要字段增多，brief 预算需要按优先级裁剪，不能全塞。
- 新 schema 一次性落地，实施时不能偷偷保留 legacy 双读；否则又变成兼容层。
- 本 Note 只定数据合同；短篇/剧本流水线与技能组织见配套 Note。

