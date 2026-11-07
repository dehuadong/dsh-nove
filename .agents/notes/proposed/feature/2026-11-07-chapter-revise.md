# Agent Note: 故事工坊：chapter.revise 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.revise`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计登记为保真债：

- 源模式是 `polish/rewrite/rework/anti-detect/spot-fix`；当前是 `patch/polish/rewrite/deslop`；
- 源 `spot-fix` 只替换选中的源码范围，保留范围外字节；当前 `patch` 按字数变化阈值校验，仍在重写整段；
- 源用 `lengthSpec` 校验修订后长度；当前用百分比门槛 + `countWords`；
- 能力行 consumer 指向 `revision-adopt.test.mjs`，未覆盖模式词表。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/reviser.ts:15-80` | 模式 polish/rewrite/rework/anti-detect/spot-fix；spot-fix 走范围编辑 | 复刻接受这些模式名，映射到现有内部实现 |
| `agents/reviser.ts:100-160` | spot-fix 只替换选中范围，范围外字节原样保留 | 范围替换本行先登记债，`spot-fix` 暂用 patch 行为 |
| `utils/text-range-edits.ts` | 范围编辑有独立契约与长度预算 | 后续行补；不在本行伪造范围编辑 |
| `utils/length-metrics.ts:52-65` | 显式 min/max 是硬校验；target 不硬卡 | 复刻修订后按 `wordRange` 硬校验，替换 countWords |

## Proposal

### 范围

- 模式词表：
  - 接受 `polish`、`rewrite`、`rework`、`anti-detect`、`spot-fix`；
  - 兼容当前 `patch`、`deslop` 作为别名（`patch`→`spot-fix`，`deslop`→`anti-detect`）；
  - `rework` 映射到 `rewrite` 的强度，但保留 `lastMode` 原值；
- 长度：
  - 用 `countChapterLength` 替代 `countWords`；
  - `wordRange` 显式 min/max 作为修订后硬校验；
  - 保留现有 patch/polish 百分比门槛作为临时约束（范围替换未实现前）；
- consumer 改为覆盖模式词表与长度的测试；
- 真实回执：一次 `anti-detect`/`rework` 修订。

### 非目标 / 保真债

- **spot-fix 范围编辑未实现**：当前仍整段重写；偿还路径：后续 `text-range-edits` 能力。审计表债保持“后续行”。
- 不引入 en_words/language。

### 失败行为

- 未知模式 → `revise-mode-violation`；
- 修订后超出 min/max → `chapter-length-out-of-range`；
- patch/polish 百分比越界仍 `revise-mode-violation`（临时代理）。

## Alternatives considered

**只加模式别名，不改长度。** 最强理由是低风险；源用 lengthSpec，故同时改计数与硬边界。

**立即实现范围替换。** 最强理由是完整；范围编辑是独立契约，塞进本行会混入两套测试，故登记后续债。

**把 rework 当独立模式。** 最强理由是保留语义；内部实现与 rewrite 相同，先映射并保留 lastMode。

## Acceptance criteria

1. 接受 source 模式词表与当前别名；
2. `anti-detect`/`deslop` 走同一去腔调校验；
3. `rework`/`rewrite` 可执行并记录 lastMode 原值；
4. 修订后按 countChapterLength 与 wordRange 硬校验；
5. spot-fix 范围替换债在审计表有后续归属；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先词表与长度，再范围替换；不伪造 spot-fix。
- Spec：模式、长度、lastMode、债务归属都可观察。
- Architecture：模式归一在 revision 层；范围编辑是独立后续能力。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 模式别名会改变 `story_delegate` 参数 enum 与测试 fixtures；
- 百分比门槛与 lengthSpec 可能同时触发，需要明确错误优先级；
- 真实回执需要可重复的修订，不依赖模型随机。
