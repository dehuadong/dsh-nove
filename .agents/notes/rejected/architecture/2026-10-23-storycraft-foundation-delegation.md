# Agent Note: 故事工坊：foundation 委派（architect 一次生成基础设定）

Status: rejected — 旧方案把 story_frame / volume_map / book_rules / 角色卡压进 world/plan/characters/text-hook，信息损失；A0 全量产物合同后重做 R10。

## 问题

立项后的基础设定现在要靠三次手写动作拼起来：`story_bible_write` 写世界观与人物、`story_outline` 写主线/卷划分/结局，初始伏笔没有入口，只能等第一章 `story_state` 再补。规划技能有 `foundation-design` 方法参考，但没有角色把方法落成一套可校验、可原子写入的基础设定。

结果：开书前要么缺伏笔账本，要么世界观、人物、计划各写各的，作者要在面板与对话之间来回补；`story_outline` 的作者确认只覆盖计划，不覆盖同一轮生成的世界观与人物。

## 参考实现

InkOS 的 architect 用五段式协议生成 `story_frame`、`volume_map`、`book_rules`、角色卡与初始未解伏笔，并通过原子文件提交一次写入；先生成 outline，再补 details，最后提交结构化 rules 与 pending hooks。

我们借它的**位置与原子性**（立项后、写章纲前，一次生成整套基础设定），不复制它的五段文件、hookId、book_rules schema 或两阶段调用。本实现的映射：

| 参考产物 | 我们的落点 |
| --- | --- |
| story_frame | `bible/world`（世界、规则、故事框架）+ `bible/plan` 的主线 |
| volume_map | `bible/plan` 的卷划分文字；结构化卷仍等章节存在后走 `story_volume` |
| book_rules | 并入 `bible/world`；不新增规则文件/schema |
| 角色卡 | `bible/characters` 六字段数组 |
| 初始伏笔 | events 中 `chapter: 0` 的 `opened` hook，进入现有伏笔账本 |

## 提案

### 1. 新动作 `story_foundation`

主会话限定的写动作：

```text
story_foundation(work, replace?)
```

流程：

```text
闸门：作品存在、没有章节、全书计划未确认
→ 读 manifest（标题/形态/字数）、提案（premise/characters/conflict/notes）、world/characters/plan 草稿、intent
→ architect 子代理一次提交 world / characters / mainline / volumes / ending / hooks
→ 校验：world 非空且无 TODO/待定；characters 六字段；mainline 非空；hooks 文本唯一且非空
→ 一个事务写入 world、characters、plan，并把 hooks 以 chapter 0 的 opened 事件写入
→ 清空 outline 确认；返回 outline/bible/hooks 回执
```

- 默认只允许一次；`replace: true` 仅在**没有章节且 outline 未确认**时允许重跑，先删除 chapter 0 的初始 hook 事件，再整套替换。
- outline 已确认或有章节时返回 `foundation-locked`；已有非草稿 world/characters/plan 且没传 `replace` 时返回 `foundation-exists`。
- 子代理失败、校验失败、写入失败都不产生半成品：一次事务，失败回滚。
- 子代理超时 180 秒；无服务 `foundation-unavailable`、超时/异常 `foundation-failed`、无合格提交 `foundation-no-submission`、payload 不合法 `foundation-invalid`。
- 作者仍通过现有面板确认全书计划；`story_plan` 的 `outline-required` 不变。

输出：

```json
{ "ok": true, "workId": "…",
  "outline": { "artifactId": "outline", "revisionId": "…", "kind": "outline" },
  "bible": [{ "name": "world", "version": "…" }, { "name": "characters", "version": "…" }],
  "hooks": ["开书伏笔原句"],
  "counts": { "characters": 4, "hooks": 3 } }
```

### 2. architect 子代理与技能

新增 `storycraft-foundation-craft` 技能（`plan` 目录）：按 `storycraft-longform-method` 的 `foundation-design` 生成故事框架、世界规则、人物、卷划分文字与初始伏笔；不写章节正文，不做审稿。

`story_submit` 增加 `architect` 角色：

```json
{
  "world": "世界、规则与故事框架的 Markdown",
  "characters": [{ "name": "甲", "role": "主角", "want": "…", "fear": "…", "limit": "…", "voice": "…" }],
  "mainline": "主线",
  "volumes": "卷划分文字",
  "ending": "结局方向",
  "hooks": [{ "text": "开书伏笔的最终措辞" }]
}
```

- 上限：world/mainline/volumes/ending 各 ≤ 8000 字；characters 1–20 人；hooks 0–20 条；name/role/want/fear/limit/voice 与 hook text 各 ≤ 240 字；payload 受 64KB 限制。
- characters 只保留六字段，额外字段丢弃；解析失败或重名拒绝。
- hooks 全部以 `opened` 写入，`text` 是唯一身份；重复文本拒绝。
- 子代理通过 `story_submit` 提交，最终只回「已提交」；不落盘、不调用 `story_outline`/`story_foundation`。

### 3. 初始伏笔与展示

- `writeFoundation` 在事务里给每条 hook 写一条 `chapter: 0` 的 `opened` 事件，并同步检索文档。
- `readFoldedState` 直接包含这些 hook；`story_brief`、`story_context`、`story_status` 的未解伏笔都能看到。
- `story_state` 后续用 `used` / `resolved` 推进或回收；伏笔文本沿用原句。
- 展示时把 `openedChapter === 0` 显示为「开书」而不是「第 0 章」；只改展示，不改事件数据。

### 4. 入口与回退

- `story_next` 在「没有章节、没有 outline」时返回 `action: story_foundation`；已有 outline 未确认时仍返回 `story_outline`（等作者确认）。
- `story_outline` 保留为手动入口：作者只要手写计划、不需要整套设定时，可直接使用；`story_bible_write` 仍可改 world/characters。
- `storycraft-studio-orchestration` 与长篇流程技能在「立项后、写章纲前」点名 `story_foundation`，并说明 `story_outline` 是手动回退。
- 面板不新增按钮；「确认全书计划」沿用现有入口。

### 5. 测试

新增 `tests/foundation.test.mjs`，用临时 SQLite 与假 architect：

- 成功：world/characters/plan 写入，outline 未确认，hooks 以 chapter 0 出现在 folded state、brief 与 status；`story_next` 之后返回 `story_outline`。
- 校验失败（world 含 TODO、characters 缺字段/重名、mainline 空、hook 重复/空）：不写任何表、不写事件。
- 闸门：有章节、outline 已确认、非草稿设定且未 replace；`replace: true` 在允许窗口内替换并删除旧初始 hooks；锁定后 replace 也拒绝。
- 子代理：无服务、超时、无提交、坏 payload 分别返回 `foundation-*` 错误，不写库。
- `story_submit` 的 architect 形状/上限；动作总数 33；技能 `all` 12 / `plan` 2；`story_next` 返回 `story_foundation`。
- 初始 hook 的展示：brief/context 显示「开书」，不显示「第 0 章」。

## 备选方案

- **继续三次手写**：没有初始伏笔入口，世界观/人物/计划各写各的；否决。
- **拆成三次 architect 调用**：与现有手写动作重复，且没有原子性；改为一次子代理、一次事务。
- **照搬 InkOS 的五段文件与 book_rules schema**：我们的真值是 world/characters/plan 三件，新增文件要迁移 UI、brief、导出与测试；本项只做映射。否决。
- **初始伏笔等作者确认 outline 后再写**：需要候选表/待确认状态，或把 hooks 存进 plan 文本再解析；增加 schema 与失败面。改为确认前写入，允许未确认时 `replace`。
- **用 plan 文本承载伏笔，不进账本**：brief/status 看不到，`story_state` 不能引用；否决。
- **生成 style/intent**：风格应由作者定，intent 是作者意图；本项不生成。否决。

## 否决原因

全量对拍审查（[2026-10-23-full-project-parity-audit.md](../../../../docs/report/inkos/2026-10-23-full-project-parity-audit.md)）确认：把 story_frame、volume_map、book_rules、角色卡映射进 world/plan/characters、把初始 hooks 写成 text 事件，是信息损失裁剪，不是功能等价。R10 已退回 #44 `planning`，等 A0 全量产物合同（#45）后再重新规划；本 Note 的提案与验收不再适用。

## 原验收条件（随否决失效）

1. `story_next` 在空作品（无章节、无 outline）返回 `story_foundation`；有 outline 未确认时返回 `story_outline`。
2. 成功写入 world/characters/plan，outline 未确认；作者确认前 `story_plan` 仍被 `outline-required` 拒绝。
3. 初始 hooks 以 chapter 0 出现在 folded state、brief、context、status；展示为「开书」。
4. 校验/闸门/子代理失败均不产生半成品；`replace: true` 只在无章节且 outline 未确认时生效，并删除旧初始 hooks。
5. 不新增表/schema；`story_outline`、`story_bible_write`、`story_plan`、`story_settle` 行为不变。
6. 动作 33、`all` 12、`plan` 2；37 个既有单测不回归，新增测试全过。
7. README、对拍矩阵、路线图同步；R10 移到已交付。

## 风险

- writer/architect 一次生成整套设定，质量与一致性仍靠模型；dev 测试只覆盖契约，真实链路由作者验收。
- 初始 hooks 在 outline 确认前就进账本；作者若不认可，只能在未确认时 `replace` 重跑，确认后没有 hook 编辑器。这是本项接受的边界。
- `volume_map` 只是 plan 文字，结构化卷仍要等章节存在后 `story_volume`；不是完整结构化卷图。
- book_rules 并入 world；没有独立规则文件，作者要改规则只能编辑 world。
- style/intent 不由 architect 生成；缺风格时作者仍需手写。
- `replace` 会覆盖作者手写的 world/characters/plan；必须显式传，且只在未确认、无章节时允许。
