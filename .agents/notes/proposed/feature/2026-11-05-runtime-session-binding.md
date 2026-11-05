# Agent Note: 故事工坊：runtime.session-binding 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.session-binding`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

作品一旦建立，后续动作可以省略 `work`。但当前没有能力证据证明：

- 绑定是按会话隔离的；
- 面板进入作品会写绑定，宿主重启后会恢复；
- 显式 `work` 覆盖当前作品；
- 删除作品会清掉绑定，不会把后续动作指到已删除作品。

没有这层证据，`story_next`/`story_context` 等能力都可能落到错的作品。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话有 `sessionKind`、`bookId`；`workId = bookId`，`play` 会话用 sessionId；profile 由 sessionKind 决定 | **偏差**：DSH 会话没有 InkOS 的 sessionKind/profile 枚举，profile 由 preset 决定；复刻按 sessionId 记录当前 workId（`storycraft/src/current.ts`）。原因属于“DSH 机制无法等价”，验证见本项真实回执。 |
| `inkos-master/packages/core/src/harness/session-binding.ts:3-15` | 不同会话类型解析到不同工作 profile | 复刻不复制 profile 映射；longform 由 preset/form 决定。保留为已登记的机制偏差，不把 profile 映射强行塞进 current。 |

## Proposal

### 范围

验证现有实现：

- `storycraft/src/current.ts`：内存绑定、显式优先、hydrate；
- `catalog.db` 的 `session_current`：持久化绑定；
- `storycraft/src/client.ts` 与面板：进入作品时 `setCurrent`；
- `storycraft/src/tools/runtime.ts`：首次读取时 hydrate；
- `storycraft/src/tools/actions/index.ts`：新建作品与删除作品时的绑定写/清；
- 隔离性：两个 session 不共享绑定。

### 非目标

- 不实现 InkOS 的 sessionKind → profile 映射（preset 已承担，属机制偏差）；
- 不改作品创建、删除合同；
- 不实现面板的全部阶段按钮（`panel.workbench` 在 D6）。

### 行为与失败

1. 显式 `work` 非空时优先；空白/省略时用当前绑定；
2. 没有绑定又省略 `work` 时，动作返回 `work-required` 一类的明确错误，不猜最近作品；
3. `setCurrent` 只影响该 sessionId；`clearCurrent` 同步清持久化行；
4. 宿主重启后，第一次需要 work 的调用从 `session_current` hydrate；
5. 删除作品后，原 session 的绑定被清除，下一次调用不再命中它。

### 真实证据

`artifacts/real-runs/runtime.session-binding.json`：

```json
{
  "date": "YYYY-MM-DD",
  "sessionId": "session-...",
  "tests": { "passed": true },
  "receipts": [
    { "kind": "panel-enter", "workId": "...", "ok": true },
    { "kind": "story-current", "workId": "...", "ok": true },
    { "kind": "isolation", "otherSession": "session-...", "workId": null },
    { "kind": "consumer-test", "path": "storycraft/tests/current.test.mjs", "ok": true }
  ]
}
```

面板点击无法由代理直接触发时，用同一真实会话的 `story_current` 回执 + 面板路由/持久化的消费者测试，并在 Note 写明缺口；缺真实回执则保持 `missing`。

### 验证命令

```text
node storycraft/tests/current.test.mjs
node storycraft/tests/delete-current-binding.test.mjs
node storycraft/tests/tools.test.mjs
npm run check-capabilities -- --write
npm run verify
```

## Alternatives considered

**只验证内存绑定（current.test）。** 最强理由是单测已覆盖显式优先与隔离；但重启恢复、面板写入与删除清理都不在内存单测里，故不采用。

**复刻 InkOS 的 sessionKind → profile 表。** 最强理由是结构更接近源工程；但 DSH 会话没有这些 kind，profile 由 preset 承担，强行复制会制造第二套 profile 解析，故不采用，并登记机制偏差。

**把绑定塞进作品数据库。** 最强理由是随作品走；但绑定是“会话看哪部作品”，跨作品存在，属于 catalog 级状态，故不采用。

## Acceptance criteria

1. 显式 `work` 覆盖当前绑定；空白/省略回退绑定；
2. 无绑定且省略 `work` 返回明确错误，不猜作品；
3. 两个 session 的绑定互不影响；
4. 面板进入作品写入绑定，宿主重启后能 hydrate；
5. 删除作品清理绑定，后续调用不再命中已删除作品；
6. 消费者测试通过，真实回执写入 `artifacts/real-runs/runtime.session-binding.json`，`check-capabilities --write` 后为 `verified`；
7. 源工程 sessionKind/profile 差异在 `docs/dsh-mapping.md` 登记为合法机制偏差。

## Plan Review

- Standards：账本承载状态，本 Note 承载工作项；源工程证据与偏差行齐全。
- Spec：范围、非目标、失败行为与面板/重启/删除验收可观察；无真实回执时保持 missing。
- Architecture：绑定保持 catalog 级、按 sessionId 隔离；不复制 profile 映射。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 面板点击无法脚本化，真实回执可能只能覆盖 `story_current` 与 hydrate；需在 Note 记录缺口；
- 删除作品的绑定清理若遗漏，会把后续动作指向已删除作品；
- DSH 重启后的首次 hydrate 依赖 `session_current` 行；行缺失时应显式报错而不是猜。
