# Agent Note: 故事工坊：context.brief 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `context.brief`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

`assembleBrief` 在 protected 段超预算时只标 `budget.overBudget`，继续返回 brief；源 `compileContext` 对 protected 溢出是硬失败。consumer 指向角色 context 测试，不是 brief。semantic compression 未实现。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/context-compiler.ts:113-135` | protected tokens 超预算抛 `ProtectedContextOverflowError` | 复刻 `assembleBrief` 抛 `brief-protected-overflow` |
| `context-compiler.ts:216-232` | fragment id 非空且唯一；重复抛错 | 复刻 section name 唯一，重复抛 `brief-section-duplicate` |
| `context-compiler.ts:175-210` | trace 记录 budget/protected/compressible/final tokens 与 source ids | 复刻 brief trace 记录 sections/budget/dropped |
| `context-compiler.ts:135-160` | compressible 超预算且无 semantic compiler 时抛错 | **保真债**：当前按 section 丢弃；偿还路径为 `context.compress`/brief compiler |

## Decision

- `assembleBrief`：
  - 计算 storyFrame/bookRules protected tokens；超过 limit 抛 `brief-protected-overflow`；
  - section name 唯一，重复抛 `brief-section-duplicate`；
  - 保留 compressible 按预算丢弃；
- consumer 从 `context.test.mjs` 改为 `bible.test.mjs`；
- 新增 protected overflow 测试；`foundation-consumers` 的 protected 溢出测试改为硬失败；
- 语义压缩登记为后续债，不伪称等价。

## Alternatives considered

- **只标 overBudget。** 最强理由是简单；源工程对 protected 溢出硬失败，故不采用。
- **把丢 section 当 semantic compiler。** 最强理由是已有产品行为；丢整段不等于压缩内容，故登记债。
- **继续用 context.test。** 最强理由是已有测试；它测角色 context，不是 brief，故改。

## Consequences

- **收益**：protected 溢出不再静默；section 重名可发现；consumer 与 brief 对齐；真实 brief 可回执。
- **代价**：调用方需处理 `brief-protected-overflow`；现有 protected-overflow 测试行为改变。
- **边界**：语义压缩未实现，审计表标为后续债；本行不声称完全等价。

## Verification

```text
node storycraft/tests/bible.test.mjs              # ALL CHECKS PASSED
node storycraft/tests/foundation-consumers.test.mjs # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e           # PASS: 102 unit files
npm run verify                                    # 15 verified / 25 missing
```

真实 fixture `示例短篇` chapter 1 brief：13 sections，budget 2600/89，trace 13。

回执：`artifacts/real-runs/context.brief.json`。
