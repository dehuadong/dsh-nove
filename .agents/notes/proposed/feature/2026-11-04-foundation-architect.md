# Agent Note: 故事工坊：foundation.architect 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `foundation.architect`（[账本行](../../../../capabilities.yaml)）。账本行承载能力映射与状态；本 Note 承载范围、验收、证据与评审。

## Problem

`foundation.architect` 仍是 `missing`。现有 architect 已能由同一个子代理按 `outline → details → cast_index → cards` 四段提交基础设定，但没有一份当前基线的能力证据：不知道四段是否仍由一个 child 完成、每段是否按 schema 拒绝错误字段、失败时是否留下半套基础设定。

本项只锁定 foundation 的生产契约，不覆盖初始伏笔语义（`foundation.hooks`）与作者确认（`foundation.approval`）。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/architect.ts:269-332` | 同一 architect 内四段顺序提交，分别使用 outline/details/cast_index/cast_documents 工具 | 采纳“单 child 四段”；我们用一个 `story_submit` 带 `phase`，每 phase 独立 schema |
| `inkos-master/packages/core/src/agents/architect-tool.ts` | 每段字段形状由工具 schema 校验 | 等价适配：`validateArchitect` 按 phase 校验必填、拒收多余字段 |
| 本项目 `storycraft/tests/foundation-production.test.mjs` | 已验证一次派发四段落库与 bundle 完整 | 作为本能力的消费者测试 |

## Proposal

### 范围

验证现有实现：

- `storycraft/src/roles/architect/agent.ts`（单 child 派发）；
- `storycraft/src/roles/architect/contract.ts`（`FOUNDATION_PHASES` 顺序）；
- `storycraft/src/roles/architect/tool-schema.ts`（每 phase 校验）；
- `storycraft/src/roles/architect/prompts.ts`（四段提示与参考注入）。

不新增 phase、不改字段合同、不实现 hooks/approval/cast 消费者。

### 行为

1. `story_delegate(role: architect, stage: foundation)` 只启动一个 architect child；
2. child 必须按 `outline`、`details`、`cast_index`、`cards` 顺序提交，四段都落库后 bundle 才算完成；
3. 每 phase 只接受自己的字段：缺字段、额外字段、错误 phase 都返回可重试错误，不落半套；
4. 四段全部成功后，`readFoundationState(...).complete === true`，产物包含 storyFrame、volumeMap、bookRules、pendingHooks、rolesIndex、role cards。

### 非目标

- 不验证初始伏笔的五态/幂等（`foundation.hooks`）；
- 不验证作者确认闸门（`foundation.approval`）；
- 不验证 roles 进入 brief/context（`cast.single-authority`）；
- 不做 skill guidance 的新机制，沿用现有 architect 参考注入。

### 真实证据

`artifacts/real-runs/foundation.architect.json`：

```json
{
  "date": "YYYY-MM-DD",
  "sessionId": "session-...",
  "tests": { "passed": true },
  "receipts": [
    { "kind": "delegate", "role": "architect", "stage": "foundation", "ok": true, "durationMs": 0 },
    { "kind": "foundation-state", "complete": true, "artifacts": 0 },
    { "kind": "consumer-test", "path": "storycraft/tests/foundation-production.test.mjs", "ok": true }
  ]
}
```

真实会话优先取当前实现的一次 `story_delegate(architect, foundation)`；没有新会话时，允许引用既有真实回执，但必须在 Note 中写明日期与版本差异。

### 验证命令

```text
node storycraft/tests/foundation-production.test.mjs
node storycraft/tests/foundation-hooks.test.mjs
npm run check-capabilities -- --write
npm run verify
```

## Alternatives considered

**把 foundation.architect 与 foundation.hooks/approval 合成一个能力。** 最强理由是它们在同一次派发里完成；但账本按消费者拆分，合成会让失败无法定位到具体合同，故不采用。

**先改四段 schema 再验收。** 最强理由是能顺手收紧字段；但本项是能力证据，不是合同变更；改 schema 会让旧回执失效，故不采用。

**只跑单测，不取真实会话。** 最强理由是单测已覆盖四段落库；但单测不证明真实模型能在一次派发里跑完四段，故不采用。

## Acceptance criteria

1. 一次 `story_delegate(architect, foundation)` 只激活一个 child；
2. 四段按 `outline → details → cast_index → cards` 落库，顺序错误被拒绝；
3. 每 phase 的缺字段、额外字段、未知 phase 都返回错误，且不留下半套 foundation；
4. 四段完成后 `readFoundationState(...).complete === true`；
5. `foundation-production` 消费者测试通过；
6. `artifacts/real-runs/foundation.architect.json` 满足格式，`check-capabilities -- --write` 后该能力为 `verified`，`npm run verify` 通过。

## Plan Review

- Standards：账本承载状态，本 Note 承载工作项；不新增状态表。
- Spec：范围、非目标、失败行为与证据判定明确；hooks/approval/cast 被排除。
- Architecture：四段仍由同一 child 提交，schema 与 contract 已在现有模块内，无新增依赖。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 既有真实回执来自 2026-11-03，若架构提示或 schema 已变化，需重跑；不重跑则保持 `missing`；
- 单 child 四段依赖子代理遵守提示；失败重试预算已由现有 submission 逻辑控制，本项不新增；
- 真实会话的 `durationMs` 可能很长，回执只记录事实，不设时限。
