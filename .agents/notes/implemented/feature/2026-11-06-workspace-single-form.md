# Agent Note: 故事工坊：workspace.single-form 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `workspace.single-form`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、后果与验证。

## Problem

工作区没有形态权威：`story_init` 可创建任意 form 的作品，提案也可跨形态；同一工作区可能混入长篇、短篇、剧本。预设、面板与会话绑定因此没有稳定的形态边界。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/builtin-profiles.ts:15-33` | 长篇、短篇、剧本各自是 profile，required skills/artifact kinds 不同 | 采纳形态由 profile 区分；复刻把当前长篇预设的 form 写入工作区 |
| `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话由 sessionKind/bookId 绑定 profile 与 work | 等价适配：DSH 没有 sessionKind 枚举，复刻由预设声明 form、工作区保存 form |

## Decision

- `catalog.db` 增加 `workspace` 表：`id=1`、`form`、`preset_id`、`created_at`；
- `readWorkspaceForm(root)` 读固定形态；`ensureWorkspaceForm(root, form, presetId)` 首次写入，之后不一致抛 `workspace-form-mismatch`；
- `story_init` 与 `story_propose` 从当前会话预设的 form 取值（当前 `storycraft` 预设 → `longform`），不再接受跨形态提案/立项；
- `story_init` 把 form 传给 `initWork`，同一工作区可创建多部作品，但全部同 form、一作品一库；
- 旧 catalog（user_version 1）打开时补建 `workspace` 表；不迁移旧作品，测试工作区重建。

## Alternatives considered

- **让 `story_init` 继续接受 form。** 最强理由是调用方灵活；但工作区就没有固定形态，预设/面板无法稳定绑定。
- **一个工作区只允许一部作品。** 最强理由是绑定最简单；但同形态多作品是作者的真实用法，强制拆工作区会把形态边界转成目录管理。
- **在 `initWork` 内拒绝跨 form。** 最强理由是边界最靠近存储；但测试/导入需要直接构造不同 form 的 fixture，产品边界应收在动作层。

## Consequences

- **收益**：工作区形态有单一权威；跨形态提案/立项被拒绝；后续会话绑定与长篇面板可以只针对 `longform` 工作区。
- **代价与已知上限**：当前预设 form 由代码表 `PRESET_FORM = { storycraft: 'longform' }` 映射，尚未由预设配置直接声明；短篇/剧本预设加入时需要扩展该表。
- **真实回执**：重启加载新插件后，`session-460...` 的 `story_propose(form: short)` 返回 `workspace-form-mismatch`；消费者测试与 99 个单元文件通过。回执写入 `artifacts/real-runs/workspace.single-form.json`，账本已置 `verified`。

## Verification

```text
node storycraft/tests/workspace-form.test.mjs   # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e         # PASS: 99 unit files
npm run verify                                  # 39 capabilities: 4 verified, 35 missing
```

真实会话 `session-4604579f-a577-4ea1-88a1-51d867f3d7b6` 的 `story_propose(form: short)` 返回 `workspace-form-mismatch`；回执在 `artifacts/real-runs/workspace.single-form.json`。
