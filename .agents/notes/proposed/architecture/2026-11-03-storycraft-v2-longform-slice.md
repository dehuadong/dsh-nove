# Agent Note: 故事工坊：InkOS-DSH v2 长篇垂直切片

Status: proposed

工作项：当前任务「InkOS-DSH v2 基线（长篇垂直切片）」。本文就是工作项：范围、产品行为、验收与排期归本文；长期技术决定另见链接的 Note。旧状态文档已冻结，本文不含“已实现/待重验”状态表。

## Problem

长篇链路至今没有一条真实作者从提案走到定稿的完整证据，原因不是缺少模块，而是验收单位错了：

- 过去按文件、Note、结构切片验收，产物写了、卡写了，消费者没迁（`roles:index` 有 5 个 minor，`facts/context/brief` 仍读 `bible:characters`），却被记成“已完成”；
- 技能激活与方法注入不是宿主行为，靠模型自行调 `skill` 工具，真实会话会跳过参考；
- 阶段字段写在 prompt 文本里，而不是每 phase 的 tool schema；
- 旧状态表（parity-matrix / delivery-status-*）把历史完成当当前状态，已按 [状态与证据的唯一来源](../../implemented/process/2026-11-03-storycraft-status-evidence-ownership.md) 冻结。

本工作项重建长篇基线：以 InkOS 为产品规格，用 DSH 运行时机制实现一条可验收的纵向切片，不再做无消费者的结构改造。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect.ts:13`：foundation craft 由激活的 long-writing Skill 提供；代码只拥有产物形状与动态限制。
- `inkos-master/packages/core/src/agents/architect.ts:129-140`：foundation prompt 只含作品元信息 + “按已激活 Skill 与工具提交”。
- `inkos-master/packages/core/src/agents/architect.ts:269-332`：同一 architect 内四段顺序提交，分别使用 outline/details/cast_index/cast_documents 工具。
- `inkos-master/packages/core/src/agents/base.ts:113-180`：`prepareWorkerMessages` 激活技能，`appendActivatedSkillGuidance` 把技能正文与选中的 reference 片段作为 protected guidance 注入。
- `inkos-master/packages/core/skills/inkos-long-writing/SKILL.md:24-25`：按节点 Load 对应 reference。
- `inkos-master/packages/core/src/utils/outline-paths.ts:60-127`、`forecast/context-builder.ts:59-62`：`roles:index`（name + major/minor）是人物权威，卡按主要/次要目录，Composer/Planner/Writer 消费。
- `docs/report/inkos/inkos03.md:124`、`inkos04.md:31/61/71`：人物索引与卡的消费者、卡片长度要求。

## Proposal

### 范围

一条长篇纵向切片，用 DSH 原生机制实现，替换现有实现中的对应部分（不做兼容、不双读、不迁移旧作品）：

1. **能力证据规则**：每个能力在本文有一行“参考证据 / 我们的落点 / 消费者测试 / 真实会话证据”，不写状态列；CI 跑测试，真实会话按日期与 session id 记录证据。
2. **宿主技能激活与 guidance**：按 role/form/work 计算 required skills，读取技能正文与所需 reference，作为 protected guidance 注入子代理 prompt；不再要求模型自行调用 `skill` 工具获取必读方法。技能选择与注入记录进 trace（skills-applied）。
3. **阶段 tool schema**：architect foundation 的四个 phase 各有一份提交 schema；prompt 只写任务、元信息与“用对应工具提交”，字段形状从 prompt 文本移入 schema。
4. **人物权威**：`roles:index` + `role:*` 是唯一人物权威；`facts/context/brief/state-check/settler/export` 全部消费卡（含 minor）；删除 `bible:characters` 六字段读取路径。
5. **章节链**：plan → write → review → revise → summary → settle → finalize 全链在真实会话跑通，失败路径按错误码停/重试。
6. **导出/备份/面板**：导出打开、备份恢复一次；面板确认按钮不自动发消息。

### 能力表（无状态列）

| 能力 | 参考证据 | 我们的落点 | 消费者测试 | 真实会话证据 |
|---|---|---|---|---|
| foundation 四段 | architect.ts:269-332、architect-tool.ts | `roles/architect` + 四个 phase tool schema | `foundation-production.test.mjs` | 本次 session id + 回执 |
| 技能激活/guidance | base.ts:113-180、inkos-long-writing/SKILL.md:24 | 插件侧激活表 + prompt guidance 注入 | 新增 `skill-guidance.test.mjs` | 本次 session 的 skills-applied trace |
| 人物权威 | outline-paths.ts:60-127、context-builder.ts:59-62 | `roles:index`/`role:*` + facts/context/brief 迁移 | `context.test.mjs`、`brief` 消费者测试 | brief trace 含 minor 名单 |
| 章节链 | writer/reviewer/settler agents | 现有 `story_*` 链 + 失败码 | 现有单元 + E2E | 第 1 章全链回执 |
| 导出/备份 | 参考 export/backup | 现有 export 仓储 + 面板 | `export-*` 测试 + E2E | 导出打开一次 |
| DSH 映射 | — | llm/subagents/session/jobs 服务 | 启动与调用测试 | 安装 smoke + 真实会话 |

### 与旧工作项的关系

- [真实链路三处缺陷修复](../../rejected/bug-fix/2026-11-03-storycraft-real-chain-defects.md) 的缺陷 1（hooks 读取）与缺陷 2（usage 证据）作为 S0 的输入并入本项，已有测试保留；
- 缺陷 3（architect 参考注入）由本项的「宿主技能激活/guidance」整体取代，不再做单参考特判；
- 旧工作项在本项实施开始时停止推进，不重复实现。

### DSH 运行时映射

| InkOS 机制 | 本项落点 | 约束 |
|---|---|---|
| LLM Provider | DSH `llm` 服务（经 subagents） | 不自建 provider、不引入外部 SDK |
| Agent 循环 | DSH agent loop + `subagents` 激活 | 不自写循环；子代理仍通过 `story_submit` 落库 |
| CLI | DSH command/GUI 入口 | 不新增独立 CLI 进程 |
| 存储 | 现有 SQLite 作品库 + DSH session 日志 | 不引入独立存储服务；旧作品不迁移 |
| 调度 | 同步作者驱动；需要后台时用 DSH `jobs`/`schedule` | 不自建调度器 |
| 技能 | DSH skill 注册表 + 插件侧激活表 | 技能正文与 references 由插件读取并注入 |

### 切片与退出条件

- **S0 基线（0.5 天）**：冻结状态表引用；固定本机 CI 命令；建立本文的能力表（无状态列）；旧工作项的缺陷 1/2 修复并入本项（hooks 读取、usage 证据），缺陷 3 由 skill guidance 方案取代。
- **S1 基础设定与人物（1–2 天）**：宿主技能激活/guidance + 四 phase tool schema；`roles:index`/卡成为唯一人物权威并迁移全部消费者；`bible:characters` 读取路径删除；测试覆盖 minor 进入 brief/context。
- **S2 章节链（2–3 天）**：plan/write/review/revise/summary/settle/finalize 全链；每步失败路径；真实会话跑第 1 章。
- **S3 收口（1 天）**：导出/备份/面板；真实会话从提案到定稿 + 导出；记录 session id 与回执；关闭本项，S/D 另立。

退出条件：每一片都有消费者测试 + 至少一条真实会话证据；没有“文件存在即完成”。

### 不做的

- 不做短篇/剧本（S/D 另立工作项）；
- 不重写存储层、面板视觉、动作名与错误码；
- 不做旧作品迁移/兼容/双读；
- 不新建独立能力账本系统（本项用能力表 + CI/会话证据，账本工具另立）。

## Alternatives considered

**继续在当前实现上按文件/模块修补。** 最强理由是熟悉、风险低；但过去 100+ commit 已证明它会绕开消费者与真实链路，故不采用。

**新建仓库全量重写。** 最强理由是彻底摆脱旧结构；但现有测试、契约与面板可复用，全量重写会重复踩坑，且 DSH 运行时映射已明确，不需要新仓，故不采用。

**只修状态文档、不重建能力。** 最强理由是快；但状态表已被证明不能代替能力，故不采用。

**直接引入 InkOS 的 Provider/Agent 循环。** 最强理由是省实现；但违反本项目只使用 DSH 机制的硬约束，故不采用。

## Acceptance criteria

1. 本机 `node storycraft/scripts/ci.mjs` 通过（单元 + E2E + build + pack-check）；
2. 真实会话（记录日期、session id、commit）完成：提案 → 立项 → foundation 四段 → 作者确认 → 全书计划 → 第 1 章章纲/正文/审稿/修订/摘要/结算/定稿 → 导出，回执与错误码符合契约；
3. `roles:index` 的 minor 角色出现在 brief/context 的 trace 与 whitelist；`bible:characters` 的六字段读取路径在代码中不存在；
4. architect foundation 的四个 phase 各有 tool schema；缺 phase/字段错误由 schema 拒绝，不依赖 prompt 文本；
5. 子代理 prompt 含 skills-applied 与 reference 来源，且 token 账包含技能注入；模型不因“没读文件”而漏方法；
6. 主会话不出现 `works/` 磁盘路径、不跨章读取、不把整章正文重复灌回；
7. 旧状态文档未被引用为当前完成依据；本文只记录证据，不写状态表。

## Plan Review

- Standards：遵循“状态唯一证据”Note；不建第二套状态表；技能/参考复用与不标注来源规则一致。
- Spec：范围与非目标明确；每片有消费者与真实会话退出条件；S/D 排除。
- Architecture：技能激活/guidance 成为宿主机制，取代模型自助加载；四 phase tool schema 收拢字段；人物权威单一；DSH 映射无外部运行时。
- 结论：通过，进入实施需新的 implement 授权。

## Risks

- 人物消费者迁移面大（facts/context/brief/state-check/settler/export）；按“删旧路径 + 新测试”推进，不保留双读；
- 技能 guidance 注入会增加 prompt 体积；按 role/form 限定 skills 与 reference，记录 token；
- 四 phase tool schema 迁移会改变提交错误码文案；以契约测试锁定；
- 真实会话有模型波动；验收只锁定阶段保证、消费者与回执事实，不锁定文笔；
- 旧测试夹具可能假设 `bible:characters`；测试作品删除重建，不写兼容。
