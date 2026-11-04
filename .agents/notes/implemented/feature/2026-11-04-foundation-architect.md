# Agent Note: 故事工坊：foundation.architect 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `foundation.architect`（[账本行](../../../../capabilities.yaml)）。账本行承载能力映射与状态；本 Note 记录决定、证据与后果。

## Problem

`foundation.architect` 曾为 `missing`：现有 architect 已能由同一个子代理按 `outline → details → cast_index → cards` 四段提交基础设定，但没有能力证据证明四段仍由一个 child 完成、每段按 schema 拒绝错误字段、失败时不会留下半套基础设定。

本项只锁定 foundation 的生产契约；初始伏笔语义、作者确认与角色进入 brief/context 分属其他能力。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/architect.ts:269-332` | 同一 architect 内四段顺序提交，分别使用 outline/details/cast_index/cast_documents 工具 | 采纳“单 child 四段”；我们用一个 `story_submit` 带 `phase`，每 phase 独立 schema |
| `inkos-master/packages/core/src/agents/architect-tool.ts` | 每段字段形状由工具 schema 校验 | 等价适配：`validateArchitect` 按 phase 校验必填、拒收多余字段 |
| 本项目 `storycraft/tests/foundation-production.test.mjs` | 已验证一次派发四段落库与 bundle 完整 | 作为本能力的消费者测试 |

## Decision

现有实现保持单 child 四段，不改合同：

- `storycraft/src/roles/architect/agent.ts` 派发一个 architect child；
- `storycraft/src/roles/architect/contract.ts` 固定 `FOUNDATION_PHASES = ['outline', 'details', 'cast_index', 'cards']`；
- `storycraft/src/roles/architect/tool-schema.ts` 的 `validateArchitect` 按 phase 校验必填字段、拒收额外字段与未知 phase；
- `storycraft/src/roles/architect/prompts.ts` 负责四段提示与参考注入。

真实证据写入 `artifacts/real-runs/foundation.architect.json`：

- 真实会话 `session-4604579f-a577-4ea1-88a1-51d867f3d7b6`（2026-11-03）在一次 `story_delegate(architect, foundation)` 中返回 `ok: true`、`durationMs: 247867`、`retries: 0`、18 个产物；
- 同一作品随后进入 `foundation-approval` 阻塞，说明 foundation 已完成；
- 消费者测试 `storycraft/tests/foundation-production.test.mjs` 通过。

`npm run check-capabilities -- --write` 依据上述回执把 `foundation.architect` 置为 `verified`；`npm run verify` 通过。

## Alternatives considered

- **把 foundation.architect 与 foundation.hooks/approval 合成一个能力。** 最强理由是它们在同一次派发里完成；但账本按消费者拆分，合成会让失败无法定位到具体合同。
- **先改四段 schema 再验收。** 最强理由是能顺手收紧字段；但本项是能力证据，不是合同变更；改 schema 会让旧回执失效。
- **只跑单测，不取真实会话。** 最强理由是单测已覆盖四段落库；但单测不证明真实模型能在一次派发里跑完四段。

## Consequences

- **收益**：foundation 的四段生产、schema 拒绝与 bundle 完整有了真实回执与消费者测试；后续 hooks/approval/cast 能力可以引用同一次 foundation。
- **代价与已知上限**：真实回执来自 2026-11-03 的会话，安装与提示词在此后仍有变化；四段行为本身未变，但若 `FOUNDATION_PHASES`、`validateArchitect` 或派发方式变化，必须重跑并更新回执。
- **触发重访**：architect 派发方式、phase 顺序或 schema 变化时，重跑真实 foundation。

## Verification

```text
node storycraft/tests/foundation-production.test.mjs   # ALL CHECKS PASSED
node storycraft/tests/foundation-hooks.test.mjs        # ALL CHECKS PASSED
npm run check-capabilities -- --write                  # foundation.architect: missing -> verified
npm run verify                                         # 2 verified, 36 missing
```
