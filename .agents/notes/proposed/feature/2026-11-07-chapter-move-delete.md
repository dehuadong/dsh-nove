# Agent Note: 故事工坊：chapter.move-delete 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.move-delete`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计发现当前实现明显超出源工程：

- 源 `deleteLatestChapter` **只允许删除最新章**；中间章直接拒绝；
- Studio 也只在 `num === latestChapter` 时给删除按钮；
- 源没有移章动作；
- 源删除时把章节文件移入 `chapters/.trash/`，并把索引/快照/runtime 回滚到前一章；
- 当前 `deleteChapter` 可删任意章并重编号，`moveChapter` 可移相邻章，只有 DB backup，没有章节 trash/快照回滚。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/state/chapter-delete.ts:1-120` | 只删最新章；中间章拒绝；文件进 `.trash`；回滚到前一章快照 | 复刻应限制最新章；trash/快照为债 |
| `packages/studio/src/api/server.ts:3180-3190` | 删除路由调用 `deleteLatestChapter`，中间章 400 | 复刻删除只允许 latest |
| `packages/studio/src/api/server.ts:3046` | `canDelete = num === latestChapter` | 面板只对最新章显示删除 |
| 源无 move 端点/函数 | 不支持移章 | 复刻移章应移除或明确不支持 |

## Proposal

### 严格方案（推荐）

- `deleteChapter`：
  - 只允许最大章号；
  - 其他章抛 `chapter-delete-latest-only`；
  - 保留 DB backup；
  - `.trash` 章节文件与快照回滚登记为当行债（SQLite 存档需单独设计）。
- `moveChapter`：
  - 源无此行为，移除面板按钮与 API 路由；
  - 保留函数但拒绝 `chapter-move-unsupported`，避免调用方静默；
  - consumer 测试删除移章断言，改为拒绝断言。
- 面板：只有最新章显示删除；移章按钮移除。
- 真实回执：删最新章成功；删中间章拒绝；移章拒绝。

### 扩展方案（不推荐）

保留任意删/移，登记为 DSH 扩展。但源行为可观测且明确拒绝中间删除，没有合法偏差理由；只能算保真债，不能算等价。

## Alternatives considered

**保留任意删除/移章。** 最强理由是作者灵活；源明确只删最新，且移章无源行为，故不采用。
**只限制删除，不移除移章。** 最强理由是少改 UI；移章仍无源证据，故一并移除。
**保留函数但隐藏 UI。** 最强理由是兼容调用；函数仍可产生无源行为，故函数也拒绝。

## Acceptance criteria

1. 删除非最新章 → `chapter-delete-latest-only`；
2. 删除最新章成功，章节数减一；
3. 移章 API/面板移除，函数调用 → `chapter-move-unsupported`；
4. 面板只在最新章显示删除；
5. `.trash`/快照回滚债在审计表有归属；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：源只删最新、无移章；复刻按源收紧，不保留无证据扩展。
- Spec：最新/中间删除、移章拒绝、面板可见性都可观察。
- Architecture：删除走 `deleteChapter`；移章不再作为产品能力。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 移除移章会影响现有面板测试与作者习惯；
- `.trash`/快照回滚不是本行能等价完成的，会保持债；
- 删除最新章仍需处理事件/检索/artifacts 重映射，测试要覆盖。
