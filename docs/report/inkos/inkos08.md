# InkOS 第七轮研究：叙事因果依赖与历史修订影响范围

研究基线：[InkOS ](https://github.com/dehuadong/inkos/commit/8fc2ae57080b9821257dee3e37cc677e2b6f389a)[`master`](https://github.com/dehuadong/inkos/commit/8fc2ae57080b9821257dee3e37cc677e2b6f389a)[ · ](https://github.com/dehuadong/inkos/commit/8fc2ae57080b9821257dee3e37cc677e2b6f389a)[`8fc2ae57`](https://github.com/dehuadong/inkos/commit/8fc2ae57080b9821257dee3e37cc677e2b6f389a) · 本轮继续只研究 InkOS，不涉及 Novel 的改造

这一轮的研究重点是：历史章节发生改变后，能否依据现有结构化内容，准确找出真正受影响的后续章节，而不是机械地重新审阅所有章节？

## 一、核心结论

InkOS 已经记录了不少可以用于影响分析的信息，但它们的含义和可靠程度不同。

目前可以较可靠地确定“哪些事实、伏笔、来源发生了变化”，却还不能完整确定“哪些后续情节在因果上依赖这些变化”。

我将现有能力分为四种：

| 依赖类型   | InkOS 已有数据                                                | 能否确定关联                 |
| ------ | --------------------------------------------------------- | ---------------------- |
| 事实时序依赖 | `subject`、`predicate`、`object`、`sourceChapter`、有效章节区间     | 可以识别部分同类事实变化           |
| 伏笔显式依赖 | `hookId`、`dependsOn`、`startChapter`、`lastAdvancedChapter` | 有依赖字段，但完整校验与传播尚未实现     |
| 内容来源依赖 | `ChapterTrace`、`selectedSources`、Artifact Revision        | 可以追溯资料来源，缺少完整版本与反向引用   |
| 文学叙事因果 | `ChapterSummary.events`、`stateChanges`、Memo 正文            | 主要是自然语言，不能直接当成可靠的机器因果边 |

这一区分十分重要。

例如第 30 章失去一封信件，不一定意味着第 50 章的所有内容都无效；但第 65 章如果明确建立在“主角此前读过这封信”之上，便存在真实因果依赖。

检索相关性、事实关联和因果依赖是三件不同的事情。

## 二、Hook 的 `dependsOn`：InkOS 已有依赖字段，但尚未形成依赖图

这是本轮值得特别关注的源码发现。

在 [models/runtime-state.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/models/runtime-state.ts#L18-L29) 中，`HookRecord` 已经定义了：

```
{
  hookId: string;
  startChapter: number;
  status: HookStatus;
  lastAdvancedChapter: number;
  expectedPayoff: string;
  notes: string;
  dependsOn?: string[];
  paysOffInArc?: string;
}
```

其中：

- `dependsOn` 可以表达某项伏笔与其他对象的依赖关系；当前字段本身没有区分依赖目标的类型。
- `paysOffInArc` 可以记录预期在哪条剧情弧中兑现。

但字段存在，不等于依赖已经受到完整治理。

### 1. 已有的严格检查是什么？

`hook-arbiter.ts` 可以验证对已有 Hook 的更新必须使用已知的规范 ID，新的 Hook 由运行时统一分配 ID。

`state-reducer.ts` 会拒绝对不存在的 Hook 执行 `resolve`、`defer` 等操作。

因此，Hook 的身份和基本状态操作受到了保护。

### 2. `dependsOn` 还缺少哪些约束？

检查 [state-validator.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/state/state-validator.ts) 后发现，它会验证 Schema、重复 Hook ID、重复章节摘要等问题，但并未针对 `dependsOn` 建立以下检查：

- 被依赖的 Hook 是否真实存在；
- Hook 是否依赖自己；
- 是否存在循环依赖；
- 上游 Hook 已经撤销后，下游依赖是否需要处理。

还有一个更具体的细节。

[Reducer 的 ](https://github.com/dehuadong/inkos/blob/master/packages/core/src/state/state-reducer.ts#L124-L142)[`mergeHookRecord()`](https://github.com/dehuadong/inkos/blob/master/packages/core/src/state/state-reducer.ts#L124-L142) 在更新已有 Hook 时，主要合并起始章节、类型、状态、最近推进章节、预期回收和备注，并没有合并 `dependsOn` 与 `paysOffInArc`。

这意味着：已有 Hook 的这两个扩展字段不会通过普通状态更新得到同步维护。特别是新提交的依赖关系，不能仅因为 Schema 接受了它，就认为已经保存进当前 Hook。

结论：InkOS 的 Hook 模型具备依赖表达的雏形，但不具备经过完整验证、维护和传播的伏笔依赖图。

## 三、CurrentState：能够追踪事实何时有效，但缺少稳定的事实身份

InkOS 的 [CurrentStateFactSchema](https://github.com/dehuadong/inkos/blob/master/packages/core/src/models/runtime-state.ts#L58-L65) 是：

```
{
  subject: string;
  predicate: string;
  object: string;
  validFromChapter: number;
  validUntilChapter: number | null;
  sourceChapter: number;
}
```

它的优势是，可以表达同一个属性随章节变化。

例如：

| 章节      | 主角当前位置 | 状态         |
| ------- | ------ | ---------- |
| 第 12 章  | 客栈     | 生效         |
| 第 30 章  | 官署     | 生效，并结束此前位置 |
| 第 65 章  | 商铺     | 生效，并结束此前位置 |
| 第 120 章 | 城外     | 当前有效       |

Reducer 用 `subject + predicate` 识别同一类状态，新增不同值时使此前状态失效。

这种机制适合位置、持有物、人物关系状态等需要更新的事实。

但它的局限也很明确：

- 没有独立 `factId`。
- 没有规范化的实体 ID。
- 没有明确的事实间因果关系。
- `sourceChapter` 指向章节，不是某项原文证据或具体事件。
- `predicate` 是自然语言，不同措辞可能描述同一种关系。

因此可以识别“第 30 章写入的某项状态发生改变”，却不能直接据此推出“第 65 章的哪一次选择必然依赖该状态”。

它已经具备事实的时间追踪，但还不是完整的叙事事件依赖系统。

## 四、伏笔依赖不仅缺少校验，还可能在内容交接中丢失

进一步查看 [state-projections.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/state/state-projections.ts) 和 [memory-retrieval.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/utils/memory-retrieval.ts)，发现一个更深层的问题。

`HookRecord` 虽然定义了 `dependsOn` 和 `paysOffInArc`，但普通的伏笔 Markdown 投影只包含 Hook ID、起始章节、类型、状态、最近推进、预期回收与备注。

FTS5 构建 Hook 搜索文档时，也只使用状态、预期回收和备注。

| 数据环节                   | `dependsOn` 的实际情况      |
| ---------------------- | ---------------------- |
| Hook JSON Schema       | 可选字段，允许保存              |
| 新 Hook 候选              | 没有提交依赖目标的专门字段          |
| 普通 Hook 更新             | Reducer 不合并新提交的依赖字段    |
| Hook Markdown 投影       | 没有单独呈现依赖关系             |
| FTS5 搜索文本              | 没有将依赖关系作为结构化检索依据       |
| Planner 的 `threadRefs` | 记录相关 Hook ID，但不自动展开依赖链 |
| Validator              | 未见依赖目标与环路检查            |

因此，即使某个 Hook 在初始 JSON 中存在：

```
{
  "hookId": "H012",
  "dependsOn": ["H003", "H008"]
}
```

也不能推断 Writer 在处理 H012 时一定会得到 H003、H008 的历史。

这是内容结构存在、但没有贯穿存储、投影、召回和 Agent 执行的例子。

此外，InkOS 的 Hook 历史查找还会使用章节摘要中是否包含 Hook ID 来辅助定位。因为章节摘要的 `hookActivity` 是自由文本，写入方式不统一时，也可能出现漏匹配。

这进一步说明：稳定 ID 只有真正贯穿各环节，才能成为可靠的依赖关系。

## 五、ChapterSummary 和 ChapterTrace 能否用于推导因果？

答案是：能够提供候选证据，尚不足以自动证明因果。

### 1. ChapterSummary 记录的是文学事件摘要

例如：

```
{
  "chapter": 65,
  "characters": "男主、友人",
  "events": "男主因相信密信上的姓名，决定与友人合作",
  "stateChanges": "两人建立合作关系",
  "hookActivity": "H003 出现新的线索",
  "mood": "紧张",
  "chapterType": "investigation"
}
```

这类记录的信息价值非常高。

如果第 30 章删除了密信姓名，第 65 章摘要中的因果描述就成为重要线索。

但其 `events`、`stateChanges` 和 `hookActivity` 都是字符串，不存在强制的：

`eventId → causedBy → sourceFactId`

因此运行时无法只靠 Schema 判断：

> 第 65 章的合作行为依赖第 30 章的哪一条正式事实？

它需要重新阅读摘要或正文，进行语义判断。

### 2. ChapterTrace 记录的是信息使用来源

例如：

```
{
  "chapter": 65,
  "selectedSources": [
    "story/chapter_summaries.md#30",
    "story/pending_hooks.md#H003"
  ]
}
```

可以判断第 65 章创作时，加载过第 30 章摘要和 H003 伏笔。

但它无法证明第 65 章的某个行为确实依赖它们。

这产生两种问题：

误报：第 65 章虽然读过第 30 章摘要，但并未在剧情中使用相关事实。

漏报：Writer 根据其他资料或模型上下文写下了与第 30 章有关的情节，Trace 却没有显式指向第 30 章。

所以，`selectedSources` 可以用于构建候选影响关系，但不能直接升级成确定的叙事因果依赖。

## 六、实际案例：第 30 章变化后，能否缩小第 31～120 章的审查范围？

使用前面的密信案例：

第 30 章：删除主角发现密信姓名的事件

变更起点

第 65 章

基于姓名作出合作选择

明确的因果审查候选

第 80 章

处理与密信相关的 H003

伏笔关联候选

第 95 章

通过其他证据发现真相

需确认是否仍能独立成立

第 110 章

与密信无关的独立支线

可能无需正文修改

注意：上面各章的依赖关系是为了分析而构造的，并非 InkOS 已自动计算出的结果。

从现有数据，理论上可以推导出三种不同强度的影响。

| 级别      | 识别依据                                 | 可以得出的判断      |
| ------- | ------------------------------------ | ------------ |
| 确定的数据变化 | 修订前后 State Snapshot、事实来源章节、Hook 状态差异 | 哪些结构化事实发生了变化 |
| 高相关影响候选 | Hook ID、摘要中直接提到相关事件、Trace 中引用受影响来源   | 哪些章节应优先审阅    |
| 隐含因果候选  | 人物动机、对话逻辑、秘密传递、读者期待变化                | 需要结合正文进行语义分析 |

其中只有第一类相对适合确定性计算。

第二类可以降低审阅范围，但存在漏召回和误报。

第三类最难，例如第 95 章没有提及密信，却沿用了第 65 章建立的人物信任关系。这种间接因果可能跨越几十章，不一定能从关键词和来源路径中查出来。

因此，即使未来能建立依赖图，也需要区分“确定依赖”和“推测依赖”，不能将搜索相关性直接视为因果真相。

## 七、还有一个关键问题：历史正文修改后，检索到的摘要可能仍是旧版本

本轮将修订提交与长期记忆检索接起来检查，得到一个更具体的发现。

在 [runner.ts 的 ](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts#L1086-L1151)[`reviseDraft()`](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts#L1086-L1151) 中，修订非最新章节时，写入的是：

- 目标章节正文；
- `chapters/index.json`，包括下游审阅提示。

没有在该分支中提交新的 `state/chapter_summaries.json`、当前事实快照和伏笔状态。

与此同时，`memory-retrieval.ts` 每次重建 FTS5 记忆索引时，读取的是现有结构化章节摘要和伏笔状态。

这会形成一条值得重视的路径：

第 30 章正文

已修订

第 30 章结构化摘要

仍可能是旧内容

SQLite FTS5

根据旧摘要重建

下次 Writer 记忆召回

可能获得旧事实

这说明索引重建不等于事实纠正。

如果权威摘要没有完成修订后的重新结算，再先进的数据库检索也只会更有效地召回过时信息。

这种情况与前面发现的下游状态没有重算，是同一个问题的两种表现。

## 八、现有测试到底证明了什么？

| 测试                                | 已覆盖的机制                          | 没有覆盖的关键问题         |
| --------------------------------- | ------------------------------- | ----------------- |
| `state-reducer.test.ts`           | 事实 Upsert、Expire、Hook 状态、章节摘要更新 | 跨章节因果依赖识别         |
| `hook-arbiter.test.ts`            | Hook ID 分配、既有 ID 合法性和新增限制       | `dependsOn` 图的有效性 |
| `superseded-hooks.flow.test.ts`   | 撤销伏笔排除检索、保留已兑现历史                | 下游依赖该伏笔的章节是否失效    |
| `governed-working-set.test.ts`    | 按选中 Hook ID 缩小工作集               | 依赖 Hook 是否自动补齐    |
| `source-selection.flow.test.ts`   | 完整资料与语义筛选的切换、来源正确性              | 必要因果资料是否全部召回      |
| `persisted-governed-plan.test.ts` | Chapter Memo 持久化、复用和 Schema 校验  | 上游变更是否令旧 Memo 失效  |

所以不能根据这些测试全部通过，就认为历史修订的影响范围已经能够精确计算。

它们主要验证了数据结构和各自的局部操作，并非完整的叙事依赖传播。

## 九、本轮独立研究后的能力判断

| 能力                   | InkOS 当前判断       |
| -------------------- | ---------------- |
| 识别事实发生与失效的章节         | 已实现基础能力          |
| 保存 Hook 的稳定 ID 和生命周期 | 已实现              |
| 定义 Hook 对其他对象的依赖     | 有可选字段            |
| 验证并维护完整 Hook 依赖图     | 未见闭环             |
| 记录章节摘要和历史来源          | 已实现              |
| 记录 Agent 选择的上下文      | 已实现              |
| 根据来源构建候选影响关系         | 有可用数据基础，未见统一计算流程 |
| 自动确认跨章节隐含因果依赖        | 尚未证明             |
| 历史修订后自动更新全部权威摘要      | 未见完整实现           |
| 根据依赖范围有选择地重审下游章节     | 尚未实现可验证的完整机制     |

## 十、下一轮最值得开展的针对性验证

如果继续深入 InkOS，我认为下一轮应该从静态源码转向五组固定样例验证。

| 实验           | 需要回答的问题                                   |
| ------------ | ----------------------------------------- |
| Hook 依赖写入与更新 | `dependsOn` 能否保留？非法目标和循环关系是否被拒绝？          |
| 事实差异识别       | 第 30 章修改后，旧快照与新结算能否产生明确差异列表？              |
| 旧摘要污染        | 修改第 30 章后，检索是否仍返回原来的事件摘要？                 |
| 下游候选召回       | Hook、Summary、Trace 能否找出第 65 章，而不误判全部后续章节？ |
| 间接因果判断       | 第 95 章只使用第 65 章形成的关系时，能否追踪到第 30 章的影响？     |

本次尚未执行这些新增实验，所以对未闭环能力的判断仍基于数据结构、调用路径和已有测试，而非实测的误报率与漏报率。

### 最终研究认识

InkOS 的内容结构已经具备构建叙事依赖网络的基础数据，其中事实时序、Hook ID、章节摘要和上下文来源记录都很有价值。

但真正困难的是把它们转换为可信的因果关系，并在作者修改历史内容后决定：

哪些必须重新计算，哪些只需重新审阅，哪些虽然引用过旧资料却不受影响，以及哪些已经无法自动判断、必须交由作者裁决。

这比简单引入图数据库、向量数据库或更多 Agent 更关键。

本轮仍然只研究 InkOS，没有修改仓库，也没有提出 Novel 的实施方案。