# InkOS 内容架构研究：Skill、资源文档与 Agent 结构化交接

这次研究发现一个重要特点：InkOS 并不把 Skill、创作资料和 Agent 输出都当成普通 Markdown 文本来处理。

在当前源码中，它们分别承担三种职责：

- Skill 和 References：提供创作方法，例如怎样规划场景、控制信息释放、审查人物动机。
- 作品内容资料：保存这部小说自己的题材、人物、规则、章纲、正文、伏笔和状态。
- Agent 结构化契约：定义 Planner、Writer、Reviewer、Settler 等角色必须交付什么，让运行时能够验证、保存和传递结果。

这三者分离，是 InkOS 内容组织方式中最值得深入研究的设计。

## 一、InkOS 的内容组织分层

主 Agent 与作品 Profile

理解用户意图 · 确定作品类型 · 激活相关能力

Skill 内容方法层

SKILL.md、创作指南、审阅标准

作品权威内容层

作品规则、章纲、人物、事实、伏笔

Agent 任务协议层

角色输入 · 结构化输出 · 来源证据 · 约束

Runtime 验证与内容更新

检查结果 · 更新作品状态 · 保存有效版本

具体来说，长篇小说有一个 `longform-novel` Work Profile，声明必要的 `inkos-long-writing` Skill、推荐的 `inkos-story-review` Skill，以及可生产的 `foundation`、`chapter-plan`、`chapter`、`review` 等内容类型。

这意味着：作品类型决定可用能力，Skill 决定专业创作方法，任务协议决定结果如何交付。

源码依据：[builtin-profiles.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/builtin-profiles.ts)、[contracts.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/contracts.ts)。

## 二、Skill 如何调用：不是全部加载，而是按任务激活

InkOS 有真正的 `use_skill` 工具实现，位于 [agent/skill-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agent/skill-tool.ts)。

它提供三种资源调用方式：

| 调用方式                     | 作用                         | 典型场景                 |
| ------------------------ | -------------------------- | -------------------- |
| 仅指定 `skillId`            | 激活 Skill 主文档以及其显式关联的参考资料   | 开始长篇创作任务             |
| `skillId + resourcePath` | 精确读取某个参考资源文件               | 明确需要状态投影规范           |
| `skillId + query`        | 根据自然语言，从 Skill 参考资料中检索相关章节 | 不知道具体资源路径，只知道要解决什么问题 |

第三种尤其重要。

例如 Agent 需要了解“如何避免章节中大量重复解释人物心理”，不一定要先知道对应资源文件名。它可以根据当前问题搜索 Skill References，并取得相关内容片段。

### 资源文档也被索引

在 `retrieveSkillResources()` 中，InkOS 会：

1. 枚举 Skill 的可读文本资源。
2. 将文档分段。
3. 为片段构建检索项。
4. 使用内存中的 `LocalSearchIndex` 进行相关性搜索。
5. 返回文件路径、标题、正文片段、字符位置及检索分数。

这里需要注意，它与作品长期记忆索引不是同一回事。

Skill 资源检索的对象是创作方法；作品记忆检索的对象是小说中已经发生的内容。

另外，InkOS 还会自动识别 `SKILL.md` 中显式引用的 `references/`、`examples/` 资源，加载这些关联文档。生产 Worker 在模型调用前也可以根据实际任务文字重新检索所需的资源段落。

这比始终把全部创作指南塞进提示词更灵活。不过，显式关联文档也会占用上下文，因此“按需”不意味着绝对只加载一个小片段。

### Skill 的激活不是永久有效的

源码还有一项容易被忽略的机制：Skill 指导会绑定到相应的激活轮次，并具有过期语义。不能因为上一次对话加载过某个方法，就认定它在后续所有任务中持续生效。

这实际上把方法资源生命周期与作品事实生命周期分开了。

## 三、Skill 的内容到底写什么？

以 [inkos-long-writing/SKILL.md](https://github.com/dehuadong/inkos/blob/master/packages/core/skills/inkos-long-writing/SKILL.md) 为例，它的主文件并不长，主要规定跨阶段共同遵守的创作原则。

例如：场景应有目标、阻力、变化和后果；人物行为应符合其欲望、认知、恐惧和代价；章节需要带来实质变化；修订应尽量保留有效正文。

详细内容则放在对应资源文档中。

| 资源文件                                  | 主要内容类型                | 加载时机         |
| ------------------------------------- | --------------------- | ------------ |
| `foundation-design.md`                | 全书构思、主线、深层因果、人物成长与卷结构 | 建立或重建作品基础时   |
| `reader-contract-and-progression.md`  | 阅读期待、悬念、兑现、剧情推进、连续节奏  | 规划、写作、审阅、修订  |
| `scene-dialogue-and-length-budget.md` | 场景构建、对话功能、篇幅容量、避免注水   | 场景及正文创作相关任务  |
| `state-projection.md`                 | 从已完成正文提取事实、伏笔与状态变化    | 正文观察、状态结算    |
| `review-matrix.md`                    | 题材相关审阅标准、问题分类和证据判断    | 完整审阅或标准存在争议时 |

这说明 InkOS 的 References 不是全部同一种“说明书”。

有些是内容创作方法，有些是评价标准，有些是事实提取规则。不同任务只需要其中一部分。

而且，Skill 不负责授予写文件、定稿或修改作品权威状态的权限，这由宿主能力和动作合同决定。

## 四、Agent 结构化内容：每个角色究竟接收和交付什么？

这部分是内容架构的核心。

InkOS 没有让所有 Agent 都返回一个通用的 `result.md`。它根据创作角色定义不同的输出 Schema，再由运行时检查。

源码主要位于 `packages/core/src/agents/` 和 `packages/core/src/models/`。

### 1. Architect：从创意生成作品基础

[architect-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/architect-tool.ts)

Architect 的输出分为几种内容：

| 内容类型   | 具体字段            | 用途                   |
| ------ | --------------- | -------------------- |
| 故事基础   | `storyFrame`    | 故事前提、核心冲突、动机、约束、因果走向 |
| 卷章方向   | `volumeMap`     | 卷结构、章节方向与简要因果节点      |
| 人工阅读规则 | `bookRules`     | 可读的 Markdown 作品规则    |
| 机器约束   | `bookRulesData` | 主角锁定、题材、人称、禁区等结构化数据  |
| 待推进伏笔  | `pendingHooks`  | 初始叙事承诺与未来回收方向        |
| 人物索引   | `roles`         | 主要和次要角色的识别信息         |
| 人物卡片   | 按人物生成的 Markdown | 动机、认知、关系压力和行为边界      |

这里有一个重要设计：先定义故事基础，再独立生产人物索引和人物卡片。

这避免了让一个 Agent 在同一次结构化调用中生成非常长的世界观、全书大纲、几十个人物传记和所有伏笔。

它将内容拆分为不同职责的交付物，但仍通过作品基础建立关联。

### 2. Planner：交付章节任务，而不是直接写正文

[planner-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/planner-tool.ts)

Planner 使用非常简洁的结构化结果：

```
{
  "goal": "本章必须完成的叙事目标",
  "body": "完整可读的章节规划",
  "threadRefs": ["H003", "H011"]
}
```

这里是根据真实 Schema 写出的示意值，而非仓库内某个实际章节。

- `goal`：章节结果目标。
- `body`：完整可读的规划内容，不强制把所有场景细节拆成 JSON。
- `threadRefs`：与当前章节有关的真实伏笔 ID。

值得注意的是，Planner 并非直接交给 Writer 一段没有上下文的章纲。

它首先通过 Composer 获得 `ContextPackage`，在其中找到相关历史资料，然后生成章节 Memo。

这意味着规划任务的结果可以追溯到它实际使用过哪些历史信息。

### 3. Writer：正文与状态结算分成两次任务

[writer.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/writer.ts)

Writer 的正文输出契约很简单：

```
{
  "title": "章节标题",
  "content": "完整章节正文"
}
```

没有要求正文 Agent 同时生成复杂的人物变化 JSON、伏笔数组和章节审阅报告。

源码中的 Writer 执行包含两个阶段：

第一阶段，创作正文。 按 Chapter Intent、Memo、ContextPackage、作品规则与专业 Skill 进行文学创作。

第二阶段，结算状态。 再从已经产生的正文中提取真实发生的事件、状态变化与伏笔活动，构造结构化 Delta。

这是一条很有价值的内容边界：

写作阶段以文学表达为主；结算阶段以事实识别和一致性为主。

需要注意，`WriterAgent` 在代码层承载了正文生产和结算调用，但两者是不同的结构化过程，不代表自由创作内容可以直接成为权威事实。

### 4. Reviewer：结构化审阅不是一个简单分数

[review-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/review-tool.ts)

Reviewer 的输出更接近一组有来源依据的问题：

示例审阅记录（根据 Schema 构造）

Issue：人物认知越界

quality

issue

第 28 章主角直接说出了自己尚未获知的秘密来源，需要核对此前章节的信息传递过程。

证据来源

第 28 章正文，第 83—88 行；此前事实来源需另行核对。

真实结构包括：

- 问题代码 `code`；
- 评价结果 `assessment`；
- 具体说明 `summary`；
- 类别 `quality / execution / scope`；
- 精确来源 `sourceRefs`，可以指向原文行范围。

这里最值得关注的是：审阅结果有独立的信息类型，不能用“总体评价”代替。

还可以把“正文质量问题”“执行结果不完整”“修改超出了作者授权范围”区分开。

### 5. Settler：把已经完成的正文转成结构化事实

[settler-tool.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/settler-tool.ts)

Settler 的结果是最有结构化特征的内容之一。

| 字段                  | 作用                 |
| ------------------- | ------------------ |
| `postSettlement`    | 概述本章真实引起的变化        |
| `factOps.upsert`    | 新增或更新当前有效事实        |
| `factOps.expire`    | 结束此前有效的事实          |
| `hookOps.upsert`    | 更新已有伏笔状态           |
| `hookOps.mention`   | 仅记录伏笔被提及，不算推进      |
| `hookOps.resolve`   | 记录伏笔正式回收           |
| `hookOps.defer`     | 明确延后某项伏笔           |
| `newHookCandidates` | 提出新伏笔候选，由宿主分配正式 ID |
| `chapterSummary`    | 生成供后续章节检索的结构化摘要    |

其中章节摘要不只是“本章发生了什么”，而是包含：

```
{
  "title": "章节标题",
  "characters": "人物及其活动",
  "events": "关键事件",
  "stateChanges": "状态变化",
  "hookActivity": "伏笔活动",
  "mood": "主要情绪",
  "chapterType": "章节类型"
}
```

这样的信息比普通的一段总结更容易用于跨章节检索。

例如，要检查最近十章是否连续使用同一种情绪，可以参考 `mood`；要检查伏笔是否真正推进，可以查看 `hookActivity` 并追踪关联 Hook ID。

但这些仍是模型提取的结构化内容，必须经过状态验证。Schema 合法不代表事实一定正确。

## 五、结构化输入：Agent 不只收到“上一步的文件”

InkOS 的 [input-governance.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/models/input-governance.ts) 定义了四种非常关键的结构。

| 结构               | 主要字段                         | 职责                 |
| ---------------- | ---------------------------- | ------------------ |
| `ChapterIntent`  | chapter、goal                 | 本章最基本的叙事目标         |
| `ChapterMemo`    | chapter、goal、body、threadRefs | 具体的章节创作任务          |
| `ContextPackage` | chapter、selectedContext      | 精选出的历史、事实及约束       |
| `ChapterTrace`   | 来源、预算、检索记录、压缩记录              | 记录 Agent 如何获得本次上下文 |

例如 `ContextPackage` 中的一条来源包含：

```
{
  "source": "chapter-summary:48",
  "reason": "当前剧情涉及此章建立的人物关系",
  "excerpt": "相关历史摘要片段",
  "protection": "compressible"
}
```

`protection` 可以是 `protected` 或 `compressible`。

这个字段不只是元数据，它会直接影响后续上下文编译能否压缩这条资料。

而 `ChapterTrace` 更进一步记录：

- Planner 使用过哪些来源；
- Composer 使用过哪些来源；
- 最终选择哪些来源；
- 受保护与可压缩内容分别占用多少 Token；
- 检索使用什么查询；
- 哪些候选被召回；
- 哪些来源经过语义筛选；
- 哪些内容被压缩。

这里能够看到一个完整的设计意图：不仅要知道 Agent 写了什么，还要知道它依据哪些内容写。

这对长篇创作中的“为什么忘记早期设定”“为什么用了已经失效的伏笔”等问题非常有价值。

## 六、InkOS 的内容类型应如何理解？

对照各个 Schema，我认为可以把 InkOS 的创作内容分为六类。这是为了分析而做的归纳，不是仓库原有的官方六层分类。

| 类型   | 代表内容                                            | 是否长期保存  | 是否直接作为作品事实    |
| ---- | ----------------------------------------------- | ------- | ------------- |
| 方法内容 | Skill、创作指南、审阅矩阵                                 | 随技能包保存  | 否             |
| 创作合同 | Story Frame、Book Rules、作者禁区                     | 是       | 属于约束权威        |
| 规划内容 | Volume Map、Chapter Memo、Intent                  | 是或任务期保存 | 否，计划不等于事实     |
| 作品内容 | 正文、人物卡片、卷章纲                                     | 是       | 正文是事实提取依据     |
| 状态内容 | Facts、Hooks、StateDelta、Chapter Summary          | 是       | 经验证提交后才成为状态权威 |
| 执行证据 | ContextPackage、ChapterTrace、Review Observations | 按流程保存   | 否，用于验证和追溯     |

这种区分的意义在于：不能用一份“全能 Story Bible”承载所有类型，也不能让每次 Agent 交接都重新解释这些内容的身份。

## 七、不同类型内容的实际调用顺序

以长篇章节创作为例，InkOS 的内容传递可以概括为：

作品基础与内容权威

Book Rules · Story Frame · 人物资料 · 当前事实

Composer：准备任务上下文

历史召回 · 伏笔引用 · 来源筛选 · Token 预算

Planner：确定章节任务

Chapter Intent · Memo · threadRefs

Writer：创作章节正文

Skill 方法 · 作品约束 · Memo · 相关历史资料

Reviewer / Reviser

问题证据、局部修订

Settler / Validator

事实变化、摘要、状态对账

经过验证的内容与状态更新

作为下一章的权威资料和检索来源

这是一个逻辑内容流，不表示每个产品动作都严格按照图中的单一次序执行。

这条链路有一个值得注意的特点：每个 Agent 不需要获得同样多、同样形式的资料。

Planner 重点需要目标、故事结构与历史承诺；Writer 重点需要实际场景、人物认知、文风和篇幅；Reviewer 重点需要正文、章节任务和证据；Settler 重点需要已经发生的事实以及旧状态。

统一提供一份超长提示词，反而会模糊它们的职责。

## 八、继续研究时，我发现的几个重要边界

### 1. 结构化字段不是越多越好

InkOS 的 Planner 只输出 `goal`、`body`、`threadRefs`。这说明它没有把每个文学创作细节都要求成机器字段。

相反，Settler 的状态操作高度结构化，因为这些字段直接决定状态机的变化。

它体现出一种区分：

需要机器判断、过滤和更新的数据，才值得强结构化；文学创作方法和开放性规划，应保留自然语言表达。

### 2. 方法检索与作品检索是两种不同的系统

Skill References 的召回解决“如何写”；章节事实和历史资料召回解决“以前写了什么”。

两者都可以使用 SQLite FTS5，但结果不能混在同一个没有来源分类的上下文中。

例如创作指南中出现“可以让主角隐藏秘密”，不应被误解成某部作品的主角已经隐藏了秘密。

### 3. 结构化章纲仍可能存在信息损失

Chapter Memo 的 `body` 是可读的 Markdown，`threadRefs` 只覆盖显式引用的伏笔。

如果重要的人物知识边界仅出现在一段模糊文字中，Runtime 未必能自动识别。

因此，即使存在强类型 Schema，也仍依赖上下文质量、Prompt 约束和后续审阅。

### 4. Skill 加载并不等于创作方法真正执行

`use_skill` 可以证明指南已经加载，却不能单独证明 Writer 确实完成了“场景出现变化”“伏笔得到推进”或者“人物行为符合认知”。

这些都需要从实际正文、审阅结果与状态变化寻找证据。

## 九、这次独立研究的主要发现

我认为 InkOS 在内容方向最有价值的，不是某一份 Skill 文档写得多详细，而是以下几个机制之间的关系：

第一，Skill 是专业方法资源。 主文件定义核心原则，Reference 保存具体创作方法和标准；可以按路径或语义检索，不必永远加载全部资源。

第二，作品内容拥有独立权威。 作者确认的规则、规划候选、已定稿正文与运行时事实有不同的身份，不能互相替代。

第三，Agent 输出由任务语义决定结构化程度。 Planner 使用简单的章节 Memo，Writer 交付正文，Reviewer 交付证据，Settler 交付精确状态操作。

第四，上下文来源可以追溯。 通过 ContextPackage 和 ChapterTrace，不只知道当前 Agent 使用了什么，还能分析它遗漏了什么、压缩了什么。

第五，真正的内容质量判断发生在执行结果上。 文档、Schema 和工具调用是约束基础，但无法替代对正文及其状态影响的审查。

### 下一步值得继续深挖的专题

如果延续当前的 InkOS 独立研究，我建议下一轮集中研究 “内容权威及各 Agent 的上下文交接”，具体追踪 Architect 产出的 Story Frame、Book Rules、人物卡片、Volume Map，如何被 Planner、Composer、Writer、Reviewer、Settler 使用，以及发生作者修改时哪些资料失效、哪些需要重新生成。

这一专题能与前面研究的“长期记忆、数据库索引和上下文管理”形成完整衔接 。