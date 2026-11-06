# Agent Note: 故事工坊：context.retrieval 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `context.retrieval`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

检索要按任务/章纲/伏笔/指令组成查询，按 scope/kind 过滤，命中带 source 标注，按分数与章号稳定排序，并进入 role context 的 retrieval section。当前审计判定等价，但能力行没有真实回执；consumer 指向纯函数 `retrieval.test.mjs`，没有覆盖 composer 集成。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/retrieval/local-search.ts:29-100` | 本地索引替换 scope，按 query 检索，返回 source/kind/score 命中 | 复刻 `searchMemory`/SQLite FTS + host lexical，命中带 source |
| `local-search.ts:97-145` | search 接收 query 与 options，返回稳定排序命中 | 复刻 `select()` 按 score/chapter/id 稳定排序 |
| 检索消费者 | 命中进入 role context 的 retrieval section，source 标注可追溯 | 复刻 `assembleRoleContext` 的 retrieval section 与 trace |

审计：`docs/fidelity-audit.md` 的 `context.retrieval` 行已判定等价，无债。

## Proposal

### 范围

- 验证实现已覆盖：
  - `buildQuery`：任务/章纲/伏笔/指令，指令 clip 600；
  - `snippetFor`：强 token 锚点、code point 预算；
  - `select`：score/chapter 稳定排序、per-kind、预算、excludeIds；
  - `searchMemory`：scope/kind 过滤、source 标注、stale summary 过滤；
  - composer：retrieval section 位置、trace candidates、skill source 不进 section sourceIds。
- 能力 consumer 改为 `tests/context-retrieval.test.mjs`（集成），纯函数测试保留在 `retrieval.test.mjs` 作为补充；
- 真实回执：真实作品（至少 3 章）检索，记录 query、candidates、sent hit source。

### 非目标

- 不换检索引擎；
- 不做语义向量检索；
- 不改 skill 检索的 host 注入。

### 失败行为

- 检索服务失败时 fail-open，trace 记录错误码，不阻断上下文；
- 无命中时 retrieval section 不出现；
- stale summary（bodyRevision 不匹配）不进入命中。

## Alternatives considered

**只补真实回执。** 最强理由是审计已等价；consumer 仍是纯函数，不能证明 composer 集成，故改 consumer。

**把纯函数测试删掉。** 最强理由是集成已覆盖；纯函数边界更便宜，保留。

**引入向量检索。** 最强理由是召回更好；源工程是本地 FTS/lexical，故不换。

## Acceptance criteria

1. query 由任务/章纲/伏笔/指令组成，指令 clip；
2. scope/kind 过滤与 source 标注生效；
3. 命中按 score/chapter 稳定排序；
4. stale summary 不进入命中；
5. composer retrieval section 位置、trace、sourceIds 正确；
6. consumer 与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：审计已等价，实施只补 consumer 与回执，不改引擎。
- Spec：query、过滤、排序、stale、composer 集成都可观察。
- Architecture：检索是纯选择 + storage search；composer 是消费者。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 真实作品检索需要至少 3 章，fixture 可能不足；
- `retrieval.test` 与 `context-retrieval.test` 有重叠，consumer 只选集成测试；
- skill 命中与 material 命中来源不同，回执需区分。
