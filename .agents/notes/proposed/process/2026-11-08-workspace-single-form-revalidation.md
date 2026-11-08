# Agent Note: 故事工坊：workspace.single-form 证据重验

Status: proposed

工作项：`capabilities.yaml` 的 `workspace.single-form` 重验。复审已把它冻结为 `missing`；本工作项移除自创的“一个 workspace 只一种形态”限制，使复刻回到源工程行为。

## Problem

复审确认当前实现是自创限制：

- 源 `work-store.ts` 在一个 `works/` 树下按 profile 过滤，允许不同 profile 的作品共存；
- 源 `work-creation.ts` 的 `create_work` 接受 `profileId`，不是 workspace 级固定形态；
- 源迁移测试 `legacy-migration.flow.test.ts` 断言一个 root 下 7 个不同 profile 的作品；
- 当前 `catalog.db` 的 `workspace` 表固定 `form`，`ensureWorkspaceForm` 在第二次不同 form 时抛 `workspace-form-mismatch`；
- `story_propose`/`story_init` 把 preset form 当成 workspace form，真实回执只证明 preset 分支，不证明 workspace 限制；
- 审计 row 却把它写成 `保真债` 并给出“当行补齐”的闭环，实际没有补。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/work-store.ts:79-102` | 一个 `works/` 树，按 `profileId` 过滤，不同 profile 作品可共存 | 复刻允许同一 workspace 多 form 作品 |
| `inkos-master/packages/core/src/harness/tools/work-creation.ts:12,22` | `create_work` 接受 `profileId`，在会话 profile 内创建作品 | 复刻 `initWork` 接受 form；不再由 workspace 否决 |
| `inkos-master/packages/core/src/__tests__/legacy-migration.flow.test.ts:41-52,90` | 同一 root 下 7 个不同 profile 的作品 | 复刻测试同一 root 下 longform + short 共存 |

## Proposal

### 范围

- 删除 workspace 级 form 权威：
  - 删除 `workspace` 表的读取/写入与 `ensureWorkspaceForm` / `readWorkspaceForm`；
  - `catalog.db` schema 不再创建 `workspace` 表；
  - `story_init` 只按 `proposal.form`（即当前 preset form）创建作品，不再检查 workspace form；
- preset 级 form 仍保留：
  - `story_propose` 仍只接受当前 preset 的 form（源 profile 内的创建约束）；
  - 不同 preset/会话可在同一 workspace 创建不同 form 的作品；
- `initWork` 的 form 继续写入作品 manifest；
- consumer `workspace-form.test.mjs` 改为：
  - 同一 root 先建 longform、再建 short，两个作品都列出；
  - `story_init` 不再因 workspace 已有另一 form 而拒绝；
  - `story_propose` 的 preset form 约束保留；
- 审计 row 改为 `等价`，链接 `docs/dsh-mapping.md` 作品存储条目；
- 旧回执保留在 `artifacts/real-runs/stale-2026-11-07/`，新回执在当前树生成。

### 非目标

- 不新增 short/script preset 或面板；
- 不做旧 catalog 迁移；
- 不改变 `story_init` 的“一会话一当前作品”约束。

### 失败行为

- 同 workspace 不同 form 作品：允许；
- `story_propose` 请求与 preset 不同的 form：仍 `workspace-form-mismatch`（preset 级，不是 workspace 级）；
- 旧 `workspace` 表存在但无消费者：忽略，不读取。

## Alternatives considered

**保留 workspace 单形态。** 最强理由是面板简单；源工程明确允许混合 profile，保留就是自创限制，故移除。
**只改测试不改存储。** 最强理由是少改代码；`ensureWorkspaceForm` 仍会拒绝第二个 form，行为不变，故必须删。
**把限制登记为偏差。** 最强理由是 DSH 面板只支持长篇；源行为可观测且相反，不能登记为合法偏差，故不保留。

## Acceptance criteria

1. 同一 workspace 可创建 longform 与 short 两个作品；
2. `story_init` 不因 workspace 已有另一 form 而拒绝；
3. `story_propose` 的 preset form 约束仍生效；
4. workspace 表不再被读取/写入，schema 不再创建；
5. consumer 测试与真实回执齐全；
6. 审计 row 改为等价并链接真实 dsh-mapping 条目；
7. `check-capabilities --write` 后才置 `verified`。

## Plan Review

- Standards：移除自创限制，不把面板限制写成源行为；preset 级 form 保留。
- Spec：混合 form、init 放行、propose 拒绝、schema 移除都可观察。
- Architecture：form 属于作品 manifest/preset，不属于 workspace；存储层不再拥有该状态。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 删除 workspace 表需要同步 catalog schema 测试与旧测试断言；
- `story_init` 仍只按 preset form，短篇 preset 尚未接线，本行不解决；
- 真实回执需要同一 root 的两个 form 作品，fixture 要准备。
