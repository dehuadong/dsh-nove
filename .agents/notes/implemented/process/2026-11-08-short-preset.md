# Agent Note: 故事工坊：short.preset 短篇预设

Status: implemented

工作项：新增 `capabilities.yaml` 的 `short.preset`。它只建立短篇形态的产品入口，不实现短篇大纲、草稿、审校或打包。

## Problem

`workspace.single-form` 的存储限制已移除，但产品入口只有 `storycraft`（longform）：

- `PRESET_FORM` 只有 `storycraft: 'longform'`；
- 没有 `storycraft-short` 预设，`story_init` 永远创建 longform 作品；
- 因此同一 workspace 多形态没有真实产品路径。

源工程有独立的 `short-fiction` profile，不是 longform 的参数。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/builtin-profiles.ts:23-29` | `short-fiction` profile，capabilityIds 含 `short-fiction`，artifactKinds 为 outline/manuscript/sales-package/cover | 复刻新增短篇预设，form=`short` |
| `inkos-master/packages/core/src/pipeline/short-fiction-runner.ts:208-306` | 短篇有独立 outline/draft/review/package 流水线 | 本行只做 preset 入口；流水线留给 short.outline 等后续能力 |
| `inkos-master/packages/core/src/agents/short-fiction.ts:20-30` | short-fiction 角色与结构化提交 | 本行不实现该角色，登记后续债 |

## Decision

- `capabilities.yaml` 新增 `short.preset`；
- `cordis.patch.yml` 新增 `storycraft-short` 预设，复用标准基线、技能与工具，persona 为短篇；
- `PRESET_FORM` 增加 `storycraft-short: 'short'`；`story_propose` / `story_init` 在短篇预设下创建 form=`short`；
- `storycraft-short` 与 `storycraft` 共享同一 workspace，可分别创建 short/longform 作品；
- 未知 preset 仍抛 `preset-form-unknown`；
- consumer 为 `e2e/preset.spec.cjs`（两个预设均挂载）与 `workspace-form.test.mjs`（short 动作路径）。

## Alternatives considered

- **不建预设，只让 story_init 接受 form 参数。** 最强理由是少改 bundle；源工程用 profile 区分形态，参数会让 longform 会话创建短篇作品，形态语义混乱，故不采用。
- **直接做完整短篇流水线。** 最强理由是可以一次闭环；四个 short 能力是独立纵向工作，塞进本行会超范围，故只做入口。
- **把 short 作为 longform 模式。** 最强理由是复用现有工具；源工程有独立 profile 和 skill，故不采用。

## Consequences

- **收益**：短篇 preset 可挂载；短篇会话能创建 short 作品；同一 workspace 的产品路径可混合 form。
- **代价**：thin preset 仍暴露现有动作集，没有 short 流水线；复制了一份标准组合，DSH 升级时需同步。
- **边界**：`short.outline`、`short.batch-draft`、`short.review-revise`、`short.package` 仍为 missing；短篇技能尚未接入。

## Testing

```text
node storycraft/e2e/run.mjs --grep "故事工坊工作模式"  # 2 passed
node storycraft/tests/workspace-form.test.mjs          # ALL CHECKS PASSED
node storycraft/tests/presets.test.mjs                 # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e                # PASS: 106 unit files
npm run verify                                         # 2 verified / 39 missing
```

直接回执已归档到 `artifacts/real-runs/stale-2026-11-08/short.preset.json`：preset roster 与短篇 action 测试通过，但没有真实 `storycraft-short` 会话，因此 `short.preset` 保持 `missing`；债归属 `docs/fidelity-audit.md` 的 `short.preset` 行。
