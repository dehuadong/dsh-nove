# Agent Note: 故事工坊：note-lifecycle-gate 工作项

Status: proposed

工作项：把 Agent Note 的生命周期规则做成机械门禁，防止 completed 工作留下 proposed Note，或出现 `topic` / `topic-implemented` 双份。

## Problem

`write-agent-notes` 现有校验只有 tree / format / archived / anchors，没有检查：

- proposed 是否已有对应 implemented；
- 同主题是否双份；
- verified 能力是否还留着 proposed；
- 完成时是否移动原文件而不是新建 `-implemented`。

12 个能力完成后 proposed 仍保留，我又建了 `-implemented` 副本，`npm run verify-notes` 全部通过。规则写在 Skill 里，却没有机械门禁。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `.agents/skills/write-agent-notes/SKILL.md` §4 | 施工完 proposed → implemented：移动同一文件、Status 改 implemented、Proposal→Decision、Acceptance/Risks 折进 Consequences；与代码同一 commit | Skill 级 lifecycle 脚本检查同 topic 唯一与 `-implemented` 双份 |
| `SKILL.md` §3 | 写新 Note 前检索 proposed/implemented/rejected，分类去重 | 项目级脚本检查 verified 能力的 proposed/implemented 对应 |
| `SKILL.md` §6 / `references/verification.md` | 现有脚本只校验 tree/format/archive/anchors | 新增 Skill 级 lifecycle 脚本，并在项目 verify 中串联 |
| `tools/implement-gate` | 当前 complete 只写 phase=complete，不检查 Note 生命周期 | complete 前按 task topic 检查 proposed Note |

## Proposal

### 1. Skill 级：`verify-agent-note-lifecycle.ts`

位置：`.agents/skills/write-agent-notes/scripts/verify-agent-note-lifecycle.ts`。

通用规则，不读 `capabilities.yaml`：

1. 文件名解析 `yyyy-mm-dd-topic.md`，去掉日期与可选 `-implemented` 后缀；
2. 同一 normalized topic 在 proposed/implemented/rejected 中最多一份；
3. 拒绝 `foo` 与 `foo-implemented` 双份；
4. Status 与目录一致；
5. 同一 topic 不得同时处于 proposed 与 implemented。

更新 `references/verification.md` 与 `SKILL.md` §6，并把脚本加入项目 `verify-notes`。

### 2. 项目级：`scripts/check-capability-note-lifecycle.mjs`

只做能力账本语义：

1. `verified` 能力必须有同 topic 的 implemented Note；
2. `verified` 能力不得有同 topic 的 proposed Note；
3. `missing` 能力可以有 proposed；
4. capability id → topic 归一化与别名表；
5. 失败时列出能力 id 与 Note 路径。

### 3. Gate：`implement_gate complete` 检查

`complete` 前：

- 取 `state.task`，归一化为 topic；
- 扫描 `.agents/notes/proposed/`；
- 若存在同 topic proposed Note，拒绝 complete，要求先移入 implemented；
- 无同 topic proposed 时照常 complete。

### 4. 一次性迁移

`proposed/architecture/2026-11-06-longform-single-form-workspace.md`：

- `## Proposal` → `## Decision`；
- 删 Acceptance/Plan Review；
- 补 Consequences/Verification；
- 移到 `implemented/architecture/`。

### 非目标

- 不把“写前加载 Skill / 检索历史”做成脚本：脚本无法证明 Agent 已加载 Skill；这条留在 `AGENTS.md` 与 Skill 操作纪律。
- 不改实现现有 `verify-agent-note-format` 的 Decision/Consequences 检查；它已经覆盖 3d。
- 不强制每个 capability 一个固定文件名，只做归一化 topic 比对。

## Alternatives considered

**只改项目脚本，不动 Skill。** 最强理由是隔离；通用规则属于 Skill 属主，12 个 proposed 已证明项目文档挡不住，故不采用。

**只改 Skill 脚本，不做项目 wrapper。** 最强理由是单一入口；Skill 不知道能力账本 status，无法判断 verified，故保留薄 wrapper。

**给 Gate 加完整 Note 解析。** 最强理由是统一；Gate 只做 task topic 匹配，完整解析留给 Skill/项目脚本。

## Acceptance criteria

1. Skill 级 lifecycle 脚本拒绝同 topic 双份与 `-implemented` 双份；
2. 项目级脚本拒绝 verified 缺 implemented、verified 仍 proposed；
3. `implement_gate complete` 在 task 仍有 proposed Note 时拒绝；
4. 当前 architecture Note 已迁 implemented 且格式通过；
5. `npm run verify` 包含 Skill lifecycle + 项目 lifecycle 检查并通过；
6. 12 个能力 Note 已迁 implemented，无重复。

## Plan Review

- Standards：通用规则归 Skill，能力语义归项目，complete 行为归 Gate。
- Spec：双份、verified 对应、complete 拒绝都可观察。
- Architecture：三层职责不重叠；脚本不读错属主数据。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 历史 capability id 与文件名别名不完全一致，需要映射表；
- Gate 的 task 归一化可能与 Note topic 不一致；
- 迁移 architecture Note 需要保持原理由/备选不被删。
