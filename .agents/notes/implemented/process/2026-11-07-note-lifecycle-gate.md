# Agent Note: 故事工坊：note-lifecycle-gate 工作项

Status: implemented

工作项：把 Agent Note 的生命周期规则做成机械门禁，防止 completed 工作留下 proposed Note，或出现 `topic` / `topic-implemented` 双份。

## Problem

`write-agent-notes` 现有校验只有 tree / format / archived / anchors，没有检查 proposed 是否已有对应 implemented、同主题是否双份、verified 能力是否还留着 proposed。12 个能力完成后 proposed 仍保留，又出现 `-implemented` 副本，`npm run verify-notes` 全部通过。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `.agents/skills/write-agent-notes/SKILL.md` §4 | 施工完 proposed → implemented：移动同一文件、Status 改 implemented、Proposal→Decision、Acceptance/Risks 折进 Consequences | Skill 级 lifecycle 脚本检查同 topic 唯一与 `-implemented` 双份 |
| `SKILL.md` §3 | 写新 Note 前检索 proposed/implemented/rejected，分类去重 | 项目级脚本检查 verified 能力的 proposed/implemented 对应 |
| `SKILL.md` §6 / `references/verification.md` | 现有脚本只校验 tree/format/archive/anchors | 新增 Skill 级 lifecycle 脚本，并在项目 verify 中串联 |
| `tools/implement-gate` | complete 只写 phase=complete，不检查 Note 生命周期 | complete 前按 task topic 检查 proposed Note |

## Decision

- Skill 级 `verify-agent-note-lifecycle.ts`：
  - 同 topic 在 proposed/implemented/rejected 中最多一份；
  - 禁止 `foo` 与 `foo-implemented` 双份；
  - Status 与目录一致；
  - 不读能力账本。
- 项目级 `check-capability-note-lifecycle.mjs`：
  - verified 必须有 implemented Note；
  - verified 不得有 proposed Note；
  - missing 可以有 proposed；
  - capability id → topic 归一化。
- Gate complete 前按 task topic 检查 proposed Note；
- `verify-notes` 接入 Skill 级脚本，`verify` 接入项目级脚本；
- “写前加载 Skill、检索历史”保留为操作纪律，不做脚本。

## Alternatives considered

- **只改项目脚本，不动 Skill。** 最强理由是隔离；通用规则属于 Skill 属主，故不采用。
- **只改 Skill 脚本，不做项目 wrapper。** 最强理由是单一入口；Skill 不知道能力 status，无法判断 verified，故保留薄 wrapper。
- **给 Gate 加完整 Note 解析。** 最强理由是统一；Gate 只做 task topic 匹配，完整解析留给 Skill/项目脚本。

## Consequences

- `verify-notes` 现在会拒绝同 topic 双份与 proposed/implemented 并存；
- `verify` 会拒绝 verified 缺 implemented 或仍留 proposed；
- complete 在 task 仍有 proposed 时拒绝；
- 现有 12 个能力 Note 已迁 implemented，architecture 程序 Note 已迁 implemented；
- 旧 rejected `runtime-session-binding` 已删除。

## Verification

```text
node .agents/skills/write-agent-notes/scripts/verify-agent-note-lifecycle.ts --root .agents/notes
# ok: 33 note topics, one lifecycle each
node scripts/check-capability-note-lifecycle.mjs
# ok: 19 verified capabilities have implemented notes
npm run verify
# 通过
```
