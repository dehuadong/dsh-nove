# Agent Note: 故事工坊：workspace.single-form 证据重验

Status: implemented

工作项：`capabilities.yaml` 的 `workspace.single-form`。复审曾把它冻结为 `missing`；本记录移除自创的“一个 workspace 只一种形态”限制，使复刻回到源工程行为。

## Problem

复审确认旧实现是自创限制：

- 源 `work-store.ts` 在一个 `works/` 树下按 profile 过滤，允许不同 profile 的作品共存；
- 源 `work-creation.ts` 的 `create_work` 接受 `profileId`，不是 workspace 级固定形态；
- 源迁移测试断言一个 root 下 7 个不同 profile 的作品；
- 当前 `catalog.db` 的 `workspace` 表固定 `form`，`ensureWorkspaceForm` 在第二次不同 form 时抛 `workspace-form-mismatch`；
- 真实回执只证明 preset 分支，不证明 workspace 限制。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/work-store.ts:79-102` | 一个 `works/` 树，按 `profileId` 过滤，不同 profile 作品可共存 | 复刻允许同一 workspace 多 form 作品 |
| `inkos-master/packages/core/src/harness/tools/work-creation.ts:12,22` | `create_work` 接受 `profileId`，在会话 profile 内创建作品 | 复刻 `initWork` 接受 form；workspace 不再否决 |
| `inkos-master/packages/core/src/__tests__/legacy-migration.flow.test.ts:41-52,90` | 同一 root 下 7 个不同 profile 的作品 | 复刻同一 root 下 longform + short 共存 |

## Decision

- 删除 workspace 级 form 权威：`workspace` 表、`ensureWorkspaceForm`、`readWorkspaceForm` 全部移除；catalog schema 不再创建该表。
- `story_init` 只按 `proposal.form`（当前 preset form）创建作品，不再检查 workspace form。
- preset 级 form 保留：`story_propose` 仍只接受当前 preset 的 form；short/script preset 尚未接线，存储层已允许混合 form，产品入口的后续扩展记为债。
- `presetFormOf` 对未知 preset 抛 `preset-form-unknown`，不再静默降级为 longform。
- `initWork` 的 form 继续写入作品 manifest。
- consumer `workspace-form.test.mjs` 验证同一 root 下 longform + short 共存、各作品保留自身 form、preset 仍拒绝另一 form、workspace 表已不存在。
- 审计 row 改为 `等价`；旧回执保留在 `artifacts/real-runs/stale-2026-11-07/`。

## Alternatives considered

- **保留 workspace 单形态。** 最强理由是面板简单；源工程明确允许混合 profile，保留就是自创限制，故移除。
- **只改测试不改存储。** 最强理由是少改代码；`ensureWorkspaceForm` 仍会拒绝第二个 form，行为不变，故必须删。
- **把限制登记为偏差。** 最强理由是 DSH 面板只支持长篇；源行为可观测且相反，不能登记为合法偏差，故不保留。

## Consequences

- **收益**：同一 workspace 可承载多形态作品；存储不再拥有 form 状态；作品 manifest 是唯一 form 权威。
- **代价**：`/story-init` 只创建目录，不再写 workspace form；旧 catalog 若残留 `workspace` 表会被忽略，不读取。
- **边界**：不新增 short/script preset；存储层允许多 form，但 short 产品入口尚未接线；preset 级 form 约束仍在；不做旧 catalog 迁移。

## Testing

```text
node storycraft/tests/workspace-form.test.mjs  # ALL CHECKS PASSED
node storycraft/tests/commands.test.mjs        # ALL CHECKS PASSED
node storycraft/e2e/run.mjs --grep "panel story-init"  # 1 passed
node storycraft/scripts/ci.mjs --no-e2e        # PASS: 106 unit files
npm run verify                                 # 2 verified / 38 missing
```

存储证据：`artifacts/real-runs/stale-2026-11-08/workspace.single-form.json`（混合 form 直接存储证明）。产品 short/script preset 尚未接线，能力保持 `missing`，债归属 `docs/fidelity-audit.md` 的 `workspace.single-form` 行。

[历史快照：故事工坊：workspace.single-form 工作项](../../archived/feature/2026-11-06-workspace-single-form.md)
