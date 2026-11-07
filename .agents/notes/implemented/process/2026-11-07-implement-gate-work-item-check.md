# Agent Note: implement-gate：work-item-check 与 return-to-discuss

Status: implemented

工作项：修正 Gate 的进入/返回规则，使 `discuss` 可以分支到 `planning` 或直接 `implement`，并在实现中允许回到 `discuss`。

## Problem

原 Gate 允许无 proposed 的 implement，也能直接 implement；但实现中遇到范围外问题，`phase` 一直停在 `implement`，无法写 proposed Note 或回到讨论。

不能强制所有 implement 都有 proposed：Skill 允许机械小改不写 Note，GATES 也允许工作已明确定义时直接 implement。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `see-dsh-novel/docs/agents/GATES.md:37-43` | 范围内修正继续；范围/合同变化回 Discuss，再授权 | 新增 `return-to-discuss`，保留 task、不续授权 |
| `see-dsh-novel/.agents/skills/implement/SKILL.md:44-57` | Implementation Review 发现合同问题返回项目 gate | Gate 允许 implement→discuss，planning/implement 仍分支 |
| 本仓库 `AGENTS.md` | discuss 后按 GATES 推进，不要求固定三步 | implement 前置只检查工作项，不要求 planning |

## Decision

- implement 任务必须满足任一：
  - 同 topic 的 proposed Note（可写 `proposed:<topic>`）；
  - `mechanical:<说明>`；
- 没有工作项时：不进入 implement，保持当前 phase，记录 `blockReason='work-item-required'`；
- 新增 `implement_gate({action:'return-to-discuss'})`：implement/planning → discuss，保留 task；
- complete 的 proposed 检查跳过 mechanical；`proposed:` 前缀归一化后再匹配；
- 不查 `capabilities.yaml`；
- `codeExtensions`、`protected` 保留；`codePaths` 默认空；`proposed` 不再特殊分类。

## Alternatives considered

- **绝对要求 proposed。** 最强理由是简单；违反机械小改免写与直接 implement 分支，故不采用。
- **查 capabilities.yaml。** 最强理由是项目内精确；Gate 通用插件不能耦合产品账本，故不采用。
- **保留 proposed 特殊拦截。** 最强理由是保护规划笔记；会把文档治理卷入代码门禁，故改为普通文档。

## Consequences

- 无工作项 implement 不再静默进入；phase 保持，blockReason 可在 status 读取；
- proposed 工作项在 complete 前必须移入 implemented，否则 complete 返回 `proposed-note-exists`；
- mechanical 可无 Note 完成，但仍只能改代码；
- return-to-discuss 不自动授予新范围，新范围需要重新授权。

## Verification

```text
node tools/implement-gate/test.mjs   # ALL CHECKS PASSED
npm run verify                       # 通过
```

测试覆盖：proposed 工作项进入 implement、complete 被 proposed 阻断、return-to-discuss、无工作项保持 discuss、mechanical 进入并完成。
