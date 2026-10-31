# Agent Note: 故事工坊：路线图（A0 → L → S → D）

Status: proposed

## 问题

故事工坊的能力面、阶段排期和差距登记此前混在一张表里：旧 P/R 阶段与新的 A0 → L → S → D 整改路线并存，已交付项和待办项互相干扰，导致“迁移切片完成”被误读成“产品阶段完成”。

本记录只保留**新路线**：阶段、依赖、退出条件与当前队列。能力面的完整清单、备选与状态归工作项 `#4`；逐项设计归各 Agent Note。三者分工如下，不再各写一套状态。

## 对拍参考

- 参考工程 `inkos-master` 2.0.0 的三形态组织、artifact 产物与角色交接，见 `docs/report/inkos/2026-10-23-full-project-parity-audit.md`、`2026-10-23-artifact-and-resource-parity-audit.md` 与 `2.0-harness-delta.md`。
- 采纳：A0 产物合同 → L 长篇 → S 短篇 → D 剧本的顺序；三种形态独立流水线，共享存储与合同。
- 不采纳：参考实现的 capability/profile 注入层；本项目用 DSH 的预设、作者闸门与委派回执等价实现。
- 边界：inkos 的产品结构与行为是规格；运行时逐项整改为 DSH 机制（Provider→宿主模型、Agent 循环→Subagent + `story_submit`、CLI→`story_*`/面板/会话、文件状态→工作区 + SQLite + artifact、调度→`story_next`/会话、server→面板 Slot）；DSH 缺的能力等价实现并登记，不删能力、不自创限制。详见 [parity-matrix 运行时整改](2026-10-18-storycraft-parity-matrix.md)。

## 提案

### 阶段路线

| 阶段 | 目标 | 退出条件 | 工作项 |
| --- | --- | --- | --- |
| A0 | 全量产物合同 v2 | 字段/权威/消费者/生命周期/初始化合同通过；真实生产者归 L | #45–#49（已交付） |
| L 迁移切片 | 长篇生产者/消费者迁移、foundation、observation、settle | 各切片实现与离线契约通过 | #51–#61（已交付） |
| L 产品收口 | planner、多章/重开/删除重排、上下文预算与 trace、面板消费、导出 | `#62` 的全部条目有裁决；`#66`、`#67` 关闭 | #62（已交付） |
| L 真实验收 | 真实模型、真实宿主、真实存储、真实面板；含多章/重开/删除重排、卷、备份恢复、导出打开 | `#50` 的 L 场景通过（EPUB 打开由作者豁免） | #50（已关闭 2026-10-30） |
| S 短篇 | 独立短篇流水线 | outline → batch draft → review → revision plan → package 全部落地并验收 | 待立 |
| D 剧本 | 独立剧本流水线 | spec/script、场次/集、导出验收 | 待立 |

依赖：A0 完成前不实现 L/S/D；L 先于 S、D；S/D 流水线未落地前不跑各自真实测试。

### 当前队列

1. `#62`（已完成）L 产品收口总表：差距表裁决 + 回写；
2. P0 已完成：`#63` planner 委派 → `#64` 上下文预算/trace → `#65` 多章确定性验收；
3. `#66` 面板统一状态（已关闭）、`#67` 死表清理（已关闭）；
4. `#50` L 真实验收（已关闭 2026-10-30；EPUB 打开由作者豁免；长篇完成收口）；
5. 已交付：`#85` A10 恢复、`#86` A12 版本、`#87` F13 性能、`#88` F8 调用观测；`#77`/`#78`/`#79`/`#4` 于 2026-10-31 关闭；
6. **后续工作项不再新建 GitHub issue**：新提案/工作项使用 `.agents/notes/proposed/`，按 `write-agent-notes` 的 proposed 格式；issue 只保留历史档案；
7. **长篇剩余收口（S 之前）**：F14 失败重试/成本上限 → A9 技能加载证据 → E1/E4/E5 面板 → B1 epub/pdf、B2 技能参考 → A1b/F5/R5；`store-db-row-types` 作为技术清理穿插。长篇余项收敛后，才进入 **S 短篇**（outline → batch draft → review → revision → package），随后 D 剧本。

### 完整待办（并入 `#4`，2026-10-31）

`#4` 的完整清单已并入本表；状态以这里为准，未开工项在开工时写 proposed Note，不再立 issue。

| 域 | 条目 | 状态 / 下一步 |
| --- | --- | --- |
| 长篇 | A10 状态投影与恢复 | **已交付**（#85） |
| 长篇 | A12 版本候选/回滚 | **已交付**（#86） |
| 长篇 | F13 250 章性能 | **已交付**（#87） |
| 长篇 | F8 成本与调用观测 | **已交付**（#88） |
| 长篇 | A9 创作方法库/加载证据 | **已交付**；[A9 Note](../../implemented/feature/2026-10-31-storycraft-a9-skill-evidence.md)，阶段技能 + 技能加载证据 |
| 长篇 | F14 失败重试与成本上限 | **已交付**（启动重试 + 可选单章 token 上限）；[F14 Note](../../implemented/architecture/2026-10-31-storycraft-f14-retry-budget.md) |
| 长篇 | E1/E4/E5/E6/E7/E13 面板 | 待开/未排期；E2 阅读器未排期 |
| 长篇 | B1 epub/pdf 素材、B2 技能参考检索 | 部分：txt/md 与故事记忆已交付；epub/pdf、技能参考未做 |
| 长篇 | A1b 单次调用产章、F5 快照 | 未排期；F5 现有备份是作品级基础 |
| 长篇 | R5-a/b/c/d 检索后续 | 未排期，触发条件见 #4 历史表 |
| 短篇 | S outline/batch/review/revision/package | **下一阶段**（proposed Note 另行起草） |
| 剧本 | D spec/script/场次集 | S 之后；C3-C7 未排期 |
| 导出/发布 | D1 导出已交付；D2 封面、D3 插图 | 未排期 |

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

已落地的 8 篇已按 `write-agent-notes` 迁到 `implemented/`；`proposed/` 现有 skill-organization v2（部分）、store-db-row-types（待开）、F14（规划中）与 roadmap/parity 两篇 living 文档。

### 技能与资源基线

`L` 产品收口不只是编排：技能正文与 references 也决定角色输入质量。

| 资源 | 现状 | 缺口 |
| --- | --- | --- |
| `storycraft-long-writing` + 4 refs | 已用于规划/写作/审稿/主编 | 与 artifact v2 的 hook 生命周期说明需同步 |
| `storycraft-short-writing` + production-checklist | 已有方法与形态契约 | 独立短篇流水线未接，S 阶段再验 |
| `storycraft-script-writing` + episode-scene-craft | 已有方法与形态契约 | 独立剧本 spec/场次流水线未接，D 阶段再验 |
| 审稿/修订/状态技能 | 已有 review dimensions、deslop、state-check/settler | 行号/前后 revision 证据按 `#62` 的 L-G2 裁决不做（触发后立）；技能正文与 artifact v2 同步、加载证据归 L-G14，排在 `#50` 之后 |
| 分析/市场/同人/导入资源 | 未建 | R7/R7b/R7c 单独立项，不提前铺目录 |
| 技能路由与检索 | writer 按 form 追加技能；reviewer/reviser 只加载角色技能 | 无技能加载证据；技能参考未进统一检索 |

### 已交付能力索引

旧 P1–P6、R1–R11、E3/E19/E20 与 A0/L 迁移切片的明细不再抄进路线图，避免和 `#4` 的状态重复：

- 能力面与状态：`#4`；
- 阶段与依赖：本记录；
- 逐项设计、决定与验证：`.agents/notes/implemented/`；
- 工作项验收与批准：GitHub Issues。

任何“已交付”判断以对应工作项关闭与 Note 的 `## 验证` 节为准，路线图只记录它属于哪个阶段。
### 横向能力

R7 分析、R7b 市场研究、R7c 衍生、R8 分镜/封面/翻译/互动影游不进入当前队列；按各自触发条件单独立项，不因未排期从能力面删除。

### 台账分工

- `#4`：能力面完整清单、状态、备选与不可行项；
- 本记录：阶段顺序、依赖、退出条件、当前队列；
- Agent Note：逐项设计、决定、备选与验证；
- 工作项：本次范围、验收、评审与批准证据。

任何一项完成时，只更新自己的属主，其他位置链接，不复制状态。

## 历史基线（旧 P/R 阶段）

旧版 P1–P6、R1–R11、E3/E19/E20 的逐项交付表已从路线图移出，内容仍保留在 `#4` 与 `.agents/notes/implemented/`，不丢失：

- P1–P4：真值/上下文、阶段闸门、两阶段提交、卷与窗口、质量层；
- P5–P6：单预设、形态数据化、面板两级、角色化；
- R1–R5：角色输入契约、白名单、交接裁剪、SQLite 存储、检索；
- R6a/R6b/R6c：长篇方法 references、形态路由、讨论规则；
- R9/R9b/R11：状态预检、语义对账、自动 settle；
- E3/E19/E20：真值编辑、面板重设计、回收站/备份。

这些阶段是当前 A0/L 的前史，不再作为当前排期；新工作只按本文的阶段路线推进。
## 备选方案

- **继续用旧 P/R + 新 A0/L/S/D 混排**：信息密度高但状态互相干扰；否决。
- **只保留 #4、不保留路线图**：能力清单没有阶段依赖与退出条件；否决。
- **路线图按能力项逐条排期**：会变成第二份 #4；否决。

## 验收条件

1. 路线图只保留 A0 → L → S → D，不再列旧 P/R 已交付项；
2. 每个阶段有唯一退出条件与工作项；
3. `#62` 关闭前不声称 L 产品完成，不开始 S/D 真实测试；
4. 台账分工被后续更新遵守。

## 风险

- 路线图仍可能被当成能力清单使用；正文已明确指向 `#4`。
- S/D 的“待立”状态可能再次被跳过；依赖段已写明“流水线未落地前不跑真实测试”。

