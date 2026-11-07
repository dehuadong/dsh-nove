# Agent Note: 故事工坊：chapter.finalize 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.finalize`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计已判定定稿等价，但能力行没有真实回执。需要证明 ready 草案、当前正文绑定、事件写入、settled 锁和重复拒绝。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/writer.ts:600-650` | 结算后写章节元数据并保存 | 复刻 `finalizeChapter` 应用状态草案 |
| `pipeline/runner.ts:999-1040` | 结算/定稿走 writer.saveChapter，stage 推进 | 复刻 settle 事件与 settled 锁 |
| `settler-tool.ts` 的 settlement | 草案未接受不能定稿 | 复刻 `state-not-ready` 与 ready 校验 |

## Decision

- consumer 保持 `settle-draft.test.mjs`；
- 真实回执：`定稿回执` 第 1 章，draft ready，finalize appended 1，stage settled，事件 2，草案删除；
- 不改 reopen、不改草案生成。

## Alternatives considered

- **只靠单测。** 最强理由是覆盖完整；能力验收还要真实回执，故补。
- **重复定稿幂等。** 最强理由是方便重试；语义是拒绝，故不采用。
- **定稿并入结算。** 最强理由是少一步；作者接受草案后定稿是闸门，故不合并。

## Consequences

- **收益**：ready/当前绑定、事件写入、settled 锁有真实证据；草案删除。
- **代价**：真实 fixture 需先结算并接受草案。
- **边界**：不改 reopen；不改 settle draft 生成。

## Verification

```text
node storycraft/tests/settle-draft.test.mjs  # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e      # PASS: 105 unit files
npm run verify                               # 22 verified / 18 missing
```

真实 fixture `定稿回执`：appended 1，stage settled，events 2，草案删除。

回执：`artifacts/real-runs/chapter.finalize.json`。
