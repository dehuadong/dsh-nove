# Agent Note: 故事工坊：chapter.revise 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.revise`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计登记：源模式词表与当前不同；`spot-fix` 范围替换未实现；长度用 `countWords` 与百分比门槛，未用 `lengthSpec`。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/reviser.ts:15-80` | 模式 polish/rewrite/rework/anti-detect/spot-fix | 复刻接受 source 模式，并保留 patch/deslop 别名 |
| `agents/reviser.ts:100-160` | spot-fix 只替换选中源码范围 | 本行先映射到现有 patch 行为；范围替换登记后续债 |
| `utils/length-metrics.ts:52-65` | 显式 min/max 硬校验；target 不硬卡 | 复刻修订后按 countChapterLength 与 wordRange 校验 |

## Decision

- `REVISE_MODE_NAMES`：`polish/rewrite/rework/anti-detect/spot-fix`；
- 别名：`patch→spot-fix`、`deslop→anti-detect`；`rework` 保留原名；
- `reviseChapter` 用 canonical mode 做门槛与 review 覆盖判断，`last_revise_mode` 存原值；
- `assertRevisionMode` 用 `countChapterLength`；
- tool/action schema 接受全部模式；
- consumer 改为 `revision-modes.test.mjs`。

## Alternatives considered

- **只加别名不改长度。** 最强理由是低风险；源用 lengthSpec，故同时改计数。
- **立即实现范围替换。** 最强理由是完整；范围编辑是独立契约，本行登记后续债。
- **rework 独立实现。** 最强理由是保留语义；内部与 rewrite 相同，先映射并保留 lastMode。

## Consequences

- **收益**：source 模式可用；patch/deslop 兼容；长度统计与 chapter.write 一致；lastMode 不丢语义。
- **代价**：spot-fix 仍是整段重写，范围外字节不保证；审计保持债。
- **边界**：范围替换、en_words 未实现。

## Verification

```text
node storycraft/tests/revision-modes.test.mjs      # ALL CHECKS PASSED
node storycraft/tests/revision-adopt.test.mjs      # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e            # PASS: 105 unit files
npm run verify                                     # 19 verified / 21 missing
```

真实 fixture `伏笔回执`：mode `anti-detect`，revision 2，lastMode `anti-detect`。

回执：`artifacts/real-runs/chapter.revise.json`。
