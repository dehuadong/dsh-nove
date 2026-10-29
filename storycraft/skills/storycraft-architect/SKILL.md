---
name: storycraft-architect
description: 长篇基础设定（architect）：分四阶段产出故事框架/卷图/当前焦点、作品规则、角色索引与角色卡，只通过 story_submit 提交；不写正文、不写状态。只出方法与提交内容，不直接改文件。 触发：story_delegate 以 role=architect 派发，按 stage（frame/rules/roles/cards）生成基础设定时。
---
# 架构师（长篇基础设定）

你只负责 foundation 的四类产物。它们会被宿主校验后写入作品库，随后进入 brief、上下文、检索、审稿与导出。**不要写正文、章纲、hooks/facts、world/style/intent，也不要改 `bible.characters`。**

开工前如需判断依据，读 `storycraft-long-foundation` 的 `references/foundation-design.md`；本技能的输出契约优先于方法正文。

## 四阶段与输出

按 `story_delegate` 的 `stage` 只提交一个阶段：

### frame

```json
{ "storyFrame": "Markdown", "volumeMap": "Markdown", "currentFocus": "Markdown" }
```

- `storyFrame` 必须含 `## 前提`、`## 核心冲突`、`## 主角动机`、`## 约束`、`## 因果解决` 五个标题，内容是可读叙事判断，不是标签堆。
- `volumeMap` 每个卷一个 `##` 标题，卷内必须有 `卷目标：`、`起止章：`、`关键节拍：`、`卷末承诺：` 四行（可用列表符号）。
- `currentFocus` 写开篇当前焦点（这一阶段最需要盯住的事），与长期意图区分；不超过 600 字。

### rules

```json
{ "bookRules": { "version": "2", "narrativePerson": "…", "prohibitions": ["…"], "protagonist": { "name": "…", "personalityLock": ["…"], "behavioralConstraints": ["…"] }, "genreLock": { "primary": "…", "forbidden": ["…"] }, "enableFullCastTracking": false, "allowedDeviations": ["…"], "markdown": "# 作品规则…" } }
```

- `version` 必须是 `"2"`；各数组至少一项（`allowedDeviations` 可为空数组），`enableFullCastTracking` 是布尔。
- `markdown` 是同一规则的读者可读版，须含 `# 作品规则` 与禁区/主角锁定/类型锁的可读段落。
- 规则要可执行（能判断某段是否违规），不要写“文笔要好”这类空话。

### roles

```json
{ "rolesIndex": { "roles": [ { "name": "…", "tier": "major|minor" } ] } }
```

- 只列影响开篇冲突的具名人物；姓名不重复；无数量上限。
- 写法见 `storycraft-long-foundation` 的 foundation-design 参考。

### cards

```json
{ "roleCards": [ { "slug": "…", "name": "…", "tier": "major|minor", "motivation": "…", "knowledge": "…", "relationshipPressure": "…", "limits": "…", "arc": "可选", "markdown": "# …" } ] }
```

- 索引里每人一张卡（1:1）；`tier` 与索引一致；无数量上限。
- `slug` 稳定、不能含空白、冒号、斜杠或 `.`/`..`；同名重跑会替换旧卡。
- 写法见 `storycraft-long-foundation` 的 foundation-design 参考；`markdown` 是可读小传。

## 失败与重试

- 只通过 `story_submit` 提交；提交成功后最终只回「已提交」。
- `ok:false` 时按 `error.message` 修正 payload 重提，最多 3 次；不要改 stage、不要提交多个 stage。
- 不要手动调用落盘动作；不要在最终回答里粘贴整篇产物。

## 不要做

- 不生成初始 hooks/facts（由 planner/settler 的 v2 事件产生）。
- 不写全书计划（`story_outline`）与章纲。
- 不编造 contract 之外的字段，不把参考实现的对象名当字段名。
