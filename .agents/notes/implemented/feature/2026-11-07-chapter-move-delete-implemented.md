# Agent Note: 故事工坊：chapter.move-delete 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.move-delete`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计发现当前实现超出源工程：源只允许删除最新章，中间章拒绝，且没有移章动作；当前可删任意章并重排、可移相邻章。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/state/chapter-delete.ts:1-120` | 只删最新章；中间章拒绝；文件进 `.trash`；回滚前一章快照 | 复刻限制最新章；trash/快照回滚登记债 |
| `packages/studio/src/api/server.ts:3180-3190` | 删除路由调用 `deleteLatestChapter`，中间章 400 | 复刻非最新章拒绝 |
| `packages/studio/src/api/server.ts:3046` | `canDelete = num === latestChapter` | 复刻面板只对最新章显示删除 |
| 源无 move 端点/函数 | 不支持移章 | 复刻移章拒绝，面板按钮移除 |

## Decision

- `deleteChapter`：非最大章抛 `chapter-delete-latest-only`；最新章删除保留 DB backup；
- `moveChapter`：抛 `chapter-move-unsupported`，面板移除前移/后移；
- 面板删除按钮只在最新章可用；
- `.trash` 章节文件与快照回滚未实现，审计保持当行债；
- 测试改为删最新成功、删中间拒绝、移章拒绝。

## Alternatives considered

- **保留任意删除/移章。** 最强理由是作者灵活；源明确只删最新且无移章，故不采用。
- **只限制删除，保留移章 UI。** 最强理由是少改 UI；移章无源证据，故一并移除。
- **保留函数但隐藏 UI。** 最强理由是兼容调用；函数仍会产生无源行为，故函数也拒绝。

## Consequences

- **收益**：删除范围与源一致；移章不再产生无源重排；面板不再提供不可用操作。
- **代价**：移章功能移除；删中间章从允许变为拒绝；`.trash`/快照回滚仍是债。
- **边界**：只有 DB backup，没有源文件 trash 与前一章快照恢复。

## Verification

```text
node storycraft/tests/chapter-edit.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e       # PASS: 105 unit files
npm run verify                                # 24 verified / 16 missing
```

真实 fixture `删章回执`：删除第 3 章成功，剩 1、2；删第 1 章返回 `chapter-delete-latest-only`；移章返回 `chapter-move-unsupported`。

回执：`artifacts/real-runs/chapter.move-delete.json`。
