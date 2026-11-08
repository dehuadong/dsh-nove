# Agent Note: 故事工坊：runtime.session-binding 证据重验

Status: implemented

工作项：`capabilities.yaml` 的 `runtime.session-binding`。复审曾把它冻结为 `missing`；本记录修复绑定迁移、原子性与证据。

## Problem

旧实现与源行为不一致：

- 源 `transitionSessionToWork` 在会话创建新作品后，用 CAS 将绑定从 expectedWorkId 迁到新作品；
- 当前 `story_init` 在已有不同 current 时直接抛 `work-mismatch`，不能迁；
- `/current` 先写内存 `setCurrent`，再写 catalog `setSessionCurrent`；catalog 拒绝时内存已经改绑；
- 绑定 write 没有 hydrate，冷内存 + 持久行会绕过检查；
- Note 与 tool registry 对“显式 work 是否覆盖”描述矛盾。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/interaction/book-session-store.ts:17-45` | `transitionSessionToWork` 用 expectedWorkId CAS 迁移绑定；冲突抛 SESSION_TARGET_CONFLICT | 复刻 `setSessionCurrent` 增加 expected 参数 |
| `interaction/book-session-store.ts:57-66` | 已绑定会话创建新作品后切到新作品 | 复刻 `story_init` 成功后 CAS 迁移 |
| `agent/agent-session.ts:1026-1039` | WORK_CREATION_ACTIONS 成功后调用 transition | 复刻 `story_init` 成功路径 |
| `studio/src/api/server.ts:4707-4735` | 非创作动作的显式改绑仍需拒绝 | `/current` 仍只允许未绑定或同一作品 |

## Decision

- `setSessionCurrent(root, sessionId, workId, { expectedWorkId })`：
  - 无 expected：已绑定不同作品仍 `work-binding-mismatch`；
  - 有 expected：CAS，冲突 `work-binding-conflict`；匹配时更新。
- `story_init` 删除“已有不同 current 拒绝”；创建成功后以 `expectedWorkId=current` 迁移，再 `setCurrent(..., { allowRebind: true })`。
- `/current` 先 hydrate，再写 catalog，成功后才写内存；失败时内存不变。
- 旧 Note 归档，新 Note 接管；`docs/dsh-mapping.md` 会话绑定更新为 CAS + catalog 权威。
- consumer：`session-binding-revalidation.test.mjs` 覆盖 CAS、冲突、手动拒绝、创作迁移。

## Alternatives considered

- **保持不可改绑。** 最强理由是 UI 简单；源工程明确允许创作动作后迁移，保留就是行为不一致，故不采用。
- **只修 `/current` 原子性。** 最强理由是修真实 bug；不解决源 CAS 语义，复审仍会判不一致，故一并做。
- **迁移失败回滚作品。** 最强理由是一致性；源 transition 在创建成功后执行，不回滚作品，故保留作品并返回冲突。

## Consequences

- **收益**：创作动作可以迁移绑定；手动改绑仍被拒绝；catalog 失败不会污染内存；冷内存 hydrate 后不绕过。
- **代价**：`story_init` 在切换作品时不再拒绝；绑定写入多一次 hydrate/事务；旧测试中的“第二部作品拒绝”改为迁移。
- **边界**：panel 新建会话分支仍未改；旧 Note 已归档。

## Testing

```text
node storycraft/tests/session-binding-revalidation.test.mjs  # ALL CHECKS PASSED
node storycraft/tests/tools.test.mjs                         # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e                      # PASS: 107 unit files
npm run verify                                               # 3 verified / 38 missing
```

真实回执：`artifacts/real-runs/runtime.session-binding.json`，testedCommit `d98d0a3`。
