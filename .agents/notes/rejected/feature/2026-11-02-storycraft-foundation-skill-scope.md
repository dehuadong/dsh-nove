# Agent Note: 故事工坊：立项阶段技能按需加载

Status: rejected — superseded by 基础设定资源归位与 planner 直读

> **2026-11-02 状态更新：已被取代（superseded），不再作为实现合同。**
> 本项原“阶段技能集”方向放弃；真实会话确认 `storycraft-long-foundation` 空壳与方法混放，先做[基础设定资源归位与 planner 直读](../../implemented/architecture/2026-11-02-storycraft-foundation-resource-relocation.md)，并按[统一技能 references 加载契约](../../implemented/process/2026-11-02-storycraft-skill-reference-loading.md)补加载入口。本文的“roles/cards 只加载 architect”不执行。

工作项：当前任务（不新建 GitHub issue）。只优化 architect 四个 foundation stage 的技能加载范围，不改变四阶段提交合同。

## Problem

`story_delegate(role=architect, stage=frame|rules|roles|cards)` 每次都会在 prompt 里要求加载同一组技能：

- `storycraft-architect`；
- `storycraft-long-foundation`；
- `longform foundation-design` 参考。

但四个阶段的产物与方法需求不同：

- `frame` 需要完整的故事框架/卷图方法；
- `rules` 需要规则设计与基础方法；
- `roles` 只需要“薄索引 + 1:1 + 命名”约束；
- `cards` 只需要角色卡四字段、tier/slug 与人物写法。

结果是 4 个独立子代理重复加载同一套基础方法；roles/cards 的上下文被 frame/rules 的方法占用。它属于**角色级按需**，不是**阶段级按需**。

这不是“减少 4 次派发”的优化：四个阶段仍各自独立提交，保留失败隔离与 1:1 校验。

## 与既有决定

> 以下“部分取代”在本项暂停期间**不生效**；A9/role-model 仍按现状。恢复执行前先完成 references 加载契约并重新评审。

- **部分取代** [2026-10-29 role-model-parity](../../implemented/architecture/2026-10-29-storycraft-role-model-parity.md):75：该篇要求 roles/cards 的 150–250 字与四要素写法移入 foundation-design，architect 只留 payload/闸门/失败回退。本项把**最小 roles/cards 写法**收回 architect skill，是为了让 roles/cards 不再加载 foundation 方法；其余 payload/闸门仍归 architect。
- **部分取代** [2026-10-31 A9 skill evidence](../../implemented/feature/2026-10-31-storycraft-a9-skill-evidence.md):35,41：该篇把 `skill-routing.ts` 作为唯一来源，architect 固定为 architect+long-foundation。本项改为 `roleSkills('architect')` 只给基技能，`architectStageSkills(stage)` 是阶段唯一来源；A9 的“单一来源”仍成立，只是来源从 role 级变为 stage 级。

## 对拍参考

- `inkos-master` 的 foundation 以一次多产物提交为主；本项目已按阶段拆分（frame/rules/roles/cards），本项不逆拆。
- 本地 `src/skill-routing.ts:31` 的 `roleSkills('architect')` 固定返回 `['storycraft-architect','storycraft-long-foundation']`。
- `src/delegate.ts:675` 的 architect prompt 无条件要求两者；`src/delegate.ts:711` 的 skill evidence 也按两者记录。
- `skills/storycraft-architect/SKILL.md` 已包含四阶段的完整提交契约；`skills/storycraft-long-foundation/references/foundation-design.md:50-55` 另有 roles/cards 的人物写法。
- `tests/foundation-production.test.mjs:36` 用 fake service 捕获 `spec.request.prompt`，是 prompt 级验证入口。
- 现有 `B2b` 已证明技能段可以按 role/reference 收窄；本项只复用“按节点取最小集”的原则，不引入新的检索层。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 一次 foundation 提交 | 保留 4 阶段 | 失败隔离/1:1/阶段状态 | 不采用 | 现有测试 |
| 角色级固定技能 | 按 stage 取最小集 | 避免 roles/cards 重复加载方法 | 采纳 | 单元 |
| 方法参考按需读 | frame/rules 载基础技能；roles/cards 用 architect 内的收窄方法 | 同一事实不重复 | 补强 | prompt |
| 方法正文留在 foundation-design | 把 roles/cards 最小写法收回 architect | 阶段级加载需要 | **偏差（登记）** | 技能/单元 |

## Proposal

### 阶段技能集

新增 `architectStageSkills(stage)`（建议放 `skill-routing.ts` 或 `delegate.ts` 的导出纯函数）：

- `frame`：`storycraft-architect` + `storycraft-long-foundation`；
- `rules`：`storycraft-architect` + `storycraft-long-foundation`；
- `roles`：`storycraft-architect`；
- `cards`：`storycraft-architect`。

`roleSkills('architect')` 改为只返回 `storycraft-architect`；阶段集由 `architectStageSkills` 决定。`storycraft-long-foundation` 不再在 roles/cards 的 prompt 里被要求加载，也不在 `roleSkills('architect')` 的基集里。

### 技能内容补位

`storycraft-architect/SKILL.md` 的 roles/cards 段补齐所需方法，至少保留：

- 索引只列影响开篇冲突的具名人物，姓名 + tier，不写小传；
- 索引每人一张卡（1:1），tier 与索引一致；
- 卡写动机、已知信息、关系压力、能力边界；slug 稳定，改名不改 slug；
- 人物从动机/约束/关系/代价搭，不从标签搭；配角也要有自己的理由。

这样 roles/cards 不依赖 `storycraft-long-foundation` 也能完成合同。

### Prompt 与证据

- `architectPrompt` 的技能行改为 `architectStageSkills(stage)`；
- `skillEvidence`/trace 使用同一阶段集，不记录未加载的技能；
- prompt 不再出现“始终加载 longform foundation-design”的固定句；frame/rules 明确读 foundation-design；roles/cards 明确“按 architect 技能内的 roles/cards 段执行”；
- prompt 中 roles/cards 不再出现 `storycraft-long-foundation` 或 `foundation-design`。

### 不做

> 本项暂停；以下为原计划范围，不是当前执行合同。

- 不合并四阶段；
- 不改 `story_submit` 的单阶段合同；
- `roleSkills('architect')` 改为基技能；其它角色的 roleSkills 不变；
- 不改 writer/planner/reviewer 的技能路由；
- 除 storycraft-architect 的 roles/cards 方法段外，不改其它技能正文。

## Alternatives considered

**A. 保持两份都加载。** 最强理由是 roles/cards 也能读 foundation-design 的人物段。否决原因：每轮重复加载，阶段需求没有被表达；且 roles/cards 只需要一小段方法。

**B. 合并 roles+cards 为一个阶段。** 最强理由是减少一次子代理。否决原因：1:1 校验、重跑卡不改索引、失败隔离都会受损；这是产品合同变更，不是加载优化。

**C. 只在 prompt 里不写 foundation，但技能仍全量加载。** 最强理由是改动小。否决原因：模型仍会按 architect 的旧提示去读完整方法，重复成本仍在。

**D. 保留 long-foundation，只读 roles/cards reference 段。** 最强理由是不搬方法、无两处维护，靠现有 reference narrowing 即可减少方法正文。否决原因：`skill` 工具仍要加载整份 `storycraft-long-foundation`，四个阶段的“同技能重复”没有解决；它只缩小 reference 阅读，不是阶段级技能加载。若产品只关心方法正文 token，D 更便宜；本项选择阶段级加载，因此不采用。

## Acceptance criteria

> 原计划的验收条件；本项暂停，恢复前需按新契约重写。

1. `architectStageSkills` 对 frame/rules 返回 architect+long-foundation，对 roles/cards 只返回 architect；
2. architect delegate prompt 的技能行与实际 stage 集一致，roles/cards 不再出现 `storycraft-long-foundation` 或 `foundation-design`；frame/rules 仍出现；
3. `skillEvidence` 对该阶段只记录实际加载的技能；trace 是覆盖式 work-level artifact，测试以最新 stage 的 evidence 为准；
4. `storycraft-architect/SKILL.md` 的 roles/cards 段包含索引 1:1、tier、slug、四字段与人物方法；第 9/42/52 行中“读 foundation-design”的指令收窄为 frame/rules 专用，roles/cards 不依赖 long-foundation 也能提交；
5. 四个阶段仍各自独立 `story_submit`，四阶段合同、校验、失败重试不变；
6. 单元测试覆盖 `architectStageSkills`；`tests/foundation-production.test.mjs`（fake service 捕获 prompt）断言 roles/cards prompt 不含 long-foundation、frame/rules 含；`tests/skill-evidence.test.mjs` 对 architect 的旧 union 断言改为 `architectStageSkills`（文件数仍 94），现有 94 单元 + 49 E2E 通过；
7. README/技能说明/相关 Note 同步。

## Risks

- roles/cards 少了 foundation-design 的人物段，可能出现模板化角色；用 architect 内的收窄方法补位，并在真实链路观察；
- 方法正文从 foundation-design 收回 architect 会造成两处维护；只搬 roles/cards 最小段，role-model-parity 已登记；
- `roleSkills('architect')` 与 stage 集不一致，需明确“通用角色技能”与“本次加载技能”的区别；
- 若把方法搬进 architect 后维护两份，可能漂移；roles/cards 段只保留合同必需的最小内容；
- 不减少子代理次数，token 收益来自每次少加载一整份技能，不要宣称“4 次变 1 次”。
