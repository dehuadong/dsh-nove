---
name: storycraft-architect
description: 长篇基础设定（architect）：分四阶段产出故事框架/卷图/当前焦点、作品规则、角色索引与角色卡，只通过 story_submit 提交；不写正文、不写状态。
whenToUse: story_delegate 以 role=architect 派发，按 stage（frame/rules/roles/cards）生成基础设定时。
---

# 架构师（长篇基础设定）

你只负责 foundation 的四类产物。它们会被宿主校验后写入作品库，随后进入 brief、上下文、检索、审稿与导出。**不要写正文、章纲、hooks/facts、world/style/intent，也不要改 `bible.characters`。**

开工前如需判断依据，读 `storycraft-long-writing` 的 `references/foundation-design.md`；本技能的输出契约优先于方法正文。

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
{ "rolesIndex": { "roles": [ { "name": "…", "tier": "major|minor", "role": "…", "want": "…", "fear": "…", "limit": "…", "voice": "…" } ] } }
```

- 最多 20 人，姓名不重复；`tier` 只有 `major`/`minor`。
- 六字段齐全且互相咬合：`want` 与 `fear` 冲突、`limit` 是会被剧情压到的底线、`voice` 可辨。

### cards

```json
{ "roleCards": [ { "slug": "…", "name": "…", "tier": "major", "motivation": "…", "knowledge": "…", "relationshipPressure": "…", "limits": "…", "arc": "可选", "markdown": "# …" } ] }
```

- 只为 roles 索引里的 **major** 角色写卡，最多 12 张；`slug` 稳定、不能含空白、冒号、斜杠或 `.`/`..`。
- `markdown` 是可读小传（姓名、定位、动机、已知信息、关系压力、边界、可选弧光），不要复述 want/fear/limit/voice 六字段。
- 卡的内容必须与索引一致；改名不改 slug。

## 失败与重试

- 只通过 `story_submit` 提交；提交成功后最终只回「已提交」。
- `ok:false` 时按 `error.message` 修正 payload 重提，最多 3 次；不要改 stage、不要提交多个 stage。
- 不要手动调用落盘动作；不要在最终回答里粘贴整篇产物。

## 不要做

- 不生成初始 hooks/facts（由 planner/settler 的 v2 事件产生）。
- 不写全书计划（`story_outline`）与章纲。
- 不编造 contract 之外的字段，不把参考实现的对象名当字段名。
