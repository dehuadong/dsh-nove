# Agent Note: 故事工坊：R5-b Hook ID / threadRefs 定向回溯

Status: implemented

工作项：当前任务 R5-b（不新建 GitHub issue）。补章纲已点名伏笔的确定性回溯，不依赖查询词。

## Problem

当前 `story_context` 的检索只走一条查询：

- `buildQuery` 用任务、章纲、未解伏笔文本和 instruction 生成词法查询；
- `searchMemory` 只返回 FTS 命中的事件；
- 章纲的 `threadRefs`（本章涉及的伏笔 ID）虽然已落库并在章纲 Markdown 渲染成“伏笔：h-xxx”，但检索完全不读它。

结果是：**章纲明确点名了某个伏笔，只要查询词没有命中该伏笔文本，它就不会进入上下文**；trace 也看不出漏召回。R5-b 用稳定 `hookId` 直接召回建立与最近推进，作为 FTS 之外的确定性候选。

## 对拍参考

- `inkos-master/packages/core/src/utils/governed-working-set.ts:5-26` 按协议选择 hook 子集再渲染 `renderHooksProjection`，不依赖关键词命中；选择依据是 `contextPackage.selectedContext` 的 hook source。
- `inkos-master/packages/core/src/state/state-projections.ts` 的 hook 投影包含 `hookId/startChapter/lastAdvancedChapter/status`，与本地 `state-projection.ts` 的 hook 字段一致。
- 本地 `delegate.ts:273` 明确 `threadRefs` 是“伏笔 ID”；`tools.ts:1715` 同样定义为 ID 数组；`artifact-store.ts:426` 将 `threadRefs` 渲染为章纲“伏笔：”行。
- 本地 `searchMemory` 的 hook 分支（`store-db.ts:3931-3958`）只按 FTS 行的 event id 产出候选，不携带 `hookId`，因此无法在合并前按 ID 去重。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 按协议选择 hook 子集 | 按章纲 threadRefs 选 hookId | 已有显式引用，更直接 | 等价适配 | 单元 |
| hook 投影含建立/最近推进 | 一条候选写建立章 + 最近推进章 | 不引入多候选占槽 | 补强 | 单元 |
| 不依赖关键词 | 直接候选 priority=1 | 排在 FTS hook 前，技能可能先占槽 | 偏差 | trace |

## Decision

### 读取 threadRefs

- 用 `readPlanMemo` 读取结构化 memo 的 `threadRefs`，不再解析渲染后的 Markdown；
- `threadRefs` 只接受非空字符串 ID（合同是字符串数组，不由渲染格式决定）；
- 只接受章纲中实际存在的 `hookId`；不按文本猜；
- `threadRefs` 为空、无章纲、work scope 时不启用；
- 未知/非法 ID 不发候选，追加到 notes，不阻断。

### 直接候选

- 从 `folded.hooks` 按 `hookId` 找投影；`FoldedHook` 类型补 `hookId/lastAdvancedChapter`；
- 只取 `open/progressing/deferred`；`resolved/superseded` 跳过（章纲点名已解决伏笔不强行复活）；
- **as-of-target**：通过 `readFoldedState({beforeChapter:number})` 读取目标章之前的投影，status/text/startChapter/lastAdvancedChapter 都来自该时点；候选文本只写建立章，仅当最近推进早于目标章时才追加推进；work scope 无目标时才按最新投影；
- 候选：
  - `id: hook:<hookId>`
  - `kind: hook`
  - `source: state`
  - `sourceIds: ['state']`
  - `chapter: hook.startChapter`
  - `text: <text>（建立第 X 章[；最近推进第 Y 章]）`（不写最新 status）
  - `score: -index`（threadRefs 顺序；首个最高）
  - `priority: 1`（排在 FTS hook 之前；与技能同为 1 时按 score，技能可能先于 hook）
- 同一 hookId 只发一条；多个 threadRefs 各一条，再由 `select` 的每类 2 条/总 5 条约束。

### 合并与去重

- `searchMemory` 的 hook 候选增加 `hookId`（仅内存字段，不进 trace schema）；
- context 合并前：
  - 先剔除 FTS 中 `kind='hook'` 且 `hookId` 属于**本次 threadRefs** 的候选（其他 FTS hook 重复不去重）；
  - 再加入直接候选；
  - 技能/素材候选行为不变；
- 现有 `select` 的 priority 排序复用 B2b 的机制，不新增排序器。

### Trace

- 直接候选 id 为 `hook:<hookId>`，kind/source/score 沿用现有 candidate 合同；
- 不新增 trace 字段、不改 engine；
- 未知 threadRef 追加到 `trace.notes`，不复用单一 `retrievalNote` 槽位；技能 warning 也改为追加，避免互相覆盖。

## Alternatives considered

**A. 只改 query，把 threadRefs 文本拼进查询。** 最强理由是改动最小。否决原因：仍然依赖 FTS 命中，无法保证点名伏笔一定出现。

**B. 把 threadRef 全部作为 protected 段。** 最强理由是保证不漏。否决原因：会绕过检索预算，且一条伏笔可能只是提及，不必进 protected。

**C. 用 threadRefs 文本模糊匹配 hook。** 最强理由是兼容旧数据。否决原因：本项目无旧作品；ID 已是合同，模糊匹配只会引入错配。

## Testing

- `tests/context-retrieval.test.mjs`：threadRefs 直接召回、无查询词命中、FTS 去重、未来伏笔不泄露、已解决伏笔不召回、未知 ID note。
- 完整 CI：93 单元 + 48 E2E。

## Consequences

- `threadRefs` 可能引用了已解决伏笔；跳过而不是复活；
- 多个 threadRefs 超出每类 2 条时只发前 2 条；按 threadRefs 顺序（`score=-index`）固定；
- 直接候选 priority 会挤掉 FTS hook；这是定向引用的预期；
