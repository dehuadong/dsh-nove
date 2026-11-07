# Agent Note: 故事工坊：chapter.finalize 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.finalize`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计已判定定稿等价，但能力行没有真实回执；consumer 已改为 `settle-draft.test.mjs`。需要证明状态草案 ready、绑定当前正文、定稿写事件并锁 settled、重复定稿拒绝。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/writer.ts:600-650` | 结算后写章节元数据并保存 | 复刻 `finalizeChapter` 应用状态草案 |
| `pipeline/runner.ts:999-1040` | 结算/定稿走 writer.saveChapter，stage 推进 | 复刻 state 草案 ready 后写 settle 事件并锁 settled |
| `settler-tool.ts` 的 settlement | 草案未接受不能定稿 | 复刻 `state-not-ready` 与 ready 校验 |

审计：`docs/fidelity-audit.md` 的 `chapter.finalize` 判定等价，无债。

## Proposal

### 范围

- 验证 `finalizeChapter`：
  - 正文存在；
  - 状态草案 ready；
  - draft.revision 与 state_ready_revision 都等于当前正文；
  - 应用 fact/hook 事件并写 settle 标记；
  - 删除草案；
  - stage/status 置 settled；
  - 重复定稿拒绝。
- consumer 保持 `settle-draft.test.mjs`；
- 真实回执：真实作品接受草案后定稿，读回 stage 与事件数。

### 非目标

- 不改 reopen；
- 不改 settle draft 生成；
- 不做旧作品迁移。

### 失败行为

- 无正文 → `body-not-found`；
- 无草案/未 ready → `state-not-ready`；
- 草案不是当前版本 → `state-not-ready`；
- 已定稿 → `chapter-settled`。

## Alternatives considered

**只靠 settle-draft 单测。** 最强理由是覆盖完整；能力验收还要真实回执，故补。

**允许重复定稿幂等。** 最强理由是方便重试；源/现有语义是拒绝，故不采用。

**把定稿并入结算。** 最强理由是少一步；结算只写草案，作者接受后定稿是闸门，故不合并。

## Acceptance criteria

1. ready 草案且绑定当前正文才定稿；
2. 定稿写 state 事件并锁 settled；
3. 草案删除；
4. 重复定稿拒绝；
5. consumer 与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：审计等价，实施只补真实回执与 consumer 确认。
- Spec：ready、绑定、事件、锁、重复拒绝都可观察。
- Architecture：定稿是 state 事务；结算草案与作者接受是前置。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 真实 fixture 需要先结算并接受草案；
- 事件数包含历史事件，回执要限定本章；
- 定稿后不能再改摘要/正文，需在回执前完成。
