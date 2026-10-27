# session-driver

把一条用户消息投递进**已存在的会话**，用于验收驱动（用户给 `sessionID`，代理自己在那个会话里推进）。

## 为什么不是 headless

`dsh --profile headless --session-id <id>` 会拒绝带 agent preset 的会话：

```ts
// packages/bundle/headless/src/index.ts, assertAdoptable
if (preset !== undefined) {
  throw new Error(`session "${sessionId}" runs under agent preset "${preset}", which the one-shot runner does not compose`)
}
```

GUI 会话的 `agent-preset/selected` 是 `storycraft`（或其它预设），所以这条路走不通。GUI 发消息走的是宿主 `sessionController.prompt`（`packages/api/session-controller/src/index.ts` 的 `@Remote('prompt')`），本插件把同一个入口暴露成一个工具。

## 契约

```ts
sessionController.prompt({
  requestId,            // 任意唯一串，落成这条用户消息的 rpcId
  sessionId,            // session-<uuid>
  mode: 'queue',
  content: [{ type: 'text', text }],
  clientTimeZone: 'Asia/Shanghai',
}, signal)              // → { accepted: true }
```

工具 `session_prompt { sessionId, text }` 返回 `{ accepted, sessionId }`。

## 边界

- 只投递文本，不改模型、不改预设、不带附件。
- 只对**已存在**的会话有效；投递后目标会话开始一轮，和你在 GUI 里手打一条消息等价。
- 面板上的确认、导出打开仍然只能作者点——那是验收项本身。
- 装进 profile 后所有会话都能看到这个工具；验收结束若不再需要，`plugin_manager remove_bundle` 卸载。

## 取证

投递后读目标会话日志：`~/.dsh/sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd`。文件是多帧 zstd，按魔数 `28 b5 2f fd` 切帧后逐帧 `zstdDecompressSync`，再解析 JSONL 的 `tool/call`、`tool/result`、`assistant/message`。
