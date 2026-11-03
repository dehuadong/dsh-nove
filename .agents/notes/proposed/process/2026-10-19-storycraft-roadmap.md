# Agent Note: 故事工坊：路线图（A0 → L → S → D）

Status: proposed

## 问题

故事工坊的能力面、阶段排期和差距登记此前混在一张表里：旧 P/R 阶段与新的 A0 → L → S → D 整改路线并存，已交付项和待办项互相干扰，导致“迁移切片完成”被误读成“产品阶段完成”。

本记录只保留**新路线**：阶段、依赖、退出条件与当前队列。能力面完整清单/状态以本表与 `.agents/notes/implemented/` 为准；`#4` 只是历史清单，不再拥有新工作。逐项设计归各 Agent Note。

## 对拍参考

- 参考工程 `inkos-master` 2.0.0 的三形态组织、artifact 产物与角色交接，见 `docs/report/inkos/2026-10-23-full-project-parity-audit.md`、`2026-10-23-artifact-and-resource-parity-audit.md` 与 `2.0-harness-delta.md`。
- 采纳：A0 产物合同 → L 长篇 → S 短篇 → D 剧本的顺序；三种形态独立流水线，共享存储与合同。
- 不采纳：参考实现的 capability/profile 注入层；本项目用 DSH 的预设、作者闸门与委派回执等价实现。
- 边界：inkos 的产品结构与行为是规格；运行时逐项整改为 DSH 机制（Provider→宿主模型、Agent 循环→Subagent + `story_submit`、CLI→`story_*`/面板/会话、文件状态→工作区 + SQLite + artifact、调度→`story_next`/会话、server→面板 Slot）；DSH 缺的能力等价实现并登记，不删能力、不自创限制。详见 [parity-matrix 运行时整改](2026-10-18-storycraft-parity-matrix.md)。

## 提案

> **2026-11-02 基线重置**：本表历史行中的“已交付/已关闭/已迁移”均按**旧对拍口径**产生，不能证明新基线完成。R0b 已完成 90 篇盘点：77 `revalidate-only`、11 `rework-required`、2 `legacy-delivered`（结构相关合计 13），明细见[交付状态盘点](../../implemented/process/2026-11-02-storycraft-delivery-status-inventory.md)；未重验前不冒充 `revalidated`。

### 阶段路线

| 阶段 | 目标 | 退出条件 | 工作项 |
| --- | --- | --- | --- |
| R0 | 对拍基线重审与角色职责边界 | parity-matrix/roadmap 与当前代码一致；architect 四段与 design/cards 偏差**已裁决：B 不保留为目标**；角色 prompt/schema/agent 边界有目标结构 | [重审 Note](../architecture/2026-11-02-storycraft-parity-rebaseline.md)（规划完成） |
| R0b | 交付状态重审与重排期 | 90 篇 implemented Note 与 roadmap 已交付行完成 `legacy-delivered/revalidate-only/rework-required/cancelled` 分类；受影响 Note 有处置；旧“L 完成”撤回 | [交付状态盘点](../../implemented/process/2026-11-02-storycraft-delivery-status-inventory.md)（已完成盘点） |
| R1 | architect 多阶段提交与原子落地 | 一个 architect child 四 phase；bundle 单事务；architect agent/prompt/schema 拆分 | [运行时合同](../../implemented/architecture/2026-11-02-storycraft-architect-multistage-runtime.md)（已实现） |
| R1b | architect 初始伏笔 | `pendingHooks` 随 details 播种进 v2 事件、第五段 `bible:hooks`、完整性/面板/导出/消费者 | [初始伏笔合同](../../implemented/architecture/2026-11-02-storycraft-architect-initial-hooks.md)（已实现） |
| R2 | 角色边界 | 八个角色模块（`contract/prompts/tool-schema/agent`）+ `runtime/` 抽取；旧 `delegate.ts` 删除、无双入口；行为与错误码不变 | [角色边界合同](../../implemented/architecture/2026-11-03-storycraft-role-boundaries.md)（已实现） |
| R3 | 基础设施职责拆分 | `store-db.ts`/`tools.ts`/`context.ts`+`bible.ts`/`client.ts` 拆入 storage/domain/runtime/context/tools/client；行为冻结、旧文件删除 | [基础设施合同](../architecture/2026-11-03-storycraft-infrastructure-seams.md)（实现中：S1–S3 完成；S4 进行中（context/composer+contract 完成、context.ts 已删；brief/bible 待拆）；S5–S7 待做） |
| A0 | 全量产物合同 v2 | 字段/权威/消费者/生命周期/初始化合同通过；真实生产者归 L | #45–#49（已交付） |
| L 迁移切片 | 长篇生产者/消费者迁移、foundation、observation、settle | 各切片实现与离线契约通过 | #51–#61（已交付） |
| L 产品收口 | planner、多章/重开/删除重排、上下文预算与 trace、面板消费、导出 | `#62` 条目有裁决；旧口径交付，待 R4 重验 | #62（旧口径，待重验） |
| L 真实验收 | 真实模型、真实宿主、真实存储、真实面板；含多章/重开/删除重排、卷、备份恢复、导出打开 | 旧口径 L 场景通过；**不声称 L 完成**，待 R4 | #50（旧口径，待重验） |
| S 短篇 | 独立短篇流水线 | outline → batch draft → review → revision plan → package 全部落地并验收 | 待立 |
| D 剧本 | 独立剧本流水线 | spec/script、场次/集、导出验收 | 待立 |

依赖：R0 基线裁决先于 R0b 状态盘点；R0b 完成前不把旧“已交付”当新基线完成；之后 R1→R2→R3→R4；A0/L 旧口径不再作为 S/D 的完成前提，S/D 需 R4 后重新排期。

### 当前队列

1. **R0 对拍基线重审**：parity-matrix/roadmap 已更新；architect 四段 vs design/cards 已裁决——B 不保留为目标，R1 回到同 architect 四段/等价 runtime；角色边界已定义；
2. **R0b 交付状态重审（已完成盘点）**：90 篇 implemented Note 分类为 77 `revalidate-only` / 11 `rework-required` / 2 `legacy-delivered`（结构相关合计 13）；本批不归档，替代在 R1/R2 落地后逐篇处理；旧“L 完成”撤回；
3. **R1 architect runtime（已实现）**：[多阶段提交与原子落地](../../implemented/architecture/2026-11-02-storycraft-architect-multistage-runtime.md)，一个 child 四 phase；**R1b 初始伏笔（已实现）**：[初始伏笔合同](../../implemented/architecture/2026-11-02-storycraft-architect-initial-hooks.md)；**R2 角色边界（已实现）**：[角色边界合同](../../implemented/architecture/2026-11-03-storycraft-role-boundaries.md)；**R3 基础设施（规划完成，待实现）**：[基础设施合同](../architecture/2026-11-03-storycraft-infrastructure-seams.md)；
4. `#62`（旧口径，待 R4 重验）L 产品收口总表：差距表裁决 + 回写；
5. P0 旧口径：`#63` planner 委派 → `#64` 上下文预算/trace → `#65` 多章确定性验收；
6. `#66` 面板统一状态（旧口径）、`#67` 死表清理（旧口径）；
7. `#50` L 真实验收（旧口径 2026-10-30；EPUB 打开由作者豁免；**不再声称长篇完成**）；
8. 旧交付：`#85` A10 恢复、`#86` A12 版本、`#87` F13 性能、`#88` F8 调用观测；`#77`/`#78`/`#79`/`#4` 于 2026-10-31 关闭；R0b 已分类，待 R1–R4；
9. **后续工作项不再新建 GitHub issue**：新提案/工作项使用 `.agents/notes/proposed/`，按 `write-agent-notes` 的 proposed 格式；issue 只保留历史档案；
10. **长篇剩余（S 之前）**：R0 → R0b → R1 architect → R2 角色边界 → R3 基础设施 → R4 重验 → R5-a/c/d；B1/F14/A9/B2/B2b/F5 为旧交付，待重验；`store-db-row-types` 作为技术清理穿插。R4 完成前不进入 S/D 产品阶段。

### 完整待办（历史 #4 已并入，2026-10-31）

历史 `#4` 的清单已并入本表；状态以这里与 implemented Note 为准，未开工项在开工时写 proposed Note，不再立 issue。

| 域 | 条目 | 状态 / 下一步 |
| --- | --- | --- |
| 长篇 | A10 状态投影与恢复 | **已交付**（#85） |
| 长篇 | A12 版本候选/回滚 | **已交付**（#86） |
| 长篇 | F13 250 章性能 | **已交付**（#87） |
| 长篇 | F8 成本与调用观测 | **已交付**（#88） |
| 长篇 | A9 创作方法库/加载证据 | **已交付**；[A9 Note](../../implemented/feature/2026-10-31-storycraft-a9-skill-evidence.md)，阶段技能 + 技能加载证据 |
| 长篇 | F14 失败重试与成本上限 | **已交付**（启动重试 + 可选单章 token 上限）；[F14 Note](../../implemented/architecture/2026-10-31-storycraft-f14-retry-budget.md) |
| 长篇 | E1/E4/E5/E6/E7/E13 面板 | E1/E4/E5 **已交付**：[看板 Note](../../implemented/feature/2026-10-31-storycraft-dashboard-e1-e5.md)；E6 **已交付**：[分析 Note](../../implemented/feature/2026-10-31-storycraft-e6-analysis.md)；E13 **已交付**：[自检 Note](../../implemented/feature/2026-10-31-storycraft-e13-self-check.md)；E7 **已交付**：[日志 Note](../../implemented/feature/2026-10-31-storycraft-e7-call-logs.md)；E2 阅读器**不做**（2026-11-01 作者决定） |
| 长篇 | E18 作品/章节检索筛选 | **已交付**：[E18 Note](../../implemented/feature/2026-11-01-storycraft-e18-work-chapter-filters.md) |
| 长篇 | B1 epub/pdf 素材、B2 技能参考检索 | 部分：txt/md、epub/pdf 与故事记忆已交付；B1 [素材 Note](../../implemented/feature/2026-10-31-storycraft-b1-epub-pdf-materials.md)；B2 **已交付**：[技能检索 Note](../../implemented/feature/2026-10-31-storycraft-b2-skill-search.md)；B2b **已交付**：[上下文检索 Note](../../implemented/feature/2026-10-31-storycraft-b2b-context-skill-retrieval.md) |
| 长篇 | A1b 单次调用产章、F5 快照 | A1b **取消**（2026-11-01 作者决定）；F5 **已交付**：[备份与素材 Note](../../implemented/feature/2026-10-31-storycraft-f5-backup-materials.md) |
| 长篇 | R5-a/b/c/d 检索后续 | **R5-b 已交付**：[threadRefs Note](../../implemented/feature/2026-11-01-storycraft-r5b-threadrefs.md)；R5-a/c/d 未排期 |
| 短篇 | S outline/batch/review/revision/package | **延期**（2026-11-01 作者决定：先收口第一阶段长篇） |
| 剧本 | D spec/script/场次集 | S 之后；C3-C7 未排期 |
| 导出/发布 | D1 导出已交付；D2 封面、D3 插图 | D2/D3 **取消**（2026-11-01 作者决定） |

### 作者取消/延期（2026-11-01）

- **A1b 单次调用产章**：取消，不做宿主内一次产章。
- **S 短篇**：延期，先收口第一阶段长篇。
- **E2 章节阅读器**：不做。
- **E11 模型配置页、E15 CLI、D2 封面、D3 插图**：取消，不做。
- 以上项不再排期；后续若重启，需作者重新裁决并另写 proposed Note。

### Proposed Note 处置

| Note | 处置 |
| --- | --- |
| `implemented/architecture/2026-10-24-storycraft-planner-delegation.md` | 已迁移（#63） |
| `implemented/architecture/2026-10-27-storycraft-byte-binding-and-engines.md` | 已迁移（#78/#79） |
| `implemented/architecture/2026-10-28-storycraft-settle-finalize-split.md` | 已迁移（#82/#85） |
| `proposed/architecture/2026-10-23-storycraft-skill-organization-v2.md` | 部分落地：阶段技能/薄角色已交付；S/D 独立流水线待做 |
| `proposed/architecture/2026-10-24-store-db-row-types.md` | 待开（类型缝/`@ts-nocheck` 收口） |
| `implemented/architecture/2026-10-31-storycraft-f14-retry-budget.md` | 已迁移（F14；启动重试 + 可选单章 token 上限） |
| `implemented/process/2026-10-24-storycraft-ts-migration.md`、`implemented/process/2026-10-24-storycraft-ts-pilot.md` | 已迁移（TS 源码、构建与 CI 接入） |
| `implemented/process/2026-10-26-storycraft-release-packaging.md` | 已迁移（发布字段、LICENSE、tarball smoke） |
| `implemented/bug-fix/2026-10-27-storycraft-gate-panel-architect-remediation.md` | 已迁移（#79） |
| `implemented/feature/2026-10-27-storycraft-action-gates.md` | 已迁移（#77） |

`proposed/` 现有 roadmap/parity 两篇 living 文档、`skill-organization-v2`（部分）、`store-db-row-types`（待开）、F14 已迁 implemented，以及 R0 [对拍基线重审](../architecture/2026-11-02-storycraft-parity-rebaseline.md)。

### 技能与资源基线

`L` 产品收口不只是编排：技能正文与 references 也决定角色输入质量。

| 资源 | 现状 | 缺口 |
| --- | --- | --- |
| `storycraft-long-prose` + reader-contract/scene-dialogue；`long-outline` + outline-design；`long-plan` + chapter-plan；`long-settle` + state-projection；`architect` + foundation-design | 当前 18 技能、17 refs；每个带 refs 技能有 `## 资源`、最多一个必读 | 与参考 `inkos-long-writing` 的分层不同；R0 重审 |
| `storycraft-short-prose` + production-checklist；`short-outline` + outline；`short-story` 形态契约 | 已有方法与契约 | 独立短篇流水线未接，S 阶段再验 |
| `storycraft-script-scene` + episode-scene-craft；`script-spec` + spec；`short-drama` 形态契约 | 已有方法与契约 | 独立剧本 spec/场次流水线未接，D 阶段再验 |
| 审稿/修订/状态技能 | `storycraft-review`、`revise-craft`、`state-check`、`state-settler` | 行号/前后 revision 证据未做；技能加载证据已有，但 prompt/schema 边界未拆 |
| 分析/市场/同人/导入资源 | 未建 | R7/R7b/R7c 单独立项，不提前铺目录 |
| 技能路由与检索 | writer 按 form 追加技能；reviewer/reviser 只加载角色技能；A9 记录 skill revision 证据 | 技能参考未进统一检索；R0 重审加载与 prompt/schema 边界 |

### 已交付能力索引

旧 P1–P6、R1–R11、E3/E19/E20 与 A0/L 迁移切片的明细不再抄进路线图，避免和当前状态重复：

- 当前能力面与状态：本表 + `.agents/notes/implemented/`（`#4` 只保留历史）；
- 阶段与依赖：本记录；
- 逐项设计、决定与验证：`.agents/notes/implemented/`；
- 工作项范围、评审与批准证据：本 Note/roadmap + 对应 Agent Note，不再新开 issue。

新基线完成以 R0b 状态 + R4 新证据为准；旧 Note 的 `## Testing`/CI 只算回归，路线图只记录它属于哪个阶段。
### 横向能力

R7 分析、R7b 市场研究、R7c 衍生、R8 分镜/封面/翻译/互动影游不进入当前队列；按各自触发条件单独立项，不因未排期从能力面删除。

### 台账分工

- `#4`：历史能力清单，不再拥有新工作；当前状态以本表与 implemented Note 为准；
- 本记录：阶段顺序、依赖、退出条件、当前队列；
- Agent Note：逐项设计、决定、备选与验证；
- 工作项：本次范围、验收、评审与批准证据。

任何一项完成时，只更新自己的属主，其他位置链接，不复制状态。

## 历史基线（旧 P/R 阶段）

旧版 P1–P6、R1–R11、E3/E19/E20 的逐项交付表已从路线图移出，内容仍保留在历史 `#4` 与 `.agents/notes/implemented/`，不丢失：

- P1–P4：真值/上下文、阶段闸门、两阶段提交、卷与窗口、质量层；
- P5–P6：单预设、形态数据化、面板两级、角色化；
- R1–R5：角色输入契约、白名单、交接裁剪、SQLite 存储、检索；
- R6a/R6b/R6c：长篇方法 references、形态路由、讨论规则；
- R9/R9b/R11：状态预检、语义对账、自动 settle；
- E3/E19/E20：真值编辑、面板重设计、回收站/备份。

这些阶段是当前 A0/L 的前史，不再作为当前排期；新工作只按本文的阶段路线推进。
## 备选方案

- **继续用旧 P/R + 新 A0/L/S/D 混排**：信息密度高但状态互相干扰；否决。
- **只保留历史 #4、不保留路线图**：能力清单没有阶段依赖与退出条件；否决（#4 已关闭，不再拥有新工作）。
- **路线图按能力项逐条排期**：会变成第二份能力清单；否决。

## 验收条件

1. 路线图按 R0 → A0 → L → S → D 组织，不再列旧 P/R 已交付项；
2. 每个阶段有唯一退出条件与工作项；
3. R0b 分类与 R4 重验完成前不声称 L 产品完成，不开始 S/D 真实测试；
4. 台账分工被后续更新遵守。

## 风险

- 路线图仍可能被当成能力清单使用；正文已明确当前状态以本表与 implemented Note 为准，`#4` 仅历史。
- S/D 的“待立”状态可能再次被跳过；依赖段已写明“流水线未落地前不跑真实测试”。

