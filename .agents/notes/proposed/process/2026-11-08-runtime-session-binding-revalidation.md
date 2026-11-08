# Agent Note: 故事工坊：runtime.session-binding 证据重验

Status: proposed

工作项：`capabilities.yaml` 的 `runtime.session-binding` 重验。复审已把它冻结为 `missing`；本工作项修复绑定语义、原子性与真实证据。

## Problem

复审确认旧实现与源行为不一致：

- 源 `transitionSessionToWork` 在会话创建新作品后，用 CAS 将绑定从 expectedWorkId 迁到新作品；
- 当前 `story_init` 在已有不同 current 时直接抛 `work-mismatch`，不能迁；
- `/current` 路由先写内存 `setCurrent`，再写 catalog `setSessionCurrent`；catalog 拒绝时内存已经改绑，形成“内存指向新作品、catalog 仍旧”的分裂；
- 绑定 write 没有 hydrate，冷内存 + 持久行会绕过检查；
- Note 说“显式 work 仍覆盖会话绑定”，tool registry 实际拒绝显式 work；
- Note 的 panel handoff 段已过时，client 新建会话分支还有 `created?.sessionId` 读取错误。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/interaction/book-session-store.ts:17-45` | `transitionSessionToWork` 用 expectedWorkId CAS 迁移绑定；冲突抛 SESSION_TARGET_CONFLICT | 复刻 `setSessionCurrent` 增加 expected 参数；创作动作可迁移 |
| `interaction/book-session-store.ts:57-66` | 已绑定会话创建新作品后切到新作品 | 复刻 `story_init` 不再用 `work-mismatch` 拒绝，改为 CAS 迁移 |
| `agent/agent-session.ts:1026-1039` | WORK_CREATION_ACTIONS 成功后调用 transition | 复刻 `story_init` 成功后 transition |
| `studio/src/api/server.ts:4707-4735` | 非创作动作的显式改绑仍需拒绝 | `/current` 仍只允许未绑定或同一作品 |

## Proposal

### 范围

1. `setSessionCurrent(root, sessionId, workId, { expectedWorkId? })`：
   - 无 expected 时保持“已绑定不同作品拒绝”；
   - 有 expected 时做 CAS：当前行必须等于 expected，否则 `work-binding-conflict`；
   - 新行插入/同作品幂等；
2. `story_init`：
   - 删除“已有不同 current 拒绝”；
   - 创建成功后用 `expectedWorkId=current` 调用 `setSessionCurrent`，再更新内存；CAS 冲突不回滚已创建作品，返回冲突；
3. `/current`：
   - 先 `setSessionCurrent`（catalog），成功后才 `setCurrent`（内存）；
   - 写前 hydrate catalog，避免冷内存绕过；
   - 失败时内存不变；
4. consumer：
   - 已绑定会话创建第二部作品 → 绑定迁到新作品；
   - 并发/过期 expected → `work-binding-conflict`，旧绑定保留；
   - `/current` 写 catalog 失败 → 内存仍旧；
   - 非创作动作显式改绑仍拒绝；
5. 旧 Note 归档，新 Note 接管；真实回执记录当前树会话。

### 非目标

- 不改 panel 的新建会话分支（另立 panel 工作项）；
- 不恢复旧 verified；
- 不改变“一会话一个当前作品”的目标，只改变切换方式。

### 失败行为

- 非创作改绑 → `work-binding-mismatch`；
- CAS expected 不匹配 → `work-binding-conflict`；
- catalog 写失败 → 内存不变；
- 作品创建成功但绑定迁移冲突 → 作品保留，绑定旧值保留，返回冲突。

## Alternatives considered

**保持不可改绑。** 最强理由是 UI 简单；源工程明确允许创作动作后迁移，保留就是行为不一致，故不采用。
**只修 `/current` 原子性。** 最强理由是修真实 bug；不解决源 CAS 语义，复审仍会判不一致，故一并做。
**迁移失败回滚作品。** 最强理由是一致性；源 transition 在创建成功后执行，不回滚作品，故保留作品并返回冲突。

## Acceptance criteria

1. 创作动作后绑定迁到新作品；
2. 非创作显式改绑仍拒绝；
3. CAS 冲突返回 `work-binding-conflict`，旧绑定保留；
4. `/current` 先 catalog 后内存，失败时内存不变；
5. 冷内存 hydrate 后不会绕过；
6. 旧 Note 归档，新 Note 接管；
7. consumer 与真实回执齐全后才置 `verified`。

## Plan Review

- Standards：源 CAS 迁移与“非创作拒绝”分开；不把 panel bug 混入。
- Spec：迁移、冲突、原子性、冷内存、拒绝都可观察。
- Architecture：catalog 是绑定权威；内存是缓存；创作动作是唯一迁移入口。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 改变“绑定不可改”会影响现有测试与面板假设；
- 迁移冲突时作品已创建，需要明确返回与 UI 提示；
- `/current` 冷内存 hydrate 需要读 catalog，增加一次查询。
