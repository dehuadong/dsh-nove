# Agent Note: 故事工坊：note-lifecycle-gate 工作项

Status: proposed

工作项：治理 `.agents/notes/` 的生命周期，防止 completed 工作留下 proposed Note，或出现 `topic` / `topic-implemented` 双份。

## Problem

`write-agent-notes` 的校验只有 tree / format / archived / anchors：

- 不检查 proposed 是否已有对应 implemented；
- 不检查同主题是否双份；
- 不检查 verified 能力是否还留着 proposed；
- 不检查完成时是否移动原文件而不是新建 `-implemented`。

结果是 12 个能力完成后 proposed 仍保留，我又建了 `-implemented` 副本，`npm run verify-notes` 全部通过。规则写在 Skill 里，但没有机械门禁。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `.agents/skills/write-agent-notes/SKILL.md` §4 | 施工完 proposed → implemented：移动同一文件、Status 改 implemented、Proposal→Decision、Acceptance/Risks 折进 Consequences；与代码同一 commit | 复刻用脚本检查同一 topic 只能有一个活跃 Note |
| `SKILL.md` §3 | 写新 Note 前检索 proposed/implemented/rejected，分类去重 | 复刻检查重复 topic、proposed 与 implemented 并存 |
| `SKILL.md` §6 / `references/verification.md` | 现有脚本只校验 tree/format/archive/anchors | 新增项目级 lifecycle checker；不改 Skill 脚本 |

## Proposal

### 1. `scripts/check-note-lifecycle.mjs`

读取：

- `capabilities.yaml` 的 `id/status`；
- `.agents/notes/{proposed,implemented,rejected}/**/*.md`；
- 从文件名取 `yyyy-mm-dd-topic.md`，去掉日期与可选 `-implemented` 后缀。

规则：

1. 同一 normalized topic 在 proposed/implemented/rejected 中最多一份；
2. 出现 `foo` 与 `foo-implemented` 双份即失败；
3. `verified` 能力必须有同 topic 的 implemented Note；
4. `verified` 能力不得有同 topic 的 proposed Note；
5. proposed Note 的 `Status: proposed`，implemented 的 `Status: implemented`；
6. 允许 missing 能力有 proposed；允许 implemented 存在但能力仍 missing（证据未齐）；
7. 对没有同 topic Note 的 verified 能力，失败并列出能力 id。

### 2. 当前 architecture Note 一次性迁移

`proposed/architecture/2026-11-06-longform-single-form-workspace.md`：

- 三个能力已 verified；
- 正文仍是 Proposal/Acceptance；
- 实施时改成 implemented：`## Proposal`→`## Decision`，删 Acceptance/Plan Review，补 Consequences/Verification，移到 `implemented/architecture/`。

### 3. 接入

- `npm run check-note-lifecycle`；
- `npm run verify` 加入该检查；
- `implement_gate complete` 前，若当前 task 仍有同 topic proposed Note，拒绝 complete（由 Gate 插件读取 task/topic）。

### 非目标

- 不改 `write-agent-notes` 的 Skill 脚本；
- 不强制每个 capability 一个固定文件名（只做 normalized topic 比对）；
- 不检查正文现在时（散文纪律）。

## Alternatives considered

**只靠 Skill 文档。** 最强理由是零代码；12 个 proposed 已经证明文档挡不住，故不采用。

**直接改 Skill 的 verify 脚本。** 最强理由是统一入口；会改变所有使用该 Skill 的项目，故用项目级 checker。

**要求每个 Note 带 capability id frontmatter。** 最强理由是映射精确；会改所有历史 Note，先按文件名匹配，后续再引入 frontmatter。

## Acceptance criteria

1. checker 拒绝 proposed+implemented 同 topic；
2. checker 拒绝 `foo` + `foo-implemented`；
3. checker 拒绝 verified 能力缺 implemented Note；
4. checker 拒绝 verified 能力仍有 proposed Note；
5. 当前 architecture Note 已迁 implemented 且格式通过；
6. `npm run verify` 包含 lifecycle 检查并通过。

## Plan Review

- Standards：项目级脚本，不动 Skill；规则与 SKILL §4 对齐。
- Spec：重复、缺 implemented、verified 留 proposed 都可观察。
- Architecture：文件名 topic 作为身份；capability id 归一化为 topic。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 历史 Note 文件名与 capability id 不完全一致，需先做别名表；
- 能力 id 与 topic 归一化可能误判，先只对 verified 强制；
- Gate complete 检查需要插件改动，可能延后到脚本门禁之后。
