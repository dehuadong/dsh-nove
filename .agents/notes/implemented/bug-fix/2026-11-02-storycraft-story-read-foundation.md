# Agent Note: 故事工坊：修复 story_read 基础设定读取

Status: implemented

工作项：当前任务 bugfix（不新建 GitHub issue）。修复真实链路立项阶段 `story_read` 把结构化基础设定读成 `[object Object]`。

## Problem

真实会话 `session-3eca6dcb...` 在立项阶段派发了 6 次架构师子代理：

- frame 1 次；
- rules 3 次；
- roles 1 次；
- cards 1 次。

rules 连续重试的触发点是主代理用 `story_read bible:book_rules` 读回：

```json
{"artifact":{"artifactId":"bible:book_rules","kind":"book_rules"},"content":"[object Object]"}
```

但直接查 SQLite 证明三版 `bible:book_rules` 都是合法 JSON：

- `content_type = json`；
- 内容含 `version/narrativePerson/prohibitions/protagonist/genreLock/allowedDeviations/markdown`；
- 三版分别 9906/9979/4419 字节。

因此不是写入损坏、也不是模型提交错，而是**读取显示层把对象 `String()` 了**。

同时 `story_read roles:index` 报 `artifact-not-readable`，迫使主代理写 `_probe*.py` 直接查库，增加诊断绕路。

## 对拍参考

- 参考工程 `docs/report/inkos/inkos04.md:144` 记载 `rules-reader.ts` 同时读取 `book_rules.md` 与 `book_rules.json`；`parity-matrix:150` 的目标是“可读 + JSON”。本项 `story_read` 返回 Markdown，结构化 JSON 仍保存在 artifact 中，属于登记的偏差，不删 JSON 能力。
- 本地 `src/artifact-store.ts:283-287` 的 `renderFoundationContent` 已定义基础设定渲染规则：字符串原样、对象取 `markdown`、其余 JSON。
- 本地 `src/tools.ts:2233-2239` 的 `story_read` `bible` 分支却用 `readTextArtifact` + `String(read.artifact.content)`；`book_rules` 是结构化对象，于是变成 `[object Object]`。
- `src/tools.ts:2241` 只支持 `role:<slug>`，没有 `roles:index` 分支。
- 现有测试 `tests/foundation-chapter-artifacts.test.mjs:105` 已证明 `readFoundationDocument` 能读回 JSON，但没覆盖 `story_read`。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 无等价工具 | 修复 `story_read` 分支 | 读取契约错误，不是数据错误 | 本地修复 | 单元 |
| 基础设定按 Markdown 消费 | `book_rules` 返回 `markdown` | 与 brief/context/export 一致 | 采纳 | 单元 |
| 结构化索引用 JSON | `roles:index` 返回 JSON | 角色索引本就是 JSON | 采纳 | 单元 |

## Decision

### `bible:book_rules`

`story_read` 的 `bible` 分支：

- 对 `book_rules` 走 `readFoundationDocument(root,{name:'book_rules'})`，走 `readTyped` 的 kind 校验（`book_rules`），kind 不符报错；
- 用 `renderFoundationContent(content)` 生成返回内容；
- `book_rules` 返回 `content.markdown`（当前契约要求该字段为字符串）；
- 不再 `String(object)`。

返回 envelope 的 `artifactId/revisionId/kind` 取自实际 artifact；`startLine/lineCount` 仍按 Markdown 分行；新增 `hasMore: endLine < totalLines`，调用方不能把部分页当全文。

### `roles:index`

新增 `roles:index` 读取：

- 用 `readFoundationDocument(root,{name:'roles_index'})` 读取，强制 kind `role_index`；
- 返回 `JSON.stringify(content, null, 2)`，**始终返回完整 JSON**，不套 line slicing（否则 JSON 被截断不可解析）；这是对 `2026-10-20-storycraft-artifact-identity.md:107` 分页契约的登记偏差；响应固定 `startLine:1`、`endLine=totalLines`、`hasMore:false`，忽略传入的 `startLine/lineCount`；
- ref 的 artifactId/kind/revisionId 取自返回的 `artifact`，不手拼；
- `role:<slug>` 分支保持独立，不和 `roles:index` 混用。

### 通用兜底

- `story_read` 的 `bible:book_rules` 分支不再对 object 做 `String()`；其它文本 truth 仍走字符串分支；
- 文本类 truth（`world/style/intent/current_focus`）仍返回字符串；
- 结构化内容统一走 `renderFoundationContent` 或 JSON，具体由分支决定；
- `readTextArtifact` 仍只用于真正文本的 artifact；不在本项给它加全局类型断言，避免影响其它调用方。

## Testing

- `tests/story-read-role.test.mjs`：book_rules Markdown、revisionId、`hasMore` 大文档、roles:index 完整 JSON、文本 truth、tool description。
- `tests/foundation-orphan.test.mjs` 等既有测试保持通过。
- 完整 CI：94 单元 + 49 E2E。

## Alternatives considered

**A. 让 `story_read` 对 `book_rules` 返回 JSON。** 最强理由是保留结构、便于机器读。否决原因：作者与模型读规则需要 Markdown；brief/context/export 也都按 `markdown` 消费，返回 JSON 反而引入第二套读法。

**B. 修改写入，让 `book_rules` 存成 Markdown 字符串。** 最强理由是简单。否决原因：artifact 合同明确 `book_rules` 是结构化 JSON（`validateBookRules`），改成字符串会破坏 `prohibitions/protagonist/genreLock` 等消费者。

**C. 迁移历史 `[object Object]`。** 最强理由是兼容。否决原因：数据本身没有损坏；没有旧作品迁移，不引入兼容层。

## Consequences

- `book_rules` 的 Markdown 可能超过 `lineCount` 默认 200 行；`hasMore:true` 明确提示，仍需调用方读取后续页；
- `renderFoundationContent` 对缺少 `markdown` 的对象回退 JSON；合法合同要求 `markdown`，不会触发；
- `roles:index` 是结构化 JSON，作者可读性不如 Markdown，但这是索引契约；
- 真实会话不会因修复自动重跑；修复后用新会话复测立项四阶段。
