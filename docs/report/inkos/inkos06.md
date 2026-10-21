# InkOS 第五轮研究：内容依赖图、版本绑定、失效传播与记忆召回完整性

研究基线：InkOS `master` · commit `8fc2ae57` · 仅研究 InkOS，不涉及 Novel 设计

本轮沿着 InkOS 的真实调用链，重点审查了 `Artifact Revision`、`Work Lineage`、`ChapterMemo`、`ContextPackage`、`ChapterTrace`、`Runtime State`、SQLite 检索，以及历史章节修订过程。

## 一、先说本轮最重要的发现

InkOS 已具备内容依赖追踪所需要的多个基础机制，但这些机制还没有形成一个完整、统一的内容依赖与失效管理闭环。

尤其发现了两个值得进一步验证的问题：

问题 A：旧 Chapter Memo 可能复用已经失效的创作依据。

当前持久化 Memo 只记录章节任务和输入来源标识，没有完整绑定这些来源的版本。复用时也没有看到针对 Story Frame、Book Rules、人物卡片等上游资料的版本一致性检查。

问题 B：历史章节修订可能接触到未来才产生的事实。

修订第 30 章时，InkOS 会正确读取第 29 章快照作为状态结算基线；但是 Reviser 的任务上下文却可能来自当前最新状态，例如第 120 章的状态。

这是本轮比单纯“缺少依赖图”更具体的发现。

## 二、InkOS 实际拥有哪几种依赖关系？

InkOS 目前并非完全没有依赖管理，而是存在四套用途不同的关系。

| 关系类型          | 已实现的记录                                                         | 解决的问题           |
| ------------- | -------------------------------------------------------------- | --------------- |
| Work 来源依赖     | `lineage`、`sourceWorkId`、`sourceArtifactId`、`sourceRevisionId` | 衍生作品究竟基于哪个源作品版本 |
| Artifact 版本依赖 | `parentRevisionId`、`checksum`、`snapshotPath`                   | 当前文件由哪个历史版本演变而来 |
| Agent 上下文来源   | `plannerInputs`、`composerInputs`、`selectedSources`             | 本次创作加载了哪些资料     |
| 叙事状态依赖        | `sourceChapter`、`validFromChapter`、Hook ID、章节快照                | 某条事实何时出现、是否仍有效  |

这四种信息分别解决不同问题，不能互相代替。

### 1. Work Lineage：跨作品的来源版本绑定已经比较完整

在 [contracts.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/contracts.ts#L30-L36) 中，`WorkLineageSchema` 明确包含来源作品和具体版本。

例如可以表示：

```
{
  "relation": "derived-from",
  "sourceWorkId": "original-book",
  "sourceArtifactId": "manuscript",
  "sourceRevisionId": "rev-abc123"
}
```

这里的关键是 `sourceRevisionId`。

假设衍生作品使用母本第一个版本创作，之后母本修改了结局。衍生作品不应该因为母本变化，就自动将自己的来源切换到新版本。

InkOS 的 [derived-source.flow.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/derived-source.flow.test.ts) 已覆盖这样的场景：源作品发生修改后，衍生作品恢复执行仍然使用原先固定的来源版本；试图以不一致的版本继续同一创建流程，会触发来源冲突。

这是一种真正具有机器约束的版本依赖。

但它主要面向跨 Work 的衍生关系，还不是一部小说内部所有资料之间的细粒度依赖图。

### 2. Artifact Revision：单个内容产物的版本历史很完整

源码：[artifact-revisions.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/artifact-revisions.ts)

单份 Artifact 可以保留：

```
{
  "id": "rev-b",
  "parentRevisionId": "rev-a",
  "status": "current",
  "checksum": "sha256:...",
  "snapshotPath": "revisions/...",
  "episodeId": "episode-001"
}
```

这支持读取旧版本、对比修订差异、追踪执行任务，以及验证保存的字节内容。

[artifact-reader.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/harness/artifact-reader.ts) 还会验证实际读取的内容是否与登记的 SHA-256 一致，拒绝使用不存在或内容不匹配的快照。

但 Artifact Revision 主要解决的是“这份产物自身的版本历史”，并没有自动回答“还有哪些其他产物依赖它”。

### 3. ChapterTrace：有使用记录，但不等于完整依赖声明

InkOS 的 `ChapterTrace` 保存：

```
{
  "plannerInputs": ["story/outline/story_frame.md"],
  "composerInputs": ["story/state/current_state.json"],
  "selectedSources": [
    "story/roles/主要角色/某人物.md",
    "story/chapter_summaries.md#48"
  ]
}
```

这些字段说明当前 Agent 使用了哪些来源。

然而，`ChapterTraceSchema` 没有要求为每个来源记录：

- 内容版本号；
- 对应 Artifact Revision；
- 来源 SHA-256；
- Runtime State Revision；
- 来源是否仍有效。

因此，一份第 80 章的 Trace 可能知道自己读过人物卡片，却不能直接证明读取的是该人物卡片的哪一次修订。

“知道读了哪份文件”和“知道读了哪个权威版本”仍然存在差距。

## 三、完整的内容依赖图：InkOS 目前缺少什么？

假设作品发生一次变化：

> 作者修改第 30 章，取消主角在这一章已经识破反派的事实。

理论上，该变更可能影响：

第 30 章正文修订

第 30 章事实状态

人物知识记录

相关伏笔进度

第 30 章摘要

后续章节 Memo

后续章节正文

检索索引

已保存 ContextPackage

这是潜在的内容依赖网络，而不是已经证明 InkOS 自动维护的依赖图。

从实际源码看，InkOS 有三种局部处理。

一是历史章节修订后的下游标记。 `runner.ts` 会为后续章节添加 `upstream-revision` 观察，要求重新检查连续性。

二是 Runtime State 的历史快照。 可以重新读取目标章节之前的状态，用于状态重算。

三是检索索引的可重建性。 SQLite 索引可以从结构化摘要和伏笔记录重新生成。

但当前没有看到统一的机制，能够自动沿着“第 30 章事实 → 第 65 章 Memo → 第 90 章人物行动 → 第 120 章上下文”完成传递式失效计算。

所以更准确的判断是：

InkOS 已有版本记录、局部依赖和失效提示，但完整的跨产物依赖传播尚未闭环。

## 四、一个比较明确的缺口：Chapter Memo 的缓存有效性

这部分可以直接根据代码确认。

[持久化 Chapter Memo](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/persisted-governed-plan.ts) 的核心结构：

```
{
  "version": 2,
  "intent": {
    "chapter": 80,
    "goal": "推动主角调查真相"
  },
  "memo": {
    "chapter": 80,
    "goal": "推动主角调查真相",
    "body": "章节规划正文",
    "threadRefs": ["H011"]
  },
  "plannerInputs": [
    "story/outline/story_frame.md"
  ]
}
```

读取时主要校验 Schema 和章节编号。

而在 [runner.ts 的 ](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts#L2159-L2187)[`resolveGovernedPlan()`](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts#L2159-L2187) 中，当允许复用既有规划、且没有新的外部指令时，会直接读取并返回这个持久化结果。

### 问题出现在哪里？

假设：

| 时间 | 事件                         |
| -- | -------------------------- |
| T1 | 生成第 80 章 Memo，准备揭示人物 A 的身份 |
| T2 | 作者修改 Story Frame，取消该身份设定   |
| T3 | 恢复第 80 章创作                 |
| T4 | 系统复用原有 Memo                |

T4 复用的是格式合法的 Memo，但该 Memo 的内容可能已经过期。

当前 Memo 中没有强制保存“生成时使用的 Story Frame Revision”，对应复用入口也没有执行这一版本检查。

因此，这一局部路径存在明确的陈旧规划复用风险。

这不代表任何规划都会错误复用，因为该路径受调用条件限制；但这些条件不能替代上游版本校验。

## 五、本轮新发现：历史章节修订的时间基线可能不一致

这一点需要特别展开。

假设作品已经写到第 120 章，现在要求修订第 30 章。

### 1. 状态结算使用正确的历史基线

在 `reviseDraft()` 中：

```
const baselineChapter = targetChapter - 1;
```

随后调用 `loadRuntimeStateSnapshotAtChapter()`，读取第 29 章结束时的结构化状态。

这意味着 Settler 可以根据当时的旧状态，重新计算第 30 章发生了什么。

这条路径是合理的。

### 2. 但是 Reviser 的任务上下文可能使用最新状态

同一个 `reviseDraft()` 会调用：

```
this.prepareExistingChapterContext(...)
```

该函数再调用 Composer 的：

```
selectTaskContext(...)
```

而 Composer 的当前事实选择实现：

```
const snapshot =
  await loadRuntimeStateSnapshot(dirname(params.storyDir));
```

这里读取的是最新当前状态，而不是明确传入目标章节之前的历史快照。

源码位置：

[runner.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/pipeline/runner.ts#L2117-L2125) · [composer.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/agents/composer.ts#L739-L777)

### 3. 会产生什么风险？

例如：

- 第 30 章时，男主不知道反派真实身份。
- 第 95 章时，男主才知道。
- 当前作品写到第 120 章。
- 作者要求修订第 30 章的一段对话。

如果 Composer 选中了“男主知道反派身份”这条最新事实，并将它提供给 Reviser，模型就可能让第 30 章的人物提前说出本来不应该知道的信息。

另外，人物卡片也是从当前目录读取的；如果卡片记录了后期身份或关系变化，同样存在时间语境问题。

需要指出：这是一条代码支持的潜在信息泄漏路径。目前尚未通过运行一个固定样例证明实际模型会因此改坏正文，也可能存在其他审阅步骤发现问题。

但从上下文正确性的角度，这个风险比普通关键词召回遗漏更值得注意。

### 4. 历史摘要还有不同的处理方式

`memory-retrieval.ts` 的 `selectSummariesById()` 会过滤掉当前目标章节及之后的摘要。

这是有意识的时间边界保护。

但是它在构造语义筛选候选时，会先读取全部结构化章节摘要，再交给候选筛选器；历史章节之后的内容可能在候选筛选阶段出现，虽然最终返回的 `summaries` 会过滤掉未来章节。

因此需要分别验证：

最终交给 Writer 的内容是否符合时间边界，以及中间负责检索/筛选的模型是否接触到了未来信息。

两者不是同一项检查。

## 六、已保存的上下文能否精确重现？

这里应该把三种能力分开。

| 能力                                          | InkOS 实现情况                | 判断    |
| ------------------------------------------- | ------------------------- | ----- |
| 保存当时的 ContextPackage                        | 会持久化 JSON                 | 已实现   |
| 保存当时的来源选择记录                                 | 有 ChapterTrace            | 已实现   |
| 重新读取历史 Artifact 的准确字节                       | 有版本快照和 SHA 校验             | 已实现   |
| 将每个 ContextSource 绑定到准确历史 Artifact Revision | ContextPackage Schema 未要求 | 未完整实现 |
| 自动检测 ContextPackage 所依赖的上游权威发生变化            | 未见统一版本校验                  | 尚未证明  |

一个值得肯定的方面是，InkOS 已经有比较强的 Artifact 原始内容保真机制。

`readArtifactRevision()` 会读取选定版本，并检查内容哈希，而不是擅自返回最新文件。

这意味着系统并不缺少版本化存储的基础能力。

真正缺失的是具体一次章节任务与这些版本之间的强绑定关系。

例如，一个理想的上下文来源记录还需要能够回答：

> 第 80 章使用的角色卡来自哪个 Artifact、哪个 Revision、哪次作者确认？这份信息是否在生成 Memo 后发生了变化？

目前仅凭 `selectedSources` 无法完整回答。

## 七、召回完整性：如何证明 Agent 没有漏掉关键资料？

这是另一个重要研究结果。

InkOS 已有 FTS5、语义筛选、明确 Hook ID 召回、受保护上下文和 Token 预算控制。

但这些机制各自保证的事情不同。

| 机制                | 能保证什么           | 不能直接保证什么          |
| ----------------- | --------------- | ----------------- |
| FTS5              | 词法相关候选被找到       | 所有隐含相关事实都被找到      |
| 语义筛选              | 从候选中选出模型认为相关的资料 | 模型一定没有漏选          |
| `threadRefs`      | 可按已知 Hook ID 查找 | 所有应该引用的 Hook 都已列出 |
| Protected Context | 已选中资料不被普通压缩遗漏   | 重要资料一定被选中         |
| ChapterTrace      | 可追查实际选了什么       | 可证明没有遗漏应选内容       |

还有一个具体实现值得注意：`buildReferencedHookEntries()` 在找不到 Memo 指定的 Hook 时，会跳过该条目。

因此，这条上下文构建路径并没有对所有 `threadRefs` 提供强制的“全部引用成功解析”保证。

其他领域验证器可能会阻止不合法的 Hook 状态更新，但那不能替代写作前的召回完整性校验。

### 已有测试验证了什么？

[governed-working-set.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/governed-working-set.test.ts) 验证了可以根据语义选中的 Hook ID 缩小工作集。

[source-selection.flow.test.ts](https://github.com/dehuadong/inkos/blob/master/packages/core/src/__tests__/source-selection.flow.test.ts) 验证了资料放得下时使用完整来源，放不下时进行语义选择，并保持返回来源 ID 正确。

这些测试能够证明筛选机制按设计运行。

但并没有证明“真实长篇任务中，100% 的必要历史事实都能进入 Writer 上下文”。

这是召回系统与长期创作质量之间尚需补充的证据。

## 八、InkOS 已实现的失效机制，可以分成四种

从这轮代码来看，可以把现有机制归纳如下：

| 失效类型       | 已有处理方式                     | 完整程度 |
| ---------- | -------------------------- | ---- |
| 文件版本失效     | Revision、Checksum、Snapshot | 较完整  |
| 运行状态冲突     | Reducer、Validator、章节快照     | 较完整  |
| 历史章节变更影响   | `upstream-revision` 标记后续章节 | 部分完成 |
| 上下文与规划缓存失效 | 重新选择可读取新资料，但缺乏完整版本绑定       | 尚未闭环 |

其中最核心的差别是：

InkOS 能很好地识别“某个文件的版本变了”，但还不能据此自动推出“所有依赖该版本的章节规划、角色上下文和历史摘要都应该失效”。

而这恰恰是完整内容依赖系统需要解决的问题。

## 九、现阶段的综合结论

跨作品来源版本绑定

已实现

Artifact 历史版本与内容校验

已实现

Agent 输入来源追踪

已实现

章节历史状态快照

已实现

上游修改后的下游失效提示

部分实现

Chapter Memo 完整版本有效性验证

存在缺口

历史修订上下文的时间一致性

存在明确风险

检索必需信息的召回完整性

尚未证明

## 十、下一轮应该如何继续验证 InkOS？

接下来不建议继续只看概念，而是针对这轮发现的关键边界设计源码级实验。

| 实验           | 构造条件                           | 需要验证的结果                    |
| ------------ | ------------------------------ | -------------------------- |
| A：陈旧 Memo 复用 | 先生成第 80 章 Memo，再修改 Story Frame | 旧 Memo 是否被拒绝、标记过期或直接复用     |
| B：历史信息泄漏     | 写到第 120 章，回修第 30 章             | Reviser 是否读到第 30 章之后才成立的事实 |
| C：来源版本失效     | 创建 ContextPackage 后修改人物卡片      | 任务恢复是否能识别上下文版本已经过期         |
| D：跨章影响传播     | 修改第 30 章关键事件                   | 后续 Hook、摘要、Memo、索引分别如何处理   |
| E：重要伏笔漏召回    | Memo 引用不存在、撤销或已回收的 Hook ID     | Writer 是否得到明确错误，还是继续创作     |

这些实验比直接增加更多架构层更能揭示 InkOS 的真实能力边界。

本轮最重要的收获：InkOS 已经具备版本化内容、结构化状态和检索召回的核心能力，但“内容被改变之后，如何让后续每个 Agent 自动识别旧依据已经失效”，仍然是系统级的重要研究问题。

下一轮可以继续深入 历史章节修订与内容依赖一致性，把刚发现的时间基线问题、失效传播和再审恢复机制放进同一个具体案例，核对代码路径与现有测试是否真的能阻止错误进入正式作品。

本轮没有修改 InkOS，也没有研究 Novel 的实施方案。