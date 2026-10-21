# InkOS 深度研究：内容权威与各 Agent 的上下文交接

本轮以 [InkOS 的 ](https://github.com/dehuadong/inkos/tree/master/packages/core)[`packages/core`](https://github.com/dehuadong/inkos/tree/master/packages/core) 为依据，追踪完整的内容生命周期，而不是仅整理 Agent 职责。

我发现 InkOS 在内容组织上有三个值得特别关注的特点：

1. 作品权威并不是一份大而全的 Story Bible。 创作意图、作品基础、结构化规则、已发生事实、章节规划和伏笔状态分开保存，并按不同任务组合。
2. Agent 之间不只是传递上一阶段生成的文件。 Planner 和 Composer 会重新读取当前权威、按任务召回历史、筛选人物与伏笔，并生成具有来源信息的 `ContextPackage`。
3. 内容交接不是简单的流水线。 新的作者指令可能推翻旧规划；已经定稿的事件不能因为新规划出现就被视为不存在；历史章节修订也不能只改正文而忽略后续状态。

下面按源码实现追踪这三点。

## 一、InkOS 的内容权威体系

先区分两种不同的“权威”。

创作决策权威：决定故事应该如何发展，例如用户明确指定的结局、主角行为边界和当前章节要求。

叙事事实权威：记录故事已经发生了什么，例如人物是否得知秘密、物品属于谁、伏笔是否已经兑现。

这两类内容可能互相影响，但不能互相代替。

| 内容      | 典型存储或数据模型                   | 权威性质              | 消费它的角色                     |
| ------- | --------------------------- | ----------------- | -------------------------- |
| 作者长期意图  | `author_intent.md`          | 创作方向约束            | Planner、Composer、Writer    |
| 当前任务焦点  | `current_focus.md`          | 当前阶段的任务约束         | Planner、Composer           |
| 作品基础    | `outline/story_frame.md`    | 已建立的故事前提和框架       | Architect、Planner、Composer |
| 卷章发展规划  | `outline/volume_map.md`     | 规划基线，不是已发生事件      | Planner、Composer、Writer    |
| 可读作品规则  | `book_rules.md`             | 创作规范              | Writer、状态审阅                |
| 结构化作品规则 | `book_rules.json`           | 可机器读取的人称、主角与禁区等约束 | Writer、Settler             |
| 人物卡片    | `roles/主要角色/`、`roles/次要角色/` | 人物设定              | Composer、Planner、Writer    |
| 当前事实    | `current_state.json`        | 已结算的叙事状态          | Composer、Settler、Validator |
| 伏笔状态    | `pending_hooks` 对应结构化数据     | 当前有效的叙事承诺         | Planner、Composer、Settler   |
| 章节备忘    | `ChapterMemo`               | 单章节的执行要求          | Writer、Reviewer            |
| 已定稿章节   | `chapters/`                 | 已发表或已采纳的叙事正文依据    | Writer、Reviewer、Settler    |

这里有一个需要特别强调的地方：

作品基础与当前事实不同。

作品大纲中写“第 50 章主角可能得知秘密”，不能让 Settler 提前把“主角已经得知秘密”写入事实状态。

这条边界在 [settler-prompts.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/settler-prompts.ts) 中有明确约束。

## 二、Architect 如何生成作品基础：分阶段生产，而非一次生成所有资料

源码：[architect.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/architect.ts)、[architect-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/architect-tool.ts)。

实际实现分成四次结构化内容生产。

第一步：故事框架与卷章方向

storyFrame + volumeMap

第二步：作品规则与初始伏笔

bookRules + bookRulesData + pendingHooks

第三步：人物索引

roles = 人物名称 + major / minor

第四步：人物内容卡片

按人物分别生成动机、认知、关系压力与能力边界

这不是四次随意生成。每个后续阶段都会使用前面已经生成的相关资料。

例如，生成 Book Rules 时会提供 `storyFrame` 和 `volumeMap`；生成角色索引时又会使用前面的故事框架与作品规则。

人物卡片的要求也非常具体：中文卡片约 150—250 字，主要写开篇时的动机、已知信息、关系压力和能力边界，避免提前给所有人物编写冗长传记。

最后调用 `writeFoundationFiles()` 组织写入，并在初始化模式下创建初始运行时状态。

这里体现的内容方法是：先稳定故事整体，再展开局部内容；先建立人物身份索引，再按需生成足够支撑开篇的角色信息。

它也有边界：分阶段生成降低了单次输出复杂度，但不能单凭分阶段就证明人物卡片一定不与故事框架矛盾；仍需评审和验证。

## 三、Planner 与 Composer：不是一次交接，而是两次上下文选择

这是本轮源码追踪中很有价值的发现。

InkOS 的章节规划和章节创作，并不是统一构建一份上下文后，所有 Agent 原样使用。

### 第一次：为 Planner 选择规划上下文

`PlannerAgent.planChapter()` 会先读取：

- 作者长期意图、当前创作焦点和简要任务；
- 上一章的结尾衔接内容；
- 当前事实、相关角色和历史记忆；
- 当前任务所涉及的伏笔与规划资料。

然后通过 Composer 的 `selectTaskContext()` 选择相关信息，生成 `ChapterMemo`。

例如当前任务是“主角发现家族账册被伪造”，Planner 需要知道账册此前出现过什么、有哪些角色参与、哪些悬念尚未解决，才能确定本章的实际叙事目标。

### 第二次：根据 ChapterMemo 为 Writer 重建上下文

Planner 完成后，Composer 的 `composeChapter()` 会进一步使用：

章节目标 + 完整 Memo + `threadRefs` + 当前作品权威资料。

这意味着 Writer 使用的上下文，不完全等于 Planner 最初使用的上下文。

Planner 最初可能只是调查“账册被伪造”的情节，最终 Memo 决定让某个角色发现旧印章、推进伏笔 H011。第二次上下文选择就可以重点召回 H011 的埋设过程、最近推进和人物关联。

当前用户目标 + 作者意图 + 作品资料

第一次上下文选择

面向 Planner：帮助确定本章写什么

ChapterMemo

goal · body · threadRefs

第二次上下文选择

面向 Writer：补齐本章真正需要的事实与历史

ContextPackage + ChapterTrace

还有一个容易忽略的细节：ChapterMemo 既保存为可读 Markdown，也保存为类型化 JSON。

在 [persisted-governed-plan.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/persisted-governed-plan.ts) 中，`chapter-0001.plan.json` 被明确作为结构化规划的权威缓存；同目录的 `.intent.md` 主要用于人类阅读。

如果任务恢复时没有提供新的上下文指令，运行时在特定路径下可以复用已有结构化 Memo，从而避免重新调用 Planner。

这也引出一个需要审查的问题：复用规划之前，除了确认文件存在，还需要确定上游的作品基础是否已经变化。

## 四、Writer、Reviewer、Settler 的上下文不是同一套

| 角色              | 主要输入                                       | 关注的内容                | 交付物             |
| --------------- | ------------------------------------------ | -------------------- | --------------- |
| Writer          | Memo、ContextPackage、Book Rules、Style Guide | 正文情节、人物行动、信息释放、文风和字数 | 章节正文候选          |
| Reviewer        | 当前正文、任务上下文、原文来源                            | 质量、连续性、作者要求及修改范围     | 证据化审阅观察         |
| Reviser         | 原文、审阅问题、允许修改的范围、任务上下文                      | 修复问题并保留正确内容          | 修订正文            |
| Settler         | 最终正文、旧状态、Memo 和权威约束                        | 提取已经发生的事件与有效状态变化     | StateDelta、章节摘要 |
| State Validator | 旧状态、新状态、章节正文、故事基础及规则                       | 核对事实变化是否可靠           | 对账结果与问题观察       |

有三处具体实现尤其值得研究。

Writer 的规则输入是双轨的。 `rules-reader.ts` 同时读取 `book_rules.md` 和 `book_rules.json`。前者是完整的可读创作指导，后者包含人称、主角人格锁、行为限制和禁区等结构化约束。

Reviewer 使用精确原文证据。 [continuity.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/continuity.ts) 会构建带行号的来源材料；在有持久化版本时，还能比较当前版本和先前版本，检查是否修改了作者未授权的范围。

Settler 的结果需要独立验证。 Writer 的状态结算结果不直接等于最终事实。`StateValidatorAgent` 会结合旧状态、提出的新状态、正文及作品规则进行对账。验证发现问题时，系统可以尝试重新结算，而不是让 Settler 自行宣布正确。

一个很重要的运行顺序细节是：InkOS 的 `WriterAgent.writeChapter()` 内部可以先产生正文和初步状态 Delta；Pipeline 在审阅后还会针对最终要保存的正文检查或重新结算状态。因此，只有与最终正文对应的状态结果，才适合作为持久化依据。

源码：[writer.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/writer.ts)、[pipeline/runner.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts)。

## 五、作者改变创作方向后，InkOS 如何处理权威变化？

这是内容交接系统最容易出现连锁问题的环节。

假设作品原本计划让某位配角成为反派，写到第 30 章时，作者决定取消这个设定。

此时至少涉及四种不同内容：

- 基础设定：原本的人物动机和主线安排。
- 章节规划：后续章节可能安排了该人物的反派行动。
- 已发生事实：之前 30 章中真实发生的事情。
- 未兑现承诺：此前针对这个人物建立的悬念和伏笔。

InkOS 并不允许简单地将四者全部替换。

### 1. 基础设定修订：重新生成，但保留状态历史

`PipelineRunner.reviseFoundation()` 的实际行为包括：

1. 读取原有 Story Frame、Volume Map、Book Rules 和人物资料。
2. 连同作者新的修改要求交给 Architect。
3. 重新生成作品基础内容。
4. 备份原有基础文档，更新相关文件。
5. 对不再属于新版角色索引的人物 Markdown 卡片进行清理。
6. 同步更新后的内容版本。

这里值得关注的是，基础修订不会直接重置已经存在的运行时章节事实。

[foundation-revision.flow.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/foundation-revision.flow.test.ts) 也验证了基础设定变化时保留当前运行状态、历史资料和非角色素材。

### 2. 伏笔撤销：不是删除，而是 Superseded

InkOS 的 Reducer 支持将尚未兑现的伏笔标记为 `superseded`。

但需要有明确的撤销理由；已经正式兑现的伏笔不能直接通过相同操作撤销。

换言之：

> 新的作者决定可以让旧计划失效，却不能自动抹掉过去已发生的事情。

对应实现：[state-reducer.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/state/state-reducer.ts)。

### 3. 修改历史章节：标记下游受影响内容

在 `runner.ts` 的 `reviseDraft()` 中，如果修订的不是最新章节，系统不会直接把历史章节的状态覆盖到当前故事状态。

它会更新目标章节，并对后续章节添加 `upstream-revision` 观察，提示这些章节需要重新检查连续性。

这意味着 InkOS 至少实现了下游影响标记。

但它不等于已经自动完成所有下游章节的重算、再审和重写。

### 4. 还存在需要继续验证的失效边界

从目前审查的代码看，值得特别检查的是：

| 内容                     | 已确认的处理           | 尚需进一步证明                  |
| ---------------------- | ---------------- | ------------------------ |
| Story Frame、Volume Map | 可以修订并同步版本        | 旧 Chapter Memo 是否全部识别为过期 |
| 人物卡片                   | 可重新生成、删除不再使用的角色卡 | 后续上下文引用是否全面失效            |
| Runtime State          | 基础设定修订不直接重置事实    | 新旧权威矛盾是否全部可检测            |
| 历史章节                   | 版本保留、下游审查提示      | 全量下游因果关系是否自动修复           |
| 伏笔                     | 显式撤销、保留理由        | 所有使用该伏笔的规划是否同步调整         |
| 检索与 ContextPackage     | 可重新读取、重新选择内容     | 已保存的上下文是否具有完整来源版本绑定      |

尤其是 `resolveGovernedPlan()`：它支持在没有新输入时复用已经保存的 Memo。但从这一入口来看，尚不能证明复用时会验证所有上游基础设定的版本是否变化。

这是缓存有效性与创作权威一致性的问题，不能只用“已有版本管理”来回答。

## 六、内容来源及权威版本：Artifact 体系解决了什么？

InkOS 还有一层独立于 Story Frame、StateDelta 的 Artifact Revision 管理。

源码：[artifact-revisions.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/artifact-revisions.ts)、[source-sync.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/source-sync.ts)。

每个 Artifact 可以保留：

| 字段                 | 作用                                 |
| ------------------ | ---------------------------------- |
| `artifactId`       | 稳定识别某份产物                           |
| `revisionId`       | 识别具体版本                             |
| `parentRevisionId` | 记录版本继承关系                           |
| `checksum`         | 验证内容                               |
| `status`           | `candidate`、`current`、`superseded` |
| `snapshotPath`     | 保留历史版本位置                           |
| `episodeId`        | 关联执行任务                             |

与作品中的伏笔 `superseded` 不同，这里的 `superseded` 指的是文件版本已被后续版本取代。

这两个概念不能混淆。

一份章节 Artifact 的版本流

Revision A

旧版本

Revision B

当前版本

Review 可以在需要时同时读取 A 和 B，判断修订是否符合作者授权范围。

这种版本管理带来的能力是：Reviewer 不必只相信 Agent 说“已经修好了”，而可以对照实际保存的两个版本。

不过，Artifact 的版本身份与 ContextPackage 中的文本来源 ID 并不是完全相同的结构。

ContextPackage 可以记录 `story/chapter_summaries.md#48` 这样的来源指针，但这个指针本身未必完整包含所依据的 Artifact Revision ID、内容哈希和当时的状态版本。

要证明历史上下文可以精确重现，还需要进一步检查这些版本之间的绑定。

## 七、对这套内容交接机制的综合评价

综合本轮审查，可以将 InkOS 已实现的能力与仍需核实的能力区分如下。

| 机制                          | 代码核查结果                              | 研究判断     |
| --------------------------- | ----------------------------------- | -------- |
| 分阶段生成 Story Foundation      | 有明确的多次结构化调用和落盘逻辑                    | 已实现      |
| 作品规则 Markdown + JSON        | 有双轨规则文件和读取器                         | 已实现      |
| Planner 的结构化 Chapter Memo   | 有 Schema、持久化和复用入口                   | 已实现      |
| 按任务构建 Writer ContextPackage | 有 Composer 选择、记忆召回及预算机制             | 已实现      |
| 不同 Agent 使用不同资料             | 有独立 Prompt 和任务输入合同                  | 已实现      |
| Reviewer 原文与版本证据            | 有来源行号和 Artifact 版本比较                | 已实现      |
| Settler 与事实状态对账             | 有 StateDelta、Reducer、Validator      | 已实现      |
| 作者改变基础设定                    | 有基础重建、备份和历史保护                       | 已实现核心机制  |
| 基础变化后的规划全面失效                | 尚缺完整的验证证据                           | 需深入      |
| 历史章节修订后的全量下游重算              | 已有影响标记，但不等于全部自动修复                   | 部分能力     |
| 上下文来源的精确版本重现                | 有来源轨迹和 Artifact Revision，两者完整绑定尚需核实 | 需深入      |
| Skill 对创作效果的实际提升            | 有内容规则及激活记录                          | 需要作品质量测试 |

## 八、最值得继续研究的内容方向

从内容角度看，接下来我认为还有四个重要专题，均可以继续在 InkOS 内部独立研究。

A. 作品基础合同的细粒度权威。 作者意图、Story Frame、Book Rules、人物卡片、当前状态之间出现不同结论时，运行时到底如何确定冲突来源、权威优先级和恢复路径？尤其需要追踪作者变更在多个文件之间如何传播。

B. Chapter Memo 的内容设计。 这一项值得深入到实际样例。InkOS 的 [persisted-governed-plan.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/persisted-governed-plan.test.ts) 已包含场景篇幅预算、读者等待的问题、兑现与暂缓、人物选择、章尾变化和伏笔任务。需要区分哪些属于自由文本创作方法，哪些值得变成可机器检查的字段。

C. Agent 上下文的信息充分性。 重点不是选取了多少资料，而是 Planner、Writer、Reviewer、Settler 是否分别拿到了完成任务所必需的资料；如何发现被遗漏的角色信息、已改变的作者决定和过期的章节摘要。

D. 内容修改后的依赖失效与再生成。 重点追踪 Story Frame 改变后，旧 Memo、人物卡片、伏笔、章节摘要、检索索引和 ContextPackage 的生命周期，判断哪些会自动更新、哪些仅添加提示、哪些需要作者或 Agent 主动处理。

### 本轮最重要的结论

InkOS 的内容系统已经不仅是“Skill 指导 Agent 写 Markdown”，而是具备：

分层作品内容 → 按任务召回 → 类型化章节规划 → 受约束正文创作 → 证据化审阅 → 状态结算 → 版本化保存。

但最关键、也最值得# InkOS 深度研究：内容权威与各 Agent 的上下文交接

本轮以 [InkOS 的 ](https://github.com/dehuadong/inkos/tree/master/packages/core)[`packages/core`](https://github.com/dehuadong/inkos/tree/master/packages/core) 为依据，追踪完整的内容生命周期，而不是仅整理 Agent 职责。

我发现 InkOS 在内容组织上有三个值得特别关注的特点：

1. 作品权威并不是一份大而全的 Story Bible。 创作意图、作品基础、结构化规则、已发生事实、章节规划和伏笔状态分开保存，并按不同任务组合。
2. Agent 之间不只是传递上一阶段生成的文件。 Planner 和 Composer 会重新读取当前权威、按任务召回历史、筛选人物与伏笔，并生成具有来源信息的 `ContextPackage`。
3. 内容交接不是简单的流水线。 新的作者指令可能推翻旧规划；已经定稿的事件不能因为新规划出现就被视为不存在；历史章节修订也不能只改正文而忽略后续状态。

下面按源码实现追踪这三点。

## 一、InkOS 的内容权威体系

先区分两种不同的“权威”。

创作决策权威：决定故事应该如何发展，例如用户明确指定的结局、主角行为边界和当前章节要求。

叙事事实权威：记录故事已经发生了什么，例如人物是否得知秘密、物品属于谁、伏笔是否已经兑现。

这两类内容可能互相影响，但不能互相代替。

| 内容      | 典型存储或数据模型                   | 权威性质              | 消费它的角色                     |
| ------- | --------------------------- | ----------------- | -------------------------- |
| 作者长期意图  | `author_intent.md`          | 创作方向约束            | Planner、Composer、Writer    |
| 当前任务焦点  | `current_focus.md`          | 当前阶段的任务约束         | Planner、Composer           |
| 作品基础    | `outline/story_frame.md`    | 已建立的故事前提和框架       | Architect、Planner、Composer |
| 卷章发展规划  | `outline/volume_map.md`     | 规划基线，不是已发生事件      | Planner、Composer、Writer    |
| 可读作品规则  | `book_rules.md`             | 创作规范              | Writer、状态审阅                |
| 结构化作品规则 | `book_rules.json`           | 可机器读取的人称、主角与禁区等约束 | Writer、Settler             |
| 人物卡片    | `roles/主要角色/`、`roles/次要角色/` | 人物设定              | Composer、Planner、Writer    |
| 当前事实    | `current_state.json`        | 已结算的叙事状态          | Composer、Settler、Validator |
| 伏笔状态    | `pending_hooks` 对应结构化数据     | 当前有效的叙事承诺         | Planner、Composer、Settler   |
| 章节备忘    | `ChapterMemo`               | 单章节的执行要求          | Writer、Reviewer            |
| 已定稿章节   | `chapters/`                 | 已发表或已采纳的叙事正文依据    | Writer、Reviewer、Settler    |

这里有一个需要特别强调的地方：

作品基础与当前事实不同。

作品大纲中写“第 50 章主角可能得知秘密”，不能让 Settler 提前把“主角已经得知秘密”写入事实状态。

这条边界在 [settler-prompts.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/settler-prompts.ts) 中有明确约束。

## 二、Architect 如何生成作品基础：分阶段生产，而非一次生成所有资料

源码：[architect.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/architect.ts)、[architect-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/architect-tool.ts)。

实际实现分成四次结构化内容生产。

第一步：故事框架与卷章方向

storyFrame + volumeMap

第二步：作品规则与初始伏笔

bookRules + bookRulesData + pendingHooks

第三步：人物索引

roles = 人物名称 + major / minor

第四步：人物内容卡片

按人物分别生成动机、认知、关系压力与能力边界

这不是四次随意生成。每个后续阶段都会使用前面已经生成的相关资料。

例如，生成 Book Rules 时会提供 `storyFrame` 和 `volumeMap`；生成角色索引时又会使用前面的故事框架与作品规则。

人物卡片的要求也非常具体：中文卡片约 150—250 字，主要写开篇时的动机、已知信息、关系压力和能力边界，避免提前给所有人物编写冗长传记。

最后调用 `writeFoundationFiles()` 组织写入，并在初始化模式下创建初始运行时状态。

这里体现的内容方法是：先稳定故事整体，再展开局部内容；先建立人物身份索引，再按需生成足够支撑开篇的角色信息。

它也有边界：分阶段生成降低了单次输出复杂度，但不能单凭分阶段就证明人物卡片一定不与故事框架矛盾；仍需评审和验证。

## 三、Planner 与 Composer：不是一次交接，而是两次上下文选择

这是本轮源码追踪中很有价值的发现。

InkOS 的章节规划和章节创作，并不是统一构建一份上下文后，所有 Agent 原样使用。

### 第一次：为 Planner 选择规划上下文

`PlannerAgent.planChapter()` 会先读取：

- 作者长期意图、当前创作焦点和简要任务；
- 上一章的结尾衔接内容；
- 当前事实、相关角色和历史记忆；
- 当前任务所涉及的伏笔与规划资料。

然后通过 Composer 的 `selectTaskContext()` 选择相关信息，生成 `ChapterMemo`。

例如当前任务是“主角发现家族账册被伪造”，Planner 需要知道账册此前出现过什么、有哪些角色参与、哪些悬念尚未解决，才能确定本章的实际叙事目标。

### 第二次：根据 ChapterMemo 为 Writer 重建上下文

Planner 完成后，Composer 的 `composeChapter()` 会进一步使用：

章节目标 + 完整 Memo + `threadRefs` + 当前作品权威资料。

这意味着 Writer 使用的上下文，不完全等于 Planner 最初使用的上下文。

Planner 最初可能只是调查“账册被伪造”的情节，最终 Memo 决定让某个角色发现旧印章、推进伏笔 H011。第二次上下文选择就可以重点召回 H011 的埋设过程、最近推进和人物关联。

当前用户目标 + 作者意图 + 作品资料

第一次上下文选择

面向 Planner：帮助确定本章写什么

ChapterMemo

goal · body · threadRefs

第二次上下文选择

面向 Writer：补齐本章真正需要的事实与历史

ContextPackage + ChapterTrace

还有一个容易忽略的细节：ChapterMemo 既保存为可读 Markdown，也保存为类型化 JSON。

在 [persisted-governed-plan.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/persisted-governed-plan.ts) 中，`chapter-0001.plan.json` 被明确作为结构化规划的权威缓存；同目录的 `.intent.md` 主要用于人类阅读。

如果任务恢复时没有提供新的上下文指令，运行时在特定路径下可以复用已有结构化 Memo，从而避免重新调用 Planner。

这也引出一个需要审查的问题：复用规划之前，除了确认文件存在，还需要确定上游的作品基础是否已经变化。

## 四、Writer、Reviewer、Settler 的上下文不是同一套

| 角色              | 主要输入                                       | 关注的内容                | 交付物             |
| --------------- | ------------------------------------------ | -------------------- | --------------- |
| Writer          | Memo、ContextPackage、Book Rules、Style Guide | 正文情节、人物行动、信息释放、文风和字数 | 章节正文候选          |
| Reviewer        | 当前正文、任务上下文、原文来源                            | 质量、连续性、作者要求及修改范围     | 证据化审阅观察         |
| Reviser         | 原文、审阅问题、允许修改的范围、任务上下文                      | 修复问题并保留正确内容          | 修订正文            |
| Settler         | 最终正文、旧状态、Memo 和权威约束                        | 提取已经发生的事件与有效状态变化     | StateDelta、章节摘要 |
| State Validator | 旧状态、新状态、章节正文、故事基础及规则                       | 核对事实变化是否可靠           | 对账结果与问题观察       |

有三处具体实现尤其值得研究。

Writer 的规则输入是双轨的。 `rules-reader.ts` 同时读取 `book_rules.md` 和 `book_rules.json`。前者是完整的可读创作指导，后者包含人称、主角人格锁、行为限制和禁区等结构化约束。

Reviewer 使用精确原文证据。 [continuity.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/continuity.ts) 会构建带行号的来源材料；在有持久化版本时，还能比较当前版本和先前版本，检查是否修改了作者未授权的范围。

Settler 的结果需要独立验证。 Writer 的状态结算结果不直接等于最终事实。`StateValidatorAgent` 会结合旧状态、提出的新状态、正文及作品规则进行对账。验证发现问题时，系统可以尝试重新结算，而不是让 Settler 自行宣布正确。

一个很重要的运行顺序细节是：InkOS 的 `WriterAgent.writeChapter()` 内部可以先产生正文和初步状态 Delta；Pipeline 在审阅后还会针对最终要保存的正文检查或重新结算状态。因此，只有与最终正文对应的状态结果，才适合作为持久化依据。

源码：[writer.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/writer.ts)、[pipeline/runner.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts)。

## 五、作者改变创作方向后，InkOS 如何处理权威变化？

这是内容交接系统最容易出现连锁问题的环节。

假设作品原本计划让某位配角成为反派，写到第 30 章时，作者决定取消这个设定。

此时至少涉及四种不同内容：

- 基础设定：原本的人物动机和主线安排。
- 章节规划：后续章节可能安排了该人物的反派行动。
- 已发生事实：之前 30 章中真实发生的事情。
- 未兑现承诺：此前针对这个人物建立的悬念和伏笔。

InkOS 并不允许简单地将四者全部替换。

### 1. 基础设定修订：重新生成，但保留状态历史

`PipelineRunner.reviseFoundation()` 的实际行为包括：

1. 读取原有 Story Frame、Volume Map、Book Rules 和人物资料。
2. 连同作者新的修改要求交给 Architect。
3. 重新生成作品基础内容。
4. 备份原有基础文档，更新相关文件。
5. 对不再属于新版角色索引的人物 Markdown 卡片进行清理。
6. 同步更新后的内容版本。

这里值得关注的是，基础修订不会直接重置已经存在的运行时章节事实。

[foundation-revision.flow.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/foundation-revision.flow.test.ts) 也验证了基础设定变化时保留当前运行状态、历史资料和非角色素材。

### 2. 伏笔撤销：不是删除，而是 Superseded

InkOS 的 Reducer 支持将尚未兑现的伏笔标记为 `superseded`。

但需要有明确的撤销理由；已经正式兑现的伏笔不能直接通过相同操作撤销。

换言之：

> 新的作者决定可以让旧计划失效，却不能自动抹掉过去已发生的事情。

对应实现：[state-reducer.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/state/state-reducer.ts)。

### 3. 修改历史章节：标记下游受影响内容

在 `runner.ts` 的 `reviseDraft()` 中，如果修订的不是最新章节，系统不会直接把历史章节的状态覆盖到当前故事状态。

它会更新目标章节，并对后续章节添加 `upstream-revision` 观察，提示这些章节需要重新检查连续性。

这意味着 InkOS 至少实现了下游影响标记。

但它不等于已经自动完成所有下游章节的重算、再审和重写。

### 4. 还存在需要继续验证的失效边界

从目前审查的代码看，值得特别检查的是：

| 内容                     | 已确认的处理           | 尚需进一步证明                  |
| ---------------------- | ---------------- | ------------------------ |
| Story Frame、Volume Map | 可以修订并同步版本        | 旧 Chapter Memo 是否全部识别为过期 |
| 人物卡片                   | 可重新生成、删除不再使用的角色卡 | 后续上下文引用是否全面失效            |
| Runtime State          | 基础设定修订不直接重置事实    | 新旧权威矛盾是否全部可检测            |
| 历史章节                   | 版本保留、下游审查提示      | 全量下游因果关系是否自动修复           |
| 伏笔                     | 显式撤销、保留理由        | 所有使用该伏笔的规划是否同步调整         |
| 检索与 ContextPackage     | 可重新读取、重新选择内容     | 已保存的上下文是否具有完整来源版本绑定      |

尤其是 `resolveGovernedPlan()`：它支持在没有新输入时复用已经保存的 Memo。但从这一入口来看，尚不能证明复用时会验证所有上游基础设定的版本是否变化。

这是缓存有效性与创作权威一致性的问题，不能只用“已有版本管理”来回答。

## 六、内容来源及权威版本：Artifact 体系解决了什么？

InkOS 还有一层独立于 Story Frame、StateDelta 的 Artifact Revision 管理。

源码：[artifact-revisions.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/artifact-revisions.ts)、[source-sync.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/source-sync.ts)。

每个 Artifact 可以保留：

| 字段                 | 作用                                 |
| ------------------ | ---------------------------------- |
| `artifactId`       | 稳定识别某份产物                           |
| `revisionId`       | 识别具体版本                             |
| `parentRevisionId` | 记录版本继承关系                           |
| `checksum`         | 验证内容                               |
| `status`           | `candidate`、`current`、`superseded` |
| `snapshotPath`     | 保留历史版本位置                           |
| `episodeId`        | 关联执行任务                             |

与作品中的伏笔 `superseded` 不同，这里的 `superseded` 指的是文件版本已被后续版本取代。

这两个概念不能混淆。

一份章节 Artifact 的版本流

Revision A

旧版本

Revision B

当前版本

Review 可以在需要时同时读取 A 和 B，判断修订是否符合作者授权范围。

这种版本管理带来的能力是：Reviewer 不必只相信 Agent 说“已经修好了”，而可以对照实际保存的两个版本。

不过，Artifact 的版本身份与 ContextPackage 中的文本来源 ID 并不是完全相同的结构。

ContextPackage 可以记录 `story/chapter_summaries.md#48` 这样的来源指针，但这个指针本身未必完整包含所依据的 Artifact Revision ID、内容哈希和当时的状态版本。

要证明历史上下文可以精确重现，还需要进一步检查这些版本之间的绑定。

## 七、对这套内容交接机制的综合评价

综合本轮审查，可以将 InkOS 已实现的能力与仍需核实的能力区分如下。

| 机制                          | 代码核查结果                              | 研究判断     |
| --------------------------- | ----------------------------------- | -------- |
| 分阶段生成 Story Foundation      | 有明确的多次结构化调用和落盘逻辑                    | 已实现      |
| 作品规则 Markdown + JSON        | 有双轨规则文件和读取器                         | 已实现      |
| Planner 的结构化 Chapter Memo   | 有 Schema、持久化和复用入口                   | 已实现      |
| 按任务构建 Writer ContextPackage | 有 Composer 选择、记忆召回及预算机制             | 已实现      |
| 不同 Agent 使用不同资料             | 有独立 Prompt 和任务输入合同                  | 已实现      |
| Reviewer 原文与版本证据            | 有来源行号和 Artifact 版本比较                | 已实现      |
| Settler 与事实状态对账             | 有 StateDelta、Reducer、Validator      | 已实现      |
| 作者改变基础设定                    | 有基础重建、备份和历史保护                       | 已实现核心机制  |
| 基础变化后的规划全面失效                | 尚缺完整的验证证据                           | 需深入      |
| 历史章节修订后的全量下游重算              | 已有影响标记，但不等于全部自动修复                   | 部分能力     |
| 上下文来源的精确版本重现                | 有来源轨迹和 Artifact Revision，两者完整绑定尚需核实 | 需深入      |
| Skill 对创作效果的实际提升            | 有内容规则及激活记录                          | 需要作品质量测试 |

## 八、最值得继续研究的内容方向

从内容角度看，接下来我认为还有四个重要专题，均可以继续在 InkOS 内部独立研究。

A. 作品基础合同的细粒度权威。 作者意图、Story Frame、Book Rules、人物卡片、当前状态之间出现不同结论时，运行时到底如何确定冲突来源、权威优先级和恢复路径？尤其需要追踪作者变更在多个文件之间如何传播。

B. Chapter Memo 的内容设计。 这一项值得深入到实际样例。InkOS 的 [persisted-governed-plan.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/persisted-governed-plan.test.ts) 已包含场景篇幅预算、读者等待的问题、兑现与暂缓、人物选择、章尾变化和伏笔任务。需要区分哪些属于自由文本创作方法，哪些值得变成可机器检查的字段。

C. Agent 上下文的信息充分性。 重点不是选取了多少资料，而是 Planner、Writer、Reviewer、Settler 是否分别拿到了完成任务所必需的资料；如何发现被遗漏的角色信息、已改变的作者决定和过期的章节摘要。

D. 内容修改后的依赖失效与再生成。 重点追踪 Story Frame 改变后，旧 Memo、人物卡片、伏笔、章节摘要、检索索引和 ContextPackage 的生命周期，判断哪些会自动更新、哪些仅添加提示、哪些需要作者或 Agent 主动处理。

### 本轮最重要的结论

InkOS 的内容系统已经不仅是“Skill 指导 Agent 写 Markdown”，而是具备：

分层作品内容 → 按任务召回 → 类型化章节规划 → 受约束正文创作 → 证据化审阅 → 状态结算 → 版本化保存。

但最关键、也最值得下一轮研究的，恰恰是它们之间的权威一致性：作者改变了一个创作决定后，如何确保以后每个 Agent 使用的都是正确版本，并且不会将已经失效的旧规划当作有效指令。

这次仍然只是 InkOS 的独立源码研究，没有对 Novel 作设计判断，也没有修改任何仓库。的，恰恰是它们之间的权威一致性：作者改变了一个创作决定后，如何确保以后每个 Agent 使用的都是正确版本，并且不会将已经失效的旧规划当作有效指令。

这次仍然只是 InkOS 的独立源码研究，没有对 Novel 作设计判断，也没有修改任何仓库。