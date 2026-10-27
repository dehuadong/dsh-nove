# 章节事实与状态投影

## 只投影正文已发生的事

- 只抽取本章正文明确建立的内容：人物动作与身体状态、位置、资源、关系变化、情绪、信息边界、情节承诺、时间推进、在场者。
- 精确事实优先于抽象概括；「他成长了」不是可核对的事实。
- 暗示可以留作未解承诺，但不能记成已完成事件。
- 章纲是计划，不是事件发生的依据；本章没有写到的，不投影。

## 增量投影

- 在现有状态上追加，不从零重建；保留无关事实。
- 人物知道什么，以他亲眼所见、亲耳所闻或明确被告知为界。
- 章节停在门口，状态不能替人物跨过去。
- 生产路径有两条：`story_settle` 自动委派 settler，或 `story_state` 手动提交；两条都写同一套 v2 事件，`settleState` 是唯一写入口。

## 事实（factOps）

- 一条事实是一个三元组：`subject`（主体）、`predicate`（关系/状态名）、`object`（值），有效期由宿主维护。
- `factOps.upsert` 追加或重申一条有效事实；同一三元组重复提交只保留一条。
- `factOps.expire` 用 `subject` + `predicate`（`object` 可选）结束一条已有效事实；没有可失效事实会被拒绝。
- 同义改写会被当成新事实，所以要么沿用已登记的三元组，要么确认它确实是新事实。
- 状态只记录「发生了什么」，不判断「这件事是否被正文支持」——语义对账由 validator 在 `story_settle`/`story_state_check` 内完成。

## 伏笔生命周期

- 五态：`open`、`progressing`、`deferred`、`resolved`、`superseded`。
- `open`：新承诺进入账本，`newHooks` 提交文本，`hookId` 由宿主铸造。
- `progress`：本章推进了它——增加证据、改变风险或范围；`lastAdvancedChapter` 跟随。
- `mention`：只是提及或回忆，不改状态。
- `defer`：明确延后；`resolve`：回答或作废；`supersede`：撤销前提（只能从已解或误记纠正进入）。
- 非法转移（如 `resolved → open`、`superseded → progressing`）是确定性拒绝，不写事件。
- 伏笔的身份是 `hookId`，不是文本：后文继续同一条承诺时引用账本里的 id；改写展示文本不改 id，换一条承诺才新建。
- 引用伏笔前先看 baseline；`hook-not-found` / `hook-transition-invalid` 是确定性拒绝，不是建议。

## 投影边界

- 审稿可以指出正文与状态不一致，但不改状态；只有 settle 追加事件。
- 已定稿章不能再次 settle；要改先 reopen。
- reopen 不撤回已写状态事件；重新 settle 时同状态操作与重复 fact 视为幂等。

## 数值与在场

- 正文出现明确的资源增减时，用事实把期初、变化与期末写清楚。
- 正文改变在场者或信息边界时，把谁在场、谁被提及、谁知道什么写成三元组事实。
