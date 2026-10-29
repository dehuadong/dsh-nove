---
title: 故事工坊：角色模型对齐参考
status: implemented
created: 2026-10-29
updated: 2026-10-29
verification: 真实链路（四阶段 foundation、minor 卡清理、story_read 删除）通过；CI 79 单元 + 27 E2E。
---

# Agent Note：故事工坊：角色模型对齐参考

> 承接工作项 #83；本设计取代 #81 的两条前提：minor 卡也要清理（不再是“只清 major”）、cards 不再允许部分提交（改为 1:1 覆盖）。#81 的其余行为（按 name 清理、删全部 revision、同事务删检索文档、物理删除、`artifact-not-found`）不变。产品行为与验收归工作项；本 Note 拥有技术设计与实现边界。
> 关联：[parity-matrix 角色卡行 & 运行时整改](../../proposed/pipeline/2026-10-18-storycraft-parity-matrix.md)、[foundation 生产](2026-10-24-storycraft-foundation-production.md)（其角色上限条目由本 Note 取代）。

## 问题

当前角色模型是 `roles:index` 六字段小传（name/tier/role/want/fear/limit/voice）+ 另一套 `role_card` 字段，并硬限制 `≤20 人`、`≤12 卡`、卡只能是 major。参考实现不是这样：索引只登记姓名与层级，卡承载内容；`major`/`minor` 都能建卡，一人一卡，没有数量上限。

上限不是参考行为，是为了压住“六字段索引 + 卡重复内容”造成的 payload 而加的补丁。它挡住了作者登记更多人物，也把 minor 角色卡静默裁掉。

## 对拍参考

| 参考行为 | 参考位置 |
| --- | --- |
| 索引只有 `name` + `tier`，`minItems: 1`，无上限 | `inkos-master/packages/core/src/agents/architect-tool.ts:36-41` |
| 只为“影响开篇冲突的具名人物”生成索引与卡；卡 150–250 字，写动机/已知/关系压力/边界 | `.../agents/architect.ts:318-336` |
| 一人一卡，`major`/`minor` 两档；空卡报错；全量读取 | `.../utils/outline-paths.ts:60-127` |
| 角色上下文由卡渲染，major/minor 分组 | `.../utils/outline-paths.ts:106-127`、`.../forecast/context-builder.ts:59-62` |
| 无 20/12 一类上限 | 检索 `inkos-master/packages` 无对应上限 |

## 偏差行（参考 / 我们 / 原因 / 裁决 / 验证）

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 索引 `{name,tier}` | 同 | — | 采纳 | 合同测试：薄索引通过，多余字段拒绝 |
| 卡一人一 `.md`，按 major/minor 目录存放 | 卡为 `role:<slug>` artifact（结构化字段 + `markdown`） | 产物需注册、检索、生命周期与导出 | 等价适配 | `story_read role:<slug>`、导出、上下文渲染 |
| 卡只有 Markdown 文本 | 四要素字段 + `markdown` 并存 | writer/上下文需要机器可读字段；`markdown` 供阅读 | 等价适配 | 卡渲染包含动机/已知/关系压力/边界 |
| TypeBox 未禁额外属性 | 索引/卡拒绝多余字段 | 持久合同不接受脏字段 | 保留更严 | 多余字段测试返回 `artifact-invalid` |
| 索引无 `voice` | 索引删除 `voice`，上下文不再有“语气”行 | 按参考对齐；语气可由卡文本承载 | 采纳（行为变化） | `context` 测试：主角行只有姓名与边界 |
| 只为开篇冲突的具名人物建卡，一人一卡 | 同；cards 阶段要求索引全覆盖 | 参考由 cast schema 逐人生成 | 采纳 | 30 人/30 卡通过；30 人/13 卡被拒 |

## 现状（代码位置）

- `roles:index` 六字段：`artifact-contract.ts:242-254`；`role_card`：`:259-268`；
- 派发层上限（先于 store-db）：`submission.ts:206-212`；
- foundation 提交上限与 major 限制：`store-db.ts:1254`、`:1259`、`:1264-1280`；重跑只清 major 卡：`store-db.ts:1296-1300` + `artifact-store.ts:319-350`（`:342` 按 major 跳过）；
- 基础完整判定只看“有卡”：`store-db.ts:1098`；
- 消费仍读六字段：`context.ts:309-312`、`:360-373`、`:472-480`；`bible.ts:481-491`；
- 三形态共用读取点：`context.ts`/`bible.ts` 也被短篇/剧本用；`facts.ts:140-156`、`state-check.ts:277`、`state-settle.ts:392` 仍读 `bible.characters`（本次不改）；
- architect 提交提示：`delegate.ts:569-575`；技能：`skills/storycraft-architect/SKILL.md:41-52`（:41 上限、:42 索引、:50-52 卡）；
- 测试夹具/断言：`artifact-contract.test.mjs:93-100`、`foundation-production.test.mjs:125-128`（minor 拒收断言反转）、`acceptance-multichapter.test.mjs:262-269`、`bible-artifacts.test.mjs:102`、`foundation-orphan.test.mjs:26/:64-89`、`foundation-consumers.test.mjs:25-28/:77-78/:112/:130-131`（:130 用 want 文本检索索引，需改）、`foundation-chapter-artifacts.test.mjs:51-54`、`story-read-role.test.mjs:72`、`context.test.mjs:114`（“语气”断言）；README:113；`submission.ts` 的 12/20 上限删除后补一条 30/30 派发测试。

## 决定

### 数据合同

`roles:index` 内容收紧为：

```json
{ "roles": [ { "name": "甲", "tier": "major" } ] }
```

- `roles` **≥1**（显式 `min: 1`）；`name` 非空且唯一；`tier` 只允许 `major`/`minor`；**无数量上限**；多余字段拒绝。

`role_card` 保持现有字段（`slug/name/tier/motivation/knowledge/relationshipPressure/limits/arc/markdown`）：

- `tier` 允许 `major`/`minor`，且**必须等于索引里该姓名的 tier**；
- `name` 必须来自当前索引；`slug` 稳定、禁空白/冒号/斜杠/`.`/`..`；名字与 slug 唯一；**无数量上限**。

**覆盖规则（1:1）**：cards 阶段必须为索引里的每个姓名各提交一张卡；缺卡、额外卡、tier 不一致都拒绝。这是参考由 cast schema 逐人生成的等价合同，也解决“索引有人、上下文无卡”的空洞。

**tier 单一权威**：卡 `tier` 必须等于索引里该姓名的 tier；roles 重跑时，姓名保留但 tier 改变的卡视为过期并删除，不能留下旧层级。

**卡身份**：角色以 `name` 为身份，`slug` 只是存储键（索引没有 slug）。cards 提交时按姓名整体替换：同名旧卡（不论旧 slug）在同一事务里删除后再写新卡；若新 slug 已被**另一个姓名**占用则拒绝。这样模型换 slug 不会留下两张卡，重跑也不会出现同一人两卡。名字改了就视为新人物：旧卡随 roles 重跑清理。

不新增 artifact kind，不改 SQLite schema（内容合同变化，旧测试作品删除重建，不做迁移）。

### 生成

- roles 阶段：只列“影响开篇冲突的具名人物”，提交 `name` + `tier`；
- cards 阶段：为索引里的每个人写卡（major/minor 都可），每卡约 150–250 字，写当下动机、已知信息、关系压力、能力边界；不重复整篇情节；不把无名岗位群体扩写成人物；
- **方法归属**：150–250 字与四要素写法移入 `skills/storycraft-long-foundation/references/foundation-design.md`；`storycraft-architect` 只留 payload、闸门与失败回退，不复制方法正文。
- **完成与批准**：`foundationStateOf` 的 cards 完成判定改为“索引每个姓名都有卡且 tier 一致、无同名重复”；`approveFoundation` 只允许 `complete` 的作品，缺卡/旧 tier 的 foundation 不能批准。

### 消费迁移

| 消费点 | 现在 | 改成 |
| --- | --- | --- |
| 形态范围 | `context`/`bible` 为长篇/短篇/剧本共用 | **仅长篇且存在 `role_card` 时读卡**；短篇、剧本与手动作品回退 `bible.characters`（六字段读法不变） |
| `context.ts` 角色段 / 主角约束 / planner 人物节选 | 索引六字段 | 读卡：`name`/`tier` + 动机/已知/关系压力/边界；**不渲染 `role`**（卡无此字段）；planner 取章纲点名角色，未点名按索引序取前 6；渲染 `markdown`（每人 ≤300 字） |
| `bible.ts` 人物段 | 索引六字段 | 长篇且有卡时读卡，按章纲点名过滤；无点名取全部；否则回退 `bible.characters` |
| `delegate.ts` architect 提交提示 | 六字段 + 上限 | 薄索引 + 两档卡 + 开篇范围 |
| `submission.ts` | `≤12`、`≤20` | 删除数量上限；roles ≥1；cards 非空 |
| `store-db.ts` foundation 提交 | 20/12/major-only/卡数≤major | 只校验索引一致性、卡覆盖（1:1）与唯一性 |
| `store-db.ts` roles 重跑清理 | 只清 major | 清索引中已不存在或 tier 变更的全部卡（含 minor）；移除 `keep.size > 0` 守卫与 `artifact-store.ts:342` 的 major 跳过 |
| `artifact-store.ts` `majorNamesOf` | major 名单 | 索引全量名单 `indexNamesOf` |
| `foundationStateOf` cards 完成判定 | 有任意卡 | 索引每个姓名都有卡 |

**行为变化（有意）**：索引不再有 `role/want/fear/limit/voice`；卡没有 `role` 字段，**长篇有卡路径**的 `context`/`bible` 不再生成“定位/语气”行，角色段为 `name(tier) + 动机/已知/关系压力/边界`。`bible.characters` 仍是短篇、剧本与无 foundation 卡作品的回退，读法保持现状（含 `role/voice`），避免跨形态回归；长篇有卡时不读索引六字段。

**来源（section source）**：卡片段来源统一为 `foundation/roles`（虚拟目录）；单卡来源仍由 `story_read role:<slug>` 的 artifact 路径给出。相关消费测试的 `source` 断言同步更新。

**类型与回退**：`CharacterCard`/`CharacterRecord` 的六字段类型只服务 `bible.characters` 回退（短篇/剧本/无卡作品）；长篇卡读取走新的 card 类型，不复用六字段类型；`parseCharacters` 保持现状。

### 生命周期

- roles 重跑：写新索引后，删除名字不在新索引里、或 tier 与新索引不一致的卡（含 minor）；名字与 tier 都未变的卡保留；
- cards 重跑：按 1:1 覆盖校验后，为每个姓名追加新 revision；
- foundation 重跑清 `foundation.approvedAt` 的现有行为不变；
- `story_read role:<slug>`、导出、备份按 artifact 读取，ID 规则不变。

## 备选方案

- **A. 只删 20/12 两条校验**：索引仍是六字段、minor 仍无卡、消费仍读索引 → 半对齐。**不采用**。
- **B. 六字段搬到卡上，索引保留六字段**：与参考薄索引不一致，且重复内容。**不采用**。
- **C. 薄索引 + 一人一卡 1:1 + major/minor + 去上限 + 消费迁移（本设计）**。**采用**。

## 后果

角色模型与参考结构一致：索引薄化为 name+tier，一人一卡 1:1，major/minor 均可，数量上限全部移除；消费端读卡并保留短篇/剧本回退；后续实现不再需要旧六字段索引或迁移。

## 风险

- 上下文角色段内容变化（六字段 → 卡文本，voice 行消失），writer/reviewer 提示与测试会变；
- 参考把全部卡注入上下文，角色多时预算压力回到装配层：保留现有选取，不恢复登记上限；
- 1:1 要求 cards 阶段一次覆盖全部索引；后续加人物需重跑 roles + cards；
- 测试夹具分布广（foundation/delegate/context/bible/acceptance/orphan/consumers/story-read-role/chapter-artifacts），需要成组更新；
- `context`/`bible` 为三形态共用：若只在有卡时切读卡、忘记回退，短篇/剧本 writer 会触发 `bible-missing`；
- 面板基础设定预览与 `story_read role:` 需回归（client.ts 未直接读 rolesIndex，实现时确认）。

## 验证

- **AC1**：索引只接受 `name`+`tier`；≥1；姓名唯一；无数量上限；多余字段拒绝。
- **AC2**：卡接受 `major`/`minor`；来自索引且 tier 一致；以 name 为身份，同名旧卡（含旧 slug）整体替换，slug 被其他姓名占用时拒绝；名字/slug 唯一；无数量上限。
- **AC3**：cards 阶段 1:1 覆盖：30 人 + 30 卡（含 minor）通过；30 人 + 13 卡、额外卡、tier 不一致被拒。
- **AC4**：roles 重跑删除已移除人物、或 tier 已变更的卡（含 minor）；cards 完成判定要求“索引每个姓名都有卡、tier 一致、无同名重复”，缺卡/旧 tier 不能批准；`foundation-orphan` 断言反转。
- **AC5**：长篇有卡时 `context`/`bible` 不再读索引六字段，角色内容来自卡（不渲染 `role`）；planner 选取规则、主角约束（姓名 + 边界）、`source=foundation/roles` 有测试；短篇/剧本/无卡作品仍走 `bible.characters`，不回归。
- **AC6**：architect 技能只保留 payload/闸门/回退；150–250 字与四要素移入 `foundation-design.md`；技能与提示不含数量上限。
- **AC7**：面板基础设定预览、`story_read role:<slug>`、导出在新形状下正常；README:113 同步。
- **AC8**：`submission.ts` 的 12/20 上限删除；相关 `submit-invalid` 文案更新。
- **AC9**：单元测试与 E2E 全绿；旧 schema/旧夹具删除重建，无迁移。
- **AC10**：真实链路跑一次 foundation（含 minor 卡与重跑清理）；按 AGENTS.md 用 `session_prompt` 驱动，证据取 `session.v4.jsonl.zstd` 的 `tool/call`/`tool/result`。

## 未决

- 无产品级未决。若作者要保留索引 `voice` 或希望 cards 允许不完整覆盖，属于新决定，另行评审。
