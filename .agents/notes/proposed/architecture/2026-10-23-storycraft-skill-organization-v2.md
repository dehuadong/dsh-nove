# Agent Note: 故事工坊：Skill/角色组织 v2（共享方法 + 三形态流水线）

Status: proposed

> 部分交付：A0-5 共享方法与 L 角色薄契约已落地；S/D 独立流水线未落地，保留 proposed。
>
> **部分替代（2026-10-27）**：§1「形态级共享方法」已被阶段技能决定替代——一个技能只装一个节点的 craft，参考只由宿主按节点选择；见 [2026-10-27-storycraft-action-gates.md](../../implemented/feature/2026-10-27-storycraft-action-gates.md)。三形态独立流水线的其余部分仍然有效。

## 问题

当前 11 个技能把长篇方法拆成 write-craft、longform-chapter、longform-method，角色再各自带一份；短篇和剧本复用长篇章节阶段机。全量对拍确认：参考实现的方法更完整，短篇/剧本是独立流水线。继续按角色拆方法会重复、漂移，继续共用阶段机会把不同产物压成同一种。

本 Note 定技能/角色/流水线组织；产物字段与迁移归 [产物合同 v2](../../implemented/architecture/2026-10-23-storycraft-artifact-contract-v2.md)。

## 与既有记录

- R6a 的 [`2026-10-23-storycraft-longform-method-references.md`](../../implemented/process/2026-10-23-storycraft-longform-method-references.md) 在 A0-5 被**部分替代**：三份 references 已迁到 `long-writing` 并新增篇幅参考；角色技能改读共享方法，`storycraft-longform-method` 只留迁移别名。运行目录的数量与路由仍以 `skills.js`/`skills.test` 为准，L 切换到 `long-writing` 后完成归档；两 Note 已互相链接。
- R11 的 [`2026-10-23-storycraft-settler-auto-projection.md`](../../implemented/feature/2026-10-23-storycraft-settler-auto-projection.md) 的定稿顺序（审稿→修订→摘要→settle）在 L 中保留；本 Note 只把方法归并、产物迁到 v2。
- 旧 R10 方案已 rejected：[`2026-10-23-storycraft-foundation-delegation.md`](../../rejected/architecture/2026-10-23-storycraft-foundation-delegation.md)。

## 提案

### 1. 共享方法，角色薄契约

每个形态一份共享方法技能 + references，由该形态所有角色共同加载：

```text
skills/longform/storycraft-long-writing/SKILL.md
  references/foundation-design.md
  references/reader-contract-and-progression.md
  references/scene-dialogue-and-length-budget.md
  references/state-projection.md

skills/shortform/storycraft-short-writing/SKILL.md
  references/production-checklist.md

skills/screenplay/storycraft-script-writing/SKILL.md
  references/episode-scene-craft.md
```

角色技能只写：

- 本轮任务与输入；
- 提交什么（schema/上限）；
- 闸门/失败回退；
- 不能做什么（落盘、跨角色写入）。

角色技能不复制方法正文、不另写一套“写法”。审稿、修订等角色专属标准可以独立（review dimensions、revise modes、deslop）。

### 2. 角色与提交

| 角色 | 加载 | 提交 |
| --- | --- | --- |
| architect | long-writing + foundation-design | story_frame / volume_map / book_rules / roles / initial hooks |
| planner | long-writing + reader-contract | ChapterMemo（goal 即 intent）/ threadRefs |
| composer | long-writing + context recipe | ContextPackage / Trace（source/reason/protection） |
| writer | long-writing + scene/length | 章节正文 |
| reviewer | long-writing + review dimensions | observations（code/evidence/sourceRefs） |
| reviser | long-writing + revise modes | 修订稿 + resolved observations |
| settler | long-writing + state-projection | factOps/hookOps |
| summarizer | long-writing + summary contract | ChapterSummary（结构化 + rawText） |
| validator | long-writing + state-projection | findings/对账 |
| short writer/reviewer/packager | short-writing + production checklist | outline / batch draft / review / revision plan / package |
| script writer/reviewer | script-writing + episode-scene-craft | spec / script / episode-scene |

### 3. 三形态流水线

**长篇 L**

```text
init → foundation（architect 四阶段）→ author confirms outline
→ plan（intent/memo/threadRefs）→ compose（ContextPackage/Trace）→ write
→ review → revise → summary → settle（settler + validator + fold）→ finalize
```

`compose` 在 L 交付前由现有 `context.js` 主机装配承担；L 交付后可以是独立 composer 步骤，二者必须使用同一 trace 合同，不重复实现。保留 R11 的顺序：摘要 current 是 settle 闸门；settle 内部做 settler/validator，不把 validate 提前成独立阶段。

**短篇 S**（独立，不复用长篇章表）

```text
outline → batch draft（chapters[]）→ draft review（sourceRefs）
→ revision plan → package（intro/selling points/cover prompt）→ final
```

默认 12 章 × 约 1000 字可配置；产物见 ShortStory 合同。

**剧本 D**（独立，不复用长篇章表）

```text
spec → script（episodes/scenes）→ review → final
```

目标格式、集数、时长是输入；storyboard/interactive film 另列 R8。

### 4. 20 个参考技能的落位

不按“分类不同”删除；每个技能有归属阶段。共享方法技能与 references 在 A0 落地；运行路由、阶段机与流水线动作按 L/S/D/R7/R7b/R7c/R8 切换。

| 技能 | 阶段 | 我们的技能 |
| --- | --- | --- |
| long-writing + 4 refs | L | storycraft-long-writing（共享） |
| story-review + review-matrix | L | storycraft-review（observation） |
| story-deslop + semantic-cleanup | L | revise/cleanup（角色标准） |
| story-import + reconstruction-rubric | R7c | 导入/续写工程 |
| continuation-writing | R7c | 续写 |
| fanfic-writing | R7c | 同人 |
| imitation-writing | R7c | 仿写/风格指纹 |
| spinoff-writing | R7c | 番外 |
| short-writing + production-checklist | S | storycraft-short-writing |
| short-story-analysis + deconstruction | R7 | 短篇拆解 |
| short-market-research + rubric | R7b | 短篇市场 |
| long-story-analysis + analysis-lens | R7 | 长篇拆解 |
| long-market-research + research-rubric | R7b | 长篇市场 |
| script-writing + episode-scene-craft | D | storycraft-script-writing |
| storyboard + shot-continuity | R8 | 分镜 |
| interactive-film + branch-state-craft | R8 | 互动影游 |
| play-world + world-turn-continuity | R8 | Play 世界 |
| play-illustration | R8 | Play 插画 |
| story-cover + cover-brief | R8 | 封面 |
| translation + long-form-consistency | R8 | 翻译 |

`storycraft-studio-orchestration` 保留为跨形态编排；`storycraft-longform-chapter` 不再拥有方法，只保留流程闸门；`storycraft-write-craft`/`storycraft-longform-method` 的方法正文并入 long-writing 后，保留薄引用或下线。具体退休/合并由实施时的 Note 与测试确认。

现有技能迁移表：

| 现有技能 | 去留 |
| --- | --- |
| `storycraft-longform-chapter` | 保留主编流程，方法改读 long-writing |
| `storycraft-plan-craft` | 保留 planner 输出契约，方法读 long-writing |
| `storycraft-write-craft` | 方法正文并入 long-writing，保留薄角色契约 |
| `storycraft-longform-method` | 3 refs 已并入 long-writing 4 refs；A0-5 起只留迁移别名，L 切换后下线 |
| `storycraft-review` | 保留，增加 observation code/evidence |
| `storycraft-revise-craft` | 保留角色标准 |
| `storycraft-short-story` | A0-5 薄化为形态契约，方法读 short-writing；S 后下线或保留 |
| `storycraft-short-drama` | A0-5 薄化为形态契约，方法读 script-writing；D 后下线或保留 |
| `storycraft-state-check` | vet 角色契约；长篇读 state-projection，短篇/剧本按各自形态 |
| `storycraft-state-settler` | settler 角色契约；长篇读 state-projection，短篇/剧本按各自形态 |
| `storycraft-studio-orchestration` | 保留跨形态编排，更新为三流水线 |

`FORM_META`/技能路由在 L/S/D 各阶段同步；旧技能名只作为迁移别名，不进入新作品。A0-5 只落长篇共享方法与角色引用；短篇/剧本的 reviewer/reviser 加载各自共享方法，随 S/D 流水线接入。

### 5. 宿主等价

- 技能加载留证据：`skill-evidence`（技能 id + revision）写入 ActionResult/trace；这是 DSH 自有证据名，不复用 InkOS 的 `skills-applied`；
- artifact schema 校验在提交/写入边界执行；
- 作者确认（outline/plan）保持现有面板闸门；
- 不引入独立 LLM Provider/Subagent 运行时（AGENTS 约束）。

## 备选方案

- **保留角色各一份方法**：重复、漂移，短篇/剧本继续被压；否决。
- **所有技能合并成一个巨型技能**：上下文过大、角色边界消失；改为共享方法 + 薄契约。
- **短篇/剧本继续复用长篇阶段机**：产物字段不同，信息损失；否决。
- **删除未排期的参考技能**：产品范围删除需作者裁决；本 Note 只登记阶段，不删除。

## 验收条件

1. 每形态一份共享方法技能 + references，角色技能不复制方法正文；
2. 角色提交 schema 与产物合同一致；
3. 三形态流水线独立，短篇/剧本不写长篇章表；
4. 20 个参考技能都有阶段归属或作者明确删除；
5. 技能加载、artifact 校验、作者确认有等价证据；
6. 旧角色技能/方法文件的退休有迁移路径，不静默删除。

## 风险

- 共享技能文件较大，需按 references 渐进加载；否则上下文成本上升。
- 角色薄契约需要严格 schema，否则子代理会自由发挥。
- 短篇/剧本独立流水线需要新动作/UI，不能只换提示词。
- 技能路由/测试数量会变化；必须更新 skills.test、README、矩阵。
- 旧技能合并期间可能出现双源；需明确退休顺序。
