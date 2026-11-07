# Agent Note: 故事工坊：context.retrieval 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `context.retrieval`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

检索已审计为等价，但能力行没有真实回执；consumer 指向纯函数测试，未覆盖 composer 的 retrieval section 与 trace。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/retrieval/local-search.ts:29-100` | 本地索引替换 scope，按 query 检索，返回 source/kind/score 命中 | 复刻 `searchMemory`（SQLite FTS + host lexical）带 source |
| `local-search.ts:97-145` | search 接收 query 与 options，返回稳定排序命中 | 复刻 `select()` 按 score/chapter/id 稳定排序 |
| 检索消费者 | 命中进入 role context 的 retrieval section，source 可追溯 | 复刻 `assembleRoleContext` 的 retrieval section 与 trace |

审计：`docs/fidelity-audit.md` 的 `context.retrieval` 判定等价，无债。

## Decision

- consumer 从 `retrieval.test.mjs` 改为 `context-retrieval.test.mjs`（集成）；
- `retrieval.test.mjs` 保留为纯函数补充；
- 不改检索引擎，不做语义/向量检索；
- 真实回执记录 query、sections、candidates 与 source 例子。

## Alternatives considered

- **只补真实回执。** 最强理由是审计已等价；consumer 仍是纯函数，不能证明 composer 集成，故改。
- **删纯函数测试。** 最强理由是集成已覆盖；纯函数边界更便宜，保留。
- **引入向量检索。** 最强理由是召回更好；源工程是本地 FTS/lexical，故不换。

## Consequences

- **收益**：composer 集成是主消费者；真实 trace 有 10 个候选、4 类来源；纯函数测试仍覆盖边界。
- **代价**：consumer 测试更重，但只跑集成路径。
- **边界**：不做语义检索；skill 检索仍由 host 注入。

## Verification

```text
node storycraft/tests/context-retrieval.test.mjs # ALL CHECKS PASSED
node storycraft/tests/retrieval.test.mjs        # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e         # PASS: 102 unit files
npm run verify                                  # 16 verified / 24 missing
```

真实 fixture `伏笔回执` chapter 4：sections 含 retrieval，10 个候选，来源含 skill、hook、book_rules、volume_map。

回执：`artifacts/real-runs/context.retrieval.json`。
