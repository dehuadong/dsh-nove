# 故事工坊 × InkOS：全项目一对一实现与产物对拍审查（2026-10-23）

> 范围：`inkos-master` 2.0.0 的 Agent、Skill/资源、产物/数据模型、流水线与宿主机制 vs `storycraft/` 当前实现。  
> 立场：**不做信息损失裁剪**。缺口只按依赖与风险排序，不按迁移成本否决；确实属于宿主平台差异的，要求等价行为，不能静默省略；不属于当前产品的，必须由作者明确裁决并从产品范围删除，不能由实现自行裁掉。  
> 配套：[产物结构与资源文档对拍审查](2026-10-23-artifact-and-resource-parity-audit.md)（专项细节）、[对拍矩阵](../../../.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md)、[路线图](../../../.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md)。

## 1. 结论

1. 过去的对拍以流程、编排、token 与交接为主，**产物结构和资源文档没有按参考实现逐项对齐**；R10 的“映射进现有 world/plan/characters/text-hook”属于信息损失裁剪，不能作为最终实现。
2. 全项目盘点后，缺口不是三五个文件，而是四层：
   - **产物/数据模型**：story_frame、volume_map、book_rules md/json、roles 卡、ChapterIntent/Memo、结构化摘要、hookId/生命周期、fact 三元组/有效期、observation 证据、ContextPackage/Trace；
   - **Agent/角色**：architect、planner 委派、settler、state-validator、auditor/reviewer、composer、continuity、detector、researcher/radar、short/script runner、fanfic importer、rules-reader、translation/play/storyboard；
   - **Skill/资源**：参考实现 20 技能、18 份 references；我们 11 技能、7 份 references，且多份是角色拆分后的摘要；
   - **宿主机制**：capability/profile、confirmation、contextRecipe、artifactSchemas、production、propose_action、ActionResult、skills-applied 等，需要用 DSH 的等价行为实现或明确裁决。
3. 结论：**先做 A0「全量产物合同 v2」**，把数据模型、归属、消费者、迁移、验收一次定清；R10 暂停，R9b/R11 已交付的 text-hook/string-fact 逻辑需要在新合同下复审。A0 不是“选做项”，而是后续所有生成/结算/审稿工作的前置。

## 2. 盘点口径

对参考实现的每个能力按四层拆分：

- **Agent/角色**：谁执行、输入/输出、失败策略；
- **Skill/资源**：方法正文与 references，是否被某个角色加载；
- **产物/数据**：结构、权威性、消费者、生命周期；
- **宿主/编排**：阶段、闸门、交接、确认、证据。

状态标记：

- `等价`：行为与结构均可对应；
- `拆分/映射`：职责被拆到多个实现，但需核对信息是否完整；
- `部分`：有主体，缺结构或消费者；
- `缺失`：没有对应实现；
- `平台差异`：宿主不同，必须实现等价行为，不能直接复制代码；
- `产品未包含`：需要作者明确裁决，不能由实现默认排除。

## 3. 总量对照

| 维度 | InkOS | 我们当前 | 差距 |
| --- | --- | --- | --- |
| Skills | 20 | 11 | 9 个技能缺失/未立项 |
| References | 18 | 7 | 11 份缺失或未对齐 |
| Agent 角色 | architect/planner/writer/reviser/auditor/settler/state-validator/composer/continuity/detector/researcher/radar/short-fiction/script-storyboard/fanfic-importer 等 | 主编 + planner/writer/reviewer/reviser/summarizer/validator/settler | 缺 architect、composer、continuity、detector、researcher、short/script runner、fanfic、translation/play/storyboard |
| 动作 | 由 Agent/action 驱动，数量随能力扩展 | 32 个 `story_*` 动作 | 动作覆盖主干，但缺 foundation/composer/import/analysis/short/script/play/translation 等 |
| 产物 | 多文件 + JSON 运行时 + 结构化 observation/context | 5 件 bible + plan/volumes/plans/chapters/reviews/summaries/events | 结构层级和字段明显更少 |
| 宿主机制 | capability/profile/confirmation/contextRecipe/artifactSchemas/production | 预设 + 动作 + 作者闸门 + artifact ID | 需等价实现或明确裁决 |

## 4. Agent/角色一对一

| InkOS 角色/模块 | 职责 | 我们的落点 | 状态 | 需要补什么 |
| --- | --- | --- | --- | --- |
| architect | 四阶段生成 story_frame/volume_map/book_rules/roles/初始 hooks，原子提交 | 无；R10 暂停 | 缺失 | A0 合同后，R10b 四阶段生成 |
| planner | 章 intent + memo，绑定 threadRefs | `storycraft-plan-craft` 手动 subagent；章纲五项 | 部分/拆分 | 增加 planner 委派、ChapterIntent/Memo、threadRefs |
| writer | 场景/人物/信息释放/节奏 | `storycraft-write-craft` + writer 委派 | 拆分/部分 | 对齐 long-writing 方法；补 book_rules/角色卡输入 |
| reviser | 按 observation 修订，mode 控制 | `storycraft-revise-craft` + reviser 委派 | 部分 | 接收结构化 observation；补语义 cleanup |
| auditor/reviewer | 按标准审稿，observation code/evidence | `storycraft-review` + reviewer 委派 | 部分 | 结构化 observation、证据/来源引用 |
| settler | 正文 → factOps/hookOps/结构化摘要 | `storycraft-state-settler` + `story_settle` | 部分 | fact 三元组/expire；hookId/生命周期；结构化摘要 |
| state-validator | 旧/新状态 vs 正文/权威，最多一次重算 | `storycraft-state-check` + `story_check`/R11 | 部分 | 适配新 fact/hook；一次重算语义 |
| composer | 选择/压缩上下文，记录 reason/protection/trace | `context.js` 固定段 + 字符预算；检索段 | 部分 | 语义选择/结构化来源/token trace（R12） |
| continuity | 跨章连续性、revision 对比 | 审稿技能 + 检索 | 部分 | 独立 continuity 检查/证据 |
| detector | AI 内容检测 insight | `critique.js` 指标 + deslop | 部分 | 结构化 detection insight，不只是数字 |
| researcher | 素材/研究 | 材料库 + 检索 | 部分 | 研究方法与来源 rubric（R7b） |
| radar | 趋势/榜单 | 无 | 缺失 | R7b |
| short-fiction runner | 短篇专用流水线 | 短篇写作技能 + 同一动作 | 部分 | 短篇制作 checklist、独立状态/包装（R7） |
| script-storyboard | 剧本/分镜 | 短剧技能 | 部分 | 分镜对象/镜头连续性（R8） |
| fanfic-canon-importer | 正典导入/同人边界 | 无 | 缺失 | R7c |
| rules-reader | 可读+结构化 book_rules | 无 | 缺失 | A0 book_rules |
| style-guide | 文风指纹/指南 | `style.js` 文风样例 | 部分 | 结构化风格指纹与可读指南 |
| semantic-context-compiler | 语义选择/压缩 | 无 | 缺失 | R12 |

## 5. Skill/资源一对一

参考实现 20 技能、18 份 references；我们 11 技能、7 份 references。下表逐项列出，不把“分类不同”当作省略理由。

| # | InkOS 技能（refs） | 用途 | 我们的落点 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | continuation-writing（0） | 从导入正文重建正典并续写 | 无 | 缺失（R7c） |
| 2 | fanfic-writing（0） | 外部正典同人 | 无 | 缺失（R7c） |
| 3 | imitation-writing（0） | 提取文体方法/风格指纹 | 无 | 缺失（R7c） |
| 4 | interactive-film（1） | 剧情树/旗标/多结局/资产连续性 | 无 | 缺失（R8） |
| 5 | long-market-research（1） | 长篇市场/榜单/平台研究 | 无 | 缺失（R7b） |
| 6 | long-story-analysis（1） | 长篇拆稿/文风/机制提炼 | 无 | 缺失（R7） |
| 7 | long-writing（4） | 场景/人物/信息/连载节奏 + foundation/reader/state/length | `storycraft-write-craft`、`storycraft-longform-chapter`、`storycraft-longform-method` + 篇幅 ref | 拆分/部分：方法被拆到多技能，需核对每段是否有等价正文 |
| 8 | play-illustration（0） | 互动世界插画 | 无 | 缺失（R8） |
| 9 | play-world（1） | 开放世界/分支推进 | 无 | 缺失（R8） |
| 10 | script-writing（1） | 小说/大纲改编剧本、场次 | `storycraft-short-drama` | 部分：缺 episode-scene-craft 改编方法 |
| 11 | short-market-research（1） | 短篇市场/标题/移动端 | 无 | 缺失（R7b） |
| 12 | short-story-analysis（1） | 短篇拆稿/情绪链/反转 | 无 | 缺失（R7） |
| 13 | short-writing（1） | 商业短篇构思/一次写完/包装 | `storycraft-short-story` | 部分：缺 production-checklist |
| 14 | spinoff-writing（0） | 母本正典派生番外 | 无 | 缺失（R7c） |
| 15 | story-cover（1） | 封面方向/生成 | 无 | 缺失（R8） |
| 16 | story-deslop（1） | 语义去 AI 味 | `storycraft-revise-craft` + `deslop.md` | 部分：`deslop.md` 未在正文点名；缺 semantic-cleanup |
| 17 | story-import（1） | 导入小说/重建设定/续写工程 | `story_bible_import`（只导世界，不导章节） | 部分/缺失（章节导入、reconstruction-rubric） |
| 18 | story-review（1） | 题材/读者标准审稿 | `storycraft-review` + `review-dimensions.md` | 部分：缺 observation code/evidence/sourceRefs |
| 19 | storyboard（1） | 可拍/可画/生图分镜 | 无 | 缺失（R8） |
| 20 | translation（1） | 长文互译/术语/分段续跑 | 无 | 缺失（R8） |

References 缺口（按产品阶段，不是“不做”）：

- 长篇：`scene-dialogue-and-length-budget` 的完整内容是否等价于我们的 `length-and-scene-budget`，需逐段核对；
- 审稿：`review-matrix` vs `review-dimensions`；
- 去 AI 味：`semantic-cleanup` vs `deslop`；
- 短篇：`production-checklist`；
- 分析/市场/导入/分镜/翻译：全部缺失；
- 各技能 `references/` 的精确读取与引用机制（InkOS `use_skill` reference）我们没有。

## 6. 产物/数据模型一对一

| 产物 | InkOS 结构（关键字段） | 我们当前 | 消费者缺失/风险 | 需要的实现 |
| --- | --- | --- | --- | --- |
| BookConfig | id/title/platform/genre/status/targetChapters/chapterWordCount/min/max/language/parentBookId/fanficMode | title/form/tags/wordRange/planApproval | 平台/题材/目标章数/语言/同人模式缺失 | 扩展 manifest/catalog；面板/导出/检索同步 |
| author_intent | 独立 Markdown | `bible/intent` | 接近，保留 | 语义核对 |
| current_focus | 独立 Markdown | 无；intent 混用 | 当前任务焦点没有独立文件 | 拆分 intent/current_focus 或明确合并 |
| story_frame | 独立可读 Markdown：premise/冲突/动机/约束/因果解决 | `world` + `plan.mainline` | 框架/世界/主线职责混用 | 新增 story_frame；world 只留世界；plan 引用 |
| volume_map | 独立可读 Markdown：卷/章方向/因果节拍 | `plan` 卷划分文字 | 无独立身份/版本；与 volumes 双源 | 新增 volume_map；结构化 volumes 保留 |
| book_rules.md | 可读创作规范 | 无 | writer/settler 无独立规则 | 新增 |
| book_rules.json | protagonist/genreLock/narrativePerson/prohibitions/fullCastTracking/fanficMode/allowedDeviations | 无 | 人称/主角锁/禁区不可校验 | 新增 schema；writer/settler 读取 |
| roles 索引 | major/minor + name | `characters` 六字段 | tier/索引混在六字段 | 新增 tier/索引 |
| 角色卡 | 每人 Markdown：动机/知识/关系压力/能力边界 | `characters` 六字段 | 缺知识/关系/边界/开篇状态 | 混合：六字段索引 + 卡；或迁移为卡+索引 |
| ChapterIntent | `{chapter, goal}` | 章纲 goal | 无独立 intent/版本 | 可先映射；R10b 后补 |
| ChapterMemo | `{chapter, goal, body, threadRefs}` | 章纲五项 | 缺 threadRefs/memo 来源 | 五项 + threadRefs；可选 memo |
| ChapterMeta | observations/provenance/lengthTelemetry/tokenUsage | manifest stage/revision/words | 缺 provenance/telemetry/observations | 扩展 manifest/章节元数据 |
| current_state | facts `{subject,predicate,object,validFrom,validUntil,source}` | events `{name,facts[]}` | 无 expire/validity/来源 | fact 表/JSON + 迁移 |
| pending hooks | HookRecord `{hookId,startChapter,type,status,lastAdvancedChapter,expectedPayoff,notes,dependsOn,paysOffInArc}` | events `{text,state}` | 改写即新伏笔；无 defer/superseded/依赖 | hookId/生命周期；迁移 text |
| chapter summaries | 7 字段结构化 row | 纯文本 ≤400 字 | hookActivity/mood/章型不可检索 | 结构化摘要 + 渲染文本 |
| observations | code/summary/evidence/category/assessment/scope/target/sourceRefs | review `{location,problem,suggestion,done}` | 无证据/来源/可审计 | observation 兼容结构 |
| ContextPackage | selectedContext[{source,reason,excerpt,protection}] | 固定段 + budget | 无 reason/protection/excerpt | R12 或 A0 预留 |
| ChapterTrace | 来源/预算/检索/压缩 | 字符预算/trim trace | 无 token/compression/retrieval trace | R12 |
| volumes | 卷表 + 卷摘要 | `volumes` 表 | 结构接近；保留 | 与 volume_map 分工 |
| materials/radar | 素材 + 研究方向/来源 | 素材库 + FTS；无研究 lens | 缺研究方法/来源 rubric | R7b |
| fanfic canon | 正典导入/边界 | 无 | 缺失 | R7c |
| translation glossary | 术语/分段 | 无 | 缺失 | R8 |
| storyboard shots | 镜头/连续性 | 无 | 缺失 | R8 |
| play/interactive state | 世界/分支/旗标 | 无 | 缺失 | R8 |
| export/backup | 参考有导出；我们有导出/备份 | `exports/backups` | 结构升级后同步 | A1 |

## 7. 流水线与宿主机制

| 环节 | InkOS | 我们 | 状态 |
| --- | --- | --- | --- |
| Foundation | architect 四阶段：frame/volume → rules/hooks → roles index → role cards；原子写 | 无；R10 暂停 | 缺失 |
| Plan | ChapterIntent + ChapterMemo + threadRefs | 章纲五项；planner 手动 | 部分 |
| Write | writer + skill + rules + context package | writer 委派 + brief/context | 部分 |
| Settle | settler factOps/hookOps + structured summary | `story_settle` + settler；text facts/hooks | 部分 |
| Validate | state-validator 旧/新 + 权威 + 一次重算 | `story_check`/`story_settle` R9b/R11 | 部分（需适配新模型） |
| Review | auditor observation code/evidence | reviewer 文本条目 | 部分 |
| Revise | reviser + mode + observations | reviser + mode | 部分（observation） |
| Detect | detector insight | `story_critique` 指标 | 部分 |
| Compose | composer 选择/压缩/trace | 固定段 + 检索 | 部分 |
| Short/Script | 独立 runner | 同一阶段机 + 形态技能 | 部分 |
| Play/Translation/Cover/Storyboard | 独立流水线 | 无 | 缺失（R8） |
| Host gates | capability/profile/confirmation/artifactSchemas/production | 预设 + 作者闸门 + artifact ID | 平台差异，需等价行为 |
| Evidence | skills-applied / ActionResult / trace | 技能加载无证据；委派回执/预算有 | 部分 |

## 8. 全项目整改方向

### A0：全量产物合同 v2（先做，不写业务代码）

逐项定字段、权威、消费者、生命周期、迁移与验收，覆盖第 6 节全部产物。P0 必须先定：

- hook：hookId、状态机、类型、预期兑现、依赖、defer/superseded；
- story_frame / volume_map：独立可读产物与消费者；
- book_rules.md/json：字段与 writer/settler 读取；
- 角色卡：tier + Markdown 卡 + 六字段索引的混合或替换；
- facts：三元组 + 有效期；
- 章节摘要：7 字段 + 渲染文本；
- observations：code/evidence/sourceRefs/assessment；
- ChapterMemo/threadRefs；
- ContextPackage/Trace（可为 R12 预留，但字段现在定）。

### A1：存储、迁移与兼容

- `WORK_SCHEMA_VERSION` 升级；新增表/JSON/列；
- 旧作品迁移：world→story_frame/world、characters→索引+卡、text hooks→hookId、string facts→三元组、text summary→结构化+原文；
- 备份/恢复/导出 manifest、面板真值编辑、检索索引同步；
- 旧格式只读、新写只写新格式，或一次性迁移；由作者裁决，但不能“因为成本”不做。

### A2：生产者与 Skill/资源

- architect 四阶段（R10b）；
- planner 委派 + intent/memo/threadRefs；
- settler：factOps/hookOps + 结构化摘要；
- reviewer：observation；
- composer：结构化上下文/trace；
- 20 个参考技能逐个落位：已覆盖的补全，缺失的按 R7/R7b/R7c/R8 建技能与 references；不把“分类不同”当删除理由；
- rules-reader、style-guide、detector、continuity、researcher/radar 逐项实现。

### A3：消费者

- brief/context 按新产物读取；
- 检索按结构化摘要/hookId/fact；
- UI 真值/角色卡/规则/摘要/observation 展示；
- 导出/备份；
- R9b/R11 适配新 fact/hook；R10 不再使用 text-hook。

### A4：验收

每个产物必须同时有：

1. 结构合同测试（字段、拒绝条件）；
2. 旧格式兼容/迁移测试；
3. 至少一个真实消费者测试（brief/context/review/settle/export）；
4. 作者可见的确认/拒绝路径。

## 9. 对 R10 的裁决

R10 当前 #44 已退回 `planning`。建议拆为：

- **R10a**：A0 产物合同 + 存储/迁移；
- **R10b**：architect 四阶段生成并接入作者确认；
- R9b/R11 在 R10a 后复审：text hook/fact 逻辑必须迁移，不能作为新 foundation 的前提。

不建议“先按现有格式实现 R10，以后再改”：这正是用户指出的白做路径。

## 10. 需要作者裁决

1. 是否按 A0 全量产物合同推进，而不是只修 R10？
2. P0 是否包含全部：hook、story_frame、volume_map、book_rules、角色卡、facts、摘要、observation、memo/trace？
3. 角色卡采用混合还是完全迁移为 Markdown + 索引？
4. 旧作品：一次性迁移还是旧只读/新写新格式？
5. 20 个参考技能中，哪些属于当前产品必须实现，哪些明确从产品范围删除？删除必须由作者决定，不由实现裁剪。
6. R10 是否按 R10a/R10b 拆分？

在这些裁决前，不创建新的实现门禁，不按旧格式继续 R10。
