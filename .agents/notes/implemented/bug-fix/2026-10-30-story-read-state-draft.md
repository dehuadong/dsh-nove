# Agent Note: story_read 不应把 state:draft 当作 state

Status: implemented

## Problem

`story_read` 按冒号切分 artifactId 后，只要第一段是 `state` 就返回事件日志（`tools.ts` 的 `kind === 'state'` 分支）。`#82` 引入 `state:draft:<章>:r<版本>` 草案后，这个前缀判断把草案 id 也接住了：

- 定稿消费草案后，`story_read artifactId:"state:draft:1:r1"` 仍返回 `state` 事件日志，而不是“草案已不存在”；
- 删除/消费后的草案看起来仍可读，生命周期被掩盖，验收无法用读取结果证明草案已消失；
- 其他 `state:*` 也会被误读成事件日志。

真实链路证据（#82，2026-10-30，会话 `session-a5e7dbb0-e059-475b-be68-0d810b05a470`）：`story_settle` 后 `story_read state` 为 `seq:0`，`story_finalize` 后 `story_read state:draft:1:r1` 返回 `artifactId:"state", revisionId:"seq:7"` 的事件文本。

## Decision

`story_read` 只在 `artifactId === 'state'` 时返回事件日志；`state:draft:<章>:r<版本>` 按已登记 artifact 读取：

- 草案存在且版本匹配：返回草案内容，`kind` 为 `state_draft`，`revisionId` 为草案的 artifact revision；
- 草案不存在（已定稿消费或 reopen 删除）：`artifact-not-found`；
- 版本与当前草案不一致：`revision-not-found`；
- 形状不合法（缺章号/版本、非数字、多余段）或其他 `state:*`：`artifact-not-readable`。

读取只限当前作品，遵守 `story_read` 现有的 work 作用域；草案的写入、接受、消费与删除规则不变。

## 对拍参考

`inkos-master` 没有 `state:draft` 这一类 artifact：参考实现的 runtime state 由文件与投影维护（`packages/core/src/state`、`utils/outline-paths.ts`），不存在“草案 artifact 的读取语义”。本项属于我们新增的草案生命周期，**无参考实现**；检索范围 `inkos-master/packages/core/src/state`、`utils/outline-paths.ts`、`agent/agent-tools.ts`。裁决：按本项目的 artifact 合同处理，不引入参考概念。

## Testing

`storycraft/tests/story-read-state-draft.test.mjs` 覆盖：`state` 事件日志不变、草案可读、过期 revision、非法形状、其他 `state:*`、定稿消费后 `artifact-not-found`、reopen 后 `artifact-not-found`。全量 `node storycraft/scripts/ci.mjs` 为 80 单元 + 27 E2E。

## Alternatives considered

**B（最小改动）：只有精确 `state` 可读，所有 `state:*` 一律 `artifact-not-readable`。** 最强的理由是改动面最小、不增加新的模型可读内容。否决原因：它无法区分“草案已删除”和“这个 id 不支持读”，而验收需要的恰是“删除后可观察为不存在”；同时与 `story_read`“按 artifactId 读取已登记内容”的承诺不一致。

**C：新增独立动作 `story_read_draft`。** 最强的理由是避免把草案混进 artifactId 语义。否决原因：草案已经是登记 artifact，新增动作会重复读取、校验与作用域逻辑，且模型还要多记一个动作；在本项范围内收益不足。

## Consequences

- 删除后的草案可观察为 `artifact-not-found`，验收可以依赖读取结果；`state` 的事件日志语义不再被前缀污染。
- 草案内容从此对模型可读；它是只读中间状态，不改变定稿闸门，但多了一个可被引用的上下文来源。
- 事件日志分支从“前缀”收窄为精确匹配；依赖旧 `state:*` 行为的调用方会显性报错，目前只有草案 id 受影响，属于修正而非兼容。
