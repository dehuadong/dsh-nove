# 故事工坊 × InkOS：产物结构与资源文档对拍审查（2026-10-23）

> 审查范围：`inkos-master` 2.0.0 的实际产物模型、生成链与消费方 vs `storycraft/` 当前真值、事件、摘要、审稿与 brief。  
> 目的：纠正此前对拍偏重流程/编排、轻视产物结构的问题，给出逐项差异、信息损失与整改顺序。  
> 不是文学质量评估；不判断哪套文笔更好，只判断**结构承载了什么、谁消费、迁移代价**。

## 1. 结论

此前对拍主要验证了“谁在什么时候做什么、上下文怎么交接、token 怎么控制”，产物本身大多只做了“能不能写进去”的检查。结果是：

- 我们保留了自己的五件真值/事件模型，但**没有逐项审查 InkOS 产物结构承载的信息**；
- R10 的“把 story_frame / volume_map / book_rules 映射进 world/plan”是**成本驱动的默认**，不是经过比较的决定；
- 当前最明显的结构差距集中在：**结构化章节摘要、独立 story_frame / volume_map、book_rules、角色卡、hook 身份与生命周期、事实三元组、observation 证据、chapter memo/threadRefs、context trace**。

结论：**R10 不应按现有格式直接实现**。先做“产物合同 v2”的决定与迁移设计，再让 architect 生成对应结构；否则 R10 会把旧格式固化成生成入口。

## 2. 审查方法

对每个产物比较五件事：

1. **结构**：自由文本、固定字段、表、schema；
2. **权威性**：事实/派生/计划/证据；
3. **消费者**：planner / writer / reviewer / settler / composer / UI / export / retrieval；
4. **生命周期**：版本、失效、迁移、能否撤回；
5. **迁移代价**：表、brief、context、面板、导出、测试。

证据取自 `inkos-master` 源码与 `docs/report/inkos/`，以及 `storycraft/` 源码。

## 3. 产物逐项对照

### 3.1 Foundation 与规则

| 产物 | InkOS | 我们当前 | 信息损失 / 风险 | 建议 |
| --- | --- | --- | --- | --- |
| story_frame | 独立可读 Markdown：premise、核心冲突、动机、约束、因果解决；由 architect 第一阶段生成 | `bible/world` 自由 Markdown + `plan` 的 `mainline` | world 同时承担“世界设定”和“故事框架”，读者/角色/计划三种职责混在一个文件；主线在 plan 里，与世界规则无结构关联 | **拆分**：新增 `story_frame`（可读），world 只留世界/规则；plan 引用 frame，不再重复主线 |
| volume_map | 独立可读 Markdown：卷与章方向、简短因果节拍，不写场景 | `plan` 的 `## 卷划分` 文字 | 可读卷图存在，但没有独立身份、版本和消费者；与结构化 `volumes` 表容易双源 | **拆分**：新增 `volume_map` 可读产物；结构化卷仍是章节存在后的 `volumes` 表；明确“卷图是计划，不是事实” |
| book_rules.md | 独立可读创作规范 | 无；规则散在 world | writer/settler 没有独立规则输入；改规则会改世界观 | **采用**：独立可读规则文件 |
| book_rules.json | 结构化：protagonist（人格锁/行为约束）、genreLock（主类型/禁区）、narrativePerson、prohibitions、fullCastTracking、fanficMode、allowedDeviations | 无 | 人称、主角锁、禁区不可机器校验；writer 只靠自由文本 | **采用（可裁剪）**：至少 narrativePerson、prohibitions、protagonist locks；其余按需要 |
| 角色卡 | `roles/主要角色|次要角色/<name>.md`，约 150–250 字：当前动机、已知信息、关系压力、能力边界；另有 roles 索引（tier/name） | `bible/characters` 六字段 JSON：name/role/want/fear/limit/voice | 六字段能保证 brief 简洁，但丢失“已知信息、关系压力、能力边界、开篇状态”；角色卡自由文本又不可结构化查询 | **混合**：保留六字段作为索引/筛选，新增每角色 Markdown 卡（动机/知识/关系压力/边界/tier）；brief 用索引，深层上下文按需读卡 |
| 初始伏笔 | architect 写初始 HookRecord（hookId、type、expectedPayoff、notes），宿主分配 ID | 无 foundation 入口；只能第一章 `story_state` 补；hook 以 `text` 为身份 | 开书没有承诺账本；文本身份导致改写即新伏笔 | **先定 hook 模型**，再由 foundation 写入；见 3.3 |

### 3.2 章节生产

| 产物 | InkOS | 我们当前 | 信息损失 / 风险 | 建议 |
| --- | --- | --- | --- | --- |
| ChapterIntent | `{chapter, goal}` | 无独立对象；章纲五项含 goal | 目标在章纲里，但没有独立 intent 版本/来源 | 可暂不新增；把章纲的 goal 视为 intent |
| ChapterMemo | `{chapter, goal, body, threadRefs}` | 章纲 `{perspective, goal, obstacle, cost, turn}` | 我们五项在 POV/代价/转折上更具体，但缺少 `threadRefs`（本章绑定的伏笔/线）与 memo 正文/来源 | **混合**：保留五项，增加 `threadRefs`；需要时增加 memo 文本与来源，不替换五项 |
| 正文元数据 | ChapterMeta：observations、provenance、lengthTelemetry、tokenUsage | manifest 的 stage/revision/words + 审稿条目 | 没有 provenance（生成/导入/编辑）、token/长度遥测；审稿证据另存 | 后续补 provenance/telemetry；不阻塞 foundation |
| 章节摘要 | 结构化 `ChapterSummaryRow`：title/characters/events/stateChanges/hookActivity/mood/chapterType | 纯文本 ≤400 字 | 无法按 hookActivity/mood/章型检索；摘要只作 brief 压缩，不能支撑跨章审阅/检索 | **采用**：结构化摘要 + 渲染文本；保留旧文本迁移/回退；settler/summarizer/UI/导出同步 |
| 审稿 observation | `{code, summary, evidence[], category, assessment, scope, target, sourceRefs[]}` | review item `{location, problem, suggestion, done}` | 没有 observation code、证据数组、来源引用、resolved/unavailable 语义；无法稳定追踪“哪条证据支持哪条问题” | **采用（映射）**：保留 severity/fix/mode，增加 code/evidence/sourceRefs/assessment；先做兼容迁移 |
| 章节卷摘要 | 卷摘要独立于章节摘要 | `volumes.summary` | 结构接近；保留 | 保留 |

### 3.3 状态：事实与伏笔

| 产物 | InkOS | 我们当前 | 信息损失 / 风险 | 建议 |
| --- | --- | --- | --- | --- |
| 事实 | `{subject, predicate, object, validFromChapter, validUntilChapter, sourceChapter}` | `{kind:"entity", name, facts:string[]}` | 无法表达“事实过期/被取代”；只能追加字符串；重复检测靠精确文本；settler 不能 expire | **采用三元组 + 有效期**；旧字符串事实做兼容层/一次性迁移；R9b/R11 同步 |
| 伏笔 | HookRecord：`hookId/startChapter/type/status(open|progressing|deferred|resolved|superseded)/lastAdvancedChapter/expectedPayoff/notes/dependsOn/paysOffInArc` | `{text,state(opened|used|resolved)}`，text 即身份 | 改写即新伏笔；无法表达“提及不推进”“明确延后”“作废计划”；初始 hooks 无 ID | **采用 hookId + 生命周期**；文本保留为展示；迁移现有 text hooks；R9b/R11/foundation 同步 |
| 状态投影 | runtime state 由 reducer 折叠，chapter 0 可有初始 hooks | events 折叠；`chapter:0` 目前无入口（R10 才加） | 结构可折叠，但初始状态没有正式入口 | foundation 写入 chapter 0；与 hook 模型一起定 |

### 3.4 上下文、检索与资源

| 产物 | InkOS | 我们当前 | 信息损失 / 风险 | 建议 |
| --- | --- | --- | --- | --- |
| ContextPackage | `selectedContext[{source, reason, excerpt, protection}]` + trace（budget、compression、retrieval） | `story_context` 固定段 + 8000 字符预算 + trace（budget/trim） | 没有 per-source reason/protection/excerpt；没有 token trace/压缩记录；检索只词法 | 归 R12；但结构字段应在产物合同里预留 |
| 摘要/伏笔检索 | 结构化摘要 + Hook 状态重建 FTS；可按 hookId 回溯 | FTS 索引正文/摘要/事件文本；hook 以文本匹配 | 摘要结构升级后检索可增强；hookId 可做定向回溯 | 与摘要/hook 迁移同批 |
| Skill/references | 20 技能、18 份 references；长篇 4 份；分析/市场/续写/导入等 | 11 技能、7 份 references；长篇方法 3 份 + 篇幅 1 份 | 缺分析 lens、市场 rubric、续写/导入方法；R6a 只补了 3 份 | R7/R7b/R7c 按触发条件；不在 R10 铺 |

## 4. 六个关键判断

### 4.1 章节摘要必须结构化，不只是“短”

InkOS 的摘要不是一句总结，而是 `characters/events/stateChanges/hookActivity/mood/chapterType`。这直接影响：

- 跨章检索可以按 `hookActivity` 找“伏笔是否推进”，按 `mood` 看情绪重复；
- 审稿可以引用“摘要说状态变了，正文没有”；
- 后续 brief 可以选择字段而不是整段摘要。

我们的纯文本摘要只能压缩历史，无法被这些消费者稳定使用。建议采用结构化字段，并保留渲染文本作为 brief/面板的兜底。

### 4.2 Foundation 不是“把三个文件填满”

InkOS 的 architect 分四阶段：story_frame + volume_map → book_rules + initial hooks → 角色索引 → 角色卡。我们的 R10 当前是一次生成 + 映射到 world/plan/characters/hooks，能减少手写，但会把“框架、规则、角色卡”继续压进自由文本。

建议 R10 拆成 **R10a 产物合同 + R10b 生成链**；生成链至少分两段（框架/卷图 → 规则/角色/初始伏笔），而不是一次全出。

### 4.3 Hook 的文本身份已经成为瓶颈

R6a 的 state-projection、R9b 的语义校验、R11 的 settler 都反复遇到：同义改写 = 新伏笔；无法表达“提及但不推进”；无法作废一条计划。InkOS 的 hookId + 状态机正是为解决这些。继续让 foundation/R11 写 text 身份，会把问题放大到开书阶段。

建议先做 hook 模型迁移，再做 foundation；至少支持 `hookId/status/type/expectedPayoff/notes/dependsOn`，并保留 text 展示。

### 4.4 事实需要有效期，否则“只追加”会污染正史

我们的 facts 是字符串数组，无法 expire；R11 settler 只能追加，旧事实错了就只能再加一条“覆盖”，检索与 brief 会同时看到两条。InkOS 的 `validUntilChapter` 与 `expire` 是结构性的，不是锦上添花。

建议事实改为 `subject/predicate/object + validFrom/validUntil`，旧字符串做一次兼容迁移；R9b/R11 的 validator/settler 同步适配。

### 4.5 角色卡与六字段不是二选一

六字段适合 brief 匹配与面板编辑；自由卡片适合承载“已知信息、关系压力、能力边界、开篇状态”。建议混合：六字段做索引，Markdown 卡做深层资料，brief 先选索引，需要时再读卡。这样不会一次性推翻现有 characters/brief/测试。

### 4.6 审稿需要证据结构，不只是问题文本

InkOS 的 observation 有 code、evidence、sourceRefs、assessment。我们的 review item 有位置/问题/建议，但没有“这段引文支持这条问题”的结构，也没有 resolved/unavailable 的稳定语义。R9b 已经引入了 evidenceVerified，说明这个方向是必要的；建议把审稿条目也升级为 observation 兼容结构。

## 5. 此前对拍为什么偏了

1. **验收被流程占据**：#19/#21/#22 的 token、路径、角色交接是硬问题，测试自然围绕流程；产物只验证“能落盘、能读回”。
2. **对拍矩阵按能力列，不按产物列**：角色、技能、动作都有行，摘要/规则/角色卡的结构没有行。
3. **把迁移成本当成不采用理由**：例如“新增 book_rules 会改 schema”，这是成本，不是信息损失比较；应先问“没有它，哪些消费者拿不到什么”，再决定。
4. **现有格式被当作不变量**：world/characters/plan 是早期设计，不是不可改的合同；R10 又把它当成既定前提。

## 6. 整改方向

### 阶段 A：产物合同 v2（先决定，不写代码）

产出一份独立合同，逐项定：

- 是否新增 `story_frame`、`volume_map`、`book_rules.md/json`；
- 角色卡采用混合还是替换；
- hook 是否升级为 hookId + 生命周期；
- fact 是否升级为三元组 + 有效期；
- 摘要是否结构化、旧文本如何兼容；
- 审稿是否升级为 observation；
- chapter plan 是否增加 threadRefs；
- 每项的消费者、迁移、兼容窗口、验收。

建议优先级：

| 优先级 | 产物 | 原因 |
| --- | --- | --- |
| P0 | hook 模型、story_frame、volume_map、book_rules、角色卡 | R10 直接产出这些；不先定就会固化旧格式 |
| P1 | 结构化章节摘要、observation 证据 | 影响 brief/检索/审稿，独立于 R10 |
| P2 | fact 三元组/有效期、chapter memo threadRefs | 影响 R11 settler 与状态精度 |
| P3 | context trace/token 预算、provenance/telemetry | R12 |

### 阶段 B：存储与迁移

- SQLite `WORK_SCHEMA_VERSION` 升级；新增表/列或 JSON 文档；
- 旧作品迁移：world → story_frame/world 拆分策略、characters 六字段 → 索引 + 卡、text hooks → hookId、string facts → triples；
- 备份/恢复/导出 manifest 同步；
- 兼容读取：旧格式可读，新写入只写新格式。

### 阶段 C：生产者

- architect 分阶段生成（R10b）；
- settler/summarizer 产出结构化摘要、hookOps/factOps；
- reviewer 产出 observation（code/evidence/sourceRefs）；
- planner 产出 threadRefs。

### 阶段 D：消费者

- brief/context 按新结构选择字段；
- 检索按摘要结构/hookId；
- 面板真值编辑、审阅证据、导出；
- R9b/R11 validator/settler 适配。

### 阶段 E：验收

- 每个产物有“结构合同 + 旧格式兼容 + 至少一个消费者”的测试；
- 不能只测“写入成功”。

## 7. 对 R10 的直接影响

当前 #44 的映射方案不是不能做，但它会把“world/plan/characters/text hooks”固化成 foundation 的输出。建议：

1. **暂停 #44 实现**，保持 `planning`；
2. 先立项 **A0 产物合同 v2**（或 R10a），把 P0 产物定下来；
3. R10 拆为 R10a（合同/存储）与 R10b（architect 分阶段生成）；
4. R9b/R11 已交付的 text hook/fact 逻辑需要在新合同下复审，不作为不可改的既有事实。

## 8. 需要用户裁决的问题

1. 是否接受“产物合同 v2”作为 R10 前置，而不是直接按现有格式实现？
2. P0 中哪些必须现在做：hookId、story_frame、volume_map、book_rules、角色卡——全部，还是先做 hook + foundation 最小集？
3. 角色卡：混合（六字段索引 + Markdown 卡）是否可接受？
4. 旧作品迁移策略：一次性迁移 vs 新旧双读、新写只写新格式？
5. 是否把结构化摘要/observation 放到 P1 独立工作项，不阻塞 R10b？

在以上问题定下来前，不把 R10 标成 ready，也不创建新的实现门禁。
