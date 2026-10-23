InkOS 仓库分析研究文档（本地仓库地址：`E:\dsh-nove\inkos-master`）

> 2026-10-23 复核基线：`inkos-master` 2.0.0（`package.json`，无 `.git`）。下列 v1.0 / L1–L7 报告主要基于 1.x 与 2.0 早期源码，能力对拍已按当前源码修正，见 [与参考实现的能力对拍清单](../../../.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md) 与 [路线图](../../../.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md)。报告里的旧 commit pin 不能作为当前基线证据。

## [InkOS 总体研究结论 v1.0](01.md)，整合以下多轮研究：

- [InkOS 创作系统机制研究：从工作流到数据库检索与长期记忆](inkos01.md)
- [Composer 如何决定加载哪些记忆](inkos02.md)
- [InkOS 内容架构研究：Skill、资源文档与 Agent 结构化交接](inkos03.md)
- [内容权威与各 Agent 的上下文交接](inkos04.md)
- [InkOS 研究：内容权威、一致性与上下文交接的薄弱环节](inkos05.md)
- [内容依赖图、版本绑定、失效传播与记忆召回完整性](inkos06.md)
- [专题研究：历史章节修订与内容依赖一致性](inkos07.md)
- [叙事因果依赖与历史修订影响范围](inkos08.md)

## 专题研究清单

- [InkOS 内容创作机制](L1-2.md)
- [创作质量机制](L1.md)
- [L2 Skill 内容体系](L2.md)
- [研究作品内容组织与 Agent 协作](L3-4.md)
- [作品内容模型、权威与生命周期](L3.md)
- [Agent 协作与任务交接机制](L4.md)
- [内容依赖、历史修订与一致性传播](L5.md)
- [Runtime Skill、专业资源与 Agent 实际执行链](L6.md)
- [内容质量控制、审阅反馈与创作效果验证](L7.md)
- [InkOS 专题研究：数据库检索、长期记忆与记忆召回](jiyi.md)

## 2026-10-23 复核缺口

- `inkos-master` 实际为 2.0.0；Profile 已包含 `capabilityIds`、`confirmation`、`contextRecipe` 等，报告仍按 1.x 的 required/recommended skills 描述。
- Skill 发现已支持项目/用户目录与 `@skill-id` 激活；报告仍假设只有包内技能。
- 检索已统一为一个内核（故事记忆、材料、Skill references 按 scope/kind 区分）；`inkos03` 的“两套检索”结论过时。
- 2.0 新增 capability 动作、`propose_action` 确认交接、session→profile 绑定、`ActionResult` 完成证据、book-reference 资源绑定；`L4`/`L6` 未覆盖。
- Skill 数量为 20（18 份 references），`inkos-story-deslop` 等未出现在旧报告中。

上述缺口的对拍落点与优先级已写入 parity matrix 与 roadmap；本目录旧报告不重写，保留为 v1 研究记录。
