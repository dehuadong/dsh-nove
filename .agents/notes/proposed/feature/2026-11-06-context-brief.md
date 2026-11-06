# Agent Note: 故事工坊：context.brief 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `context.brief`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

`context.brief` 的审计行已登记为保真债：

- 源 `compileContext` 在 protected 片段超预算时抛错；当前只标 `budget.overBudget`，继续装配；
- 源按 fragment id 去重并拒绝重复 id；当前 section 名固定，但没有显式唯一性校验；
- 源在 compressible 超预算且无 compiler 时抛 `ContextCompilationRequiredError`；当前丢弃 section；
- 能力 consumer 指向 `context.test.mjs`（角色 context），不是 brief。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/context-compiler.ts:113-135` | protected tokens 超预算抛 `ProtectedContextOverflowError` | 复刻 `brief` 在 protected 段超预算时抛 `brief-protected-overflow` |
| `context-compiler.ts:216-232` | fragment id 非空且唯一；重复 id 抛错 | 复刻 section name 必须唯一，重复抛 `brief-section-duplicate` |
| `context-compiler.ts:135-160` | compressible 超预算且无 semantic compiler 时抛 `ContextCompilationRequiredError` | 当前按 section 丢弃；作为保真债登记，偿还路径见下 |
| `context-compiler.ts:175-210` | trace 记录 budget/protected/compressible/final tokens 与 source ids | 复刻 `BriefTrace` 记录 tokenBudget/budget/sections/dropped |

## Proposal

### 范围

- `assembleBrief`：
  - 计算 protected 段（storyFrame/bookRules）token；超 limit 抛 `brief-protected-overflow`；
  - section name 唯一性校验，重复抛 `brief-section-duplicate`；
  - 保留按预算丢弃 compressible 的现有行为；
- 能力行 consumer 改为真正测 brief 的 `tests/bible.test.mjs`；
- 消费者测试补 protected overflow 与重复 section；
- 真实回执：真实作品 chapter brief，记录 budget/trace。

### 非目标 / 保真债

- **语义压缩未实现**：源在 compressible 超预算时用 semantic compiler 压缩；当前直接丢 section。偿还路径：后续 `context.compress` 能力或 brief 内 compiler；在审计表登记为“后续行”，不在本行伪称等价。
- 不改变 section 顺序与 protected 名单。

### 失败行为

- protected 超预算 → `brief-protected-overflow`；
- section 重名 → `brief-section-duplicate`；
- 预算非法仍回退默认 budgets（现有行为）。

## Alternatives considered

**继续只标 overBudget。** 最强理由是简单；源工程对 protected 溢出是硬失败，故不采用。

**把 compressible 丢弃当 semantic compiler。** 最强理由是已有产品行为；丢弃整段与压缩内容不等价，故登记为债而非等价。

**consumer 继续用 context.test。** 最强理由是已有测试；它测的是角色 context，不是 brief，故改。

## Acceptance criteria

1. protected 超预算抛 `brief-protected-overflow`；
2. section 重名抛 `brief-section-duplicate`；
3. brief 的 trace/budget/dropped 与 section 一致；
4. consumer 指向 brief 测试并通过；
5. 语义压缩债在审计表有“后续行”归属；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先补硬失败与唯一性，不把丢 section 冒充压缩；债登记。
- Spec：protected overflow、重名、trace、债归属都可观察。
- Architecture：brief 是 context 装配层；semantic compiler 是后续能力，不塞进本行。
- 结论：通过，进入实施需 implement 授权。

## Risks

- protected 溢出抛错会改变现有“总是返回 brief”的行为，调用方需要结构化错误；
- `bible.test` 现有 brief 预算测试依赖丢弃行为，需区分 compressible 与 protected；
- 真实回执需要真实作品 brief，不能只用 fixture。
