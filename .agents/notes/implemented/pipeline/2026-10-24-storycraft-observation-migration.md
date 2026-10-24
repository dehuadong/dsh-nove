---
title: 故事工坊：L-R10a observation/reviews 收口
status: implemented
created: 2026-10-24
updated: 2026-10-24
verification: observation/review 生命周期已落地，真实审稿轮次产生 resolved/issue 证据；证据见 #52。
---

# Agent Note：故事工坊：L-R10a observation/reviews 收口

## 问题

审稿事实现在有两套：`reviews` 表存文本，`review:<n>:r<bodyRev>:<round>` artifact 只在测试和 `readChapterObservations` 里用；阶段机、定稿门禁、reviser、`status`、`readChapter(view:'review')`、面板与导出仍读 `reviews` 文本和 `[x]` 标记。结果是：

- 审稿的“已解决”只存在文本勾选里，reviser 无法按 ID 处理，settle/nextStep 也无法判断哪条还开着；
- artifact 合同里的 Observation 没有稳定 `id`，`assessment` 语义也没有消费者；
- `reviews` 表与 observation artifact 双写/双读，迟早不一致。

`#52` 要把审稿事实收敛为一份：observation artifact；`reviews` 表直接删除（没有旧作品，不需要保留历史表、迁移或兼容读取）；阶段机、门禁、reviser、读取、面板、导出都读同一份。

## 对拍参考

- `inkos-master/packages/core/src/agents/reviewer-tool.ts` 与 `reviser-tool.ts`：审稿产出带 `code/summary/evidence/severity/fix/mode` 的观察项，修订按条目处理；条目状态由后续审稿/结算读取。
- `inkos-master/packages/core/src/pipeline/runner.ts`：审稿轮次与正文 revision 绑定，定稿前要求当前 revision 的审稿干净。
- `inkos-master/packages/core/src/agents/settler-tool.ts`：settler 读取审稿结果作为证据，不自己重审。
- 我们的裁决：**采纳**“审稿=观察项集合、按 ID 处理、当前 revision 干净才定稿”；**等价适配**为 `review:<n>:r<bodyRev>:<round>` artifact + `assessment/resolves`；**不采纳**继续保留 `reviews` 文本表或 `[x]` 标记。

## 与既有记录

- artifact 身份与字段由 [`2026-10-23-storycraft-artifact-contract-v2.md`](2026-10-23-storycraft-artifact-contract-v2.md) §4 拥有；本项在实施时**增补** Observation 的 `id`/`resolves` 与 `assessment` 语义，并更新该 Note 的 §4。
- 切片排期由 [`2026-10-24-storycraft-consumer-migration.md`](2026-10-24-storycraft-consumer-migration.md) 拥有；本项是其中 #52（延期切片）。
- 委派/提交由 [`2026-10-20-storycraft-host-delegation.md`](2026-10-20-storycraft-host-delegation.md) 拥有；本项改 reviewer/reviser 的提交与门禁，不新增角色。
- S2 summary、S3 state、S4a/S4b/S4c 的读取面不改；本项只把审稿事实从 `reviews` 表切到 observation artifact。

## 决定

### 1. Observation 合同增补

```json
{
  "id": "O1",
  "code": "string?",
  "summary": "string",
  "evidence": ["string"],
  "category": "execution|quality|scope",
  "assessment": "issue|resolved|unavailable|observation",
  "resolves": "O1?",
  "scope": "string?",
  "target": { "workId": "string", "artifactId": "string", "revisionId": "string" }?,
  "sourceRefs": [{ "sourceId": "string", "quote": "string" }],
  "severity": "blocking|major|minor?",
  "fix": "string?",
  "mode": "patch|polish|rewrite|deslop?"
}
```

- **`id` 必填**，格式 `O<正整数>`，在一份 review artifact 内唯一；reviewer 按出现顺序编号，reviser 按 ID 引用。跨轮次不保证同一 ID；需要引用上一轮时用 `resolves` 指向上一轮 observation 的 id（仅在同一轮的“resolved”条目里使用）。
- `code` 是可选的机器代码（如 `fact-unsupported`），不再兼任 ID；现有把 `code` 当 ID 的读取路径改读 `id`。
- `assessment`：`issue` 阻断定稿；`resolved/unavailable/observation` 不阻断。`resolved` 必须带 `resolves` 指向上轮的 `issue`。
- `sourceRefs` 至少一条；`quote` 必须逐字出现在正文（或本章章纲）里，沿用现有 `verifyObservationSources`。

### 2. review artifact 与轮次

- 内容固定为 `{ "observations": [Observation...] }`；空数组表示**清稿审稿**（允许定稿）。
- ID 仍为 `review:<n>:r<bodyRev>:<round>`，round 从 1 递增；round = 本章已有 review artifact 数 + 1。
- reviewer 提交的 payload 改为观察项数组（含 quote），宿主补 `id`/`target`/`sourceRefs` 后写入；`reviews` 表不再写。
- `reviews` 表从 schema 删除；没有旧作品，不保留历史表、不做迁移。

### 3. 解决与定稿门禁

- reviser 仍只改正文；提交可带 `resolved: ["O1"...]`（对当前 review artifact 的 `issue` 条目）。宿主只校验 ID 存在，**不因自报 resolved 就放行定稿**。
- 定稿门禁：最新章节必须有一份 review artifact 覆盖 **当前正文 revision**，且其中没有 `assessment:"issue"`；`resolved` 由**下一次审稿**产出（reviewer 对上一轮条目给 `assessment:"resolved"` + `resolves`）。
- 因此修订后需再跑一次审稿；清稿审稿（空 observation）直接放行。`nextStep` 用同一规则给出 `story_review`/`story_revise`/`story_settle`。
- `assertStateGate`、`status`、`readWork`、`settleChapterState` 的审稿判断全部改读 artifact，不再看 `reviews.text` 或 `[x]`。

### 4. 读取、面板与导出

- `latestReview` 改为“最新章节的 review artifact（含 revision/round/content）”；`readChapter(view:'review')`、`story_read(review:...)`、面板审稿区渲染 observation（ID/严重度/评估/证据/修法）。
- 导出把每轮 review artifact 渲染为 `reviews/ch-xxxx.rN.md`（JSON 观察项 + 可读 Markdown 列表），不再从 `reviews` 表读。
- `role-input`：reviewer 读当前正文与（可选）上一轮 review 以便写 resolved；reviser 读当前 review 的 `issue` 条目，没有 issue 时拒绝（保持现有 `review-required`）。

### 5. 边界

- 不新增角色/动作；`story_review` 仍是手动入口，reviewer 委派仍走 `story_delegate`。
- 不改 settle 的 state 投影与 validator；只换审稿证据来源。
- 没有旧作品：不做迁移；`reviews` 表随本项删除，不保留兼容读取。
- 短篇/剧本审稿仍走同一 observation 合同，不另立格式。

## 备选方案

- **保留 reviews 表并加 ID 列**：双权威继续存在，阶段机仍可能读旧文本；否决。
- **reviser 自报 resolved 即放行**：等于让被审者自己结案；否决，改为下一轮审稿确认。
- **每轮 review 用可编辑 revision 覆盖**：review 是历史证据，覆盖会丢失“上一轮说了什么”；否决，追加新轮次。
- **保留旧 reviews 表或迁移文本勾选**：没有旧作品，保留历史表只会留下双权威与误读路径；否决。

## 后果

该设计已按决定落地；生产与消费路径已切换，旧路径不再写入，未保留旧作品迁移或兼容层。

## 验证

1. Observation 合同含必填 `id` 与 `resolves`；review artifact 内容 `{observations}`；`id` 在 artifact 内唯一，`code` 不再当 ID。
2. reviewer 委派/`story_review` 写 observation artifact，`reviews` 表不再写；非法 quote/缺 id 被拒。
3. reviser 读当前 review 的 `issue` 条目并可按 ID 提交 `resolved`；无 issue 时拒绝。
4. `nextStep`/`status`/`readWork`/settle 门禁只读 artifact：当前 revision 的 review 无 `issue` 才可定稿；清稿审稿（空）可定稿；修订后必须重审。
5. `readChapter(view:'review')`、`story_read`、面板、导出都从 artifact 渲染；`reviews` 表无读写。
6. 没有旧作品：`reviews` 表随 schema 删除，不保留历史表；测试作品全新创建。
7. 测试：`observation-consumers.test.mjs` 覆盖 id/assessment/resolves、review→reviser→re-review→settle、清稿、门禁、读取/导出/面板；更新 reviewer/reviser/阶段机/工具/导出测试；`node storycraft/scripts/ci.mjs --no-e2e` 通过。
8. 合同 Note §4 与本 Note 同步；不新增角色/动作；不改 state/summary/memo 合同。

## 风险

- 审稿 payload 从 `{items:[{where,...}]}` 改为带 `quote` 的观察项，reviewer 技能与测试都要同步；prompt 过松会频繁 `observation-source-unverified`。
- 修订后必须重审会增加一轮；作者可能觉得慢，但这是“证据在审稿方”的代价。
- 删除 `reviews` 表需要一次 schema 变更；没有旧作品，直接改 schema，不做迁移分支。
- resolved 语义若被误用为“跳过重审”，门禁会退化；必须只认当前 revision 的 review artifact。
