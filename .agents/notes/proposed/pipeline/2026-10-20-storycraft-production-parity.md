---
title: 故事工坊：参考目标对拍与章节生产编排整改
status: proposed
created: 2026-10-20
updated: 2026-10-20
---

# Agent Note：故事工坊：参考目标对拍与章节生产编排整改


## 问题

`session-1ceb7bad-0ffa-4d68-b682-5fd7a0acf64a` 暴露的不是单点提示词问题：

- 6 turns / 47 steps，父会话约 2.87M tokens；
- 三次 writer 委派被同一类人名误报挡住，最后主编代写；
- 模型把 `works/<id>` 当工作区文件，读不存在的 `bible/characters.json`，再 `grep` 扫作品库被守卫拦住；
- 全书计划已确认，`story_next` 仍报 `outline` 缺失，`story_status` 又不返回计划状态；
- 面板确认与动作按钮的自动发送行为反复。

根因是两层：

1. **一致性用全局词表做硬判定**。`ROLE_NOUNS` / `DIALOGUE_STOPS` 对所有作品相同，无法穷举称谓、行业词、方言和绰号；误报一次就整章重写。
2. **没有完整对拍参考目标的工作流**。只对拍了“委派后不搬运正文”，没有对拍写前上下文、审稿 observation、状态结算/对账、失败策略和作者闸门。

## 参考基线

参考工程 `inkos-master` 2.0.0（只读）。用户于 2026-10-20 明确授权功能对拍；本记录只归纳行为，不复制源文件、命令或代码，也不把参考实现写进产品资产。

## 与既有记录

- `proposed/pipeline/2026-10-20-storycraft-host-delegation.md` 的宿主侧委派保留；本项部分替代它的一致性判定、失败重试与范围验收。
- #19 AC9、`empty-review` 限制、fixture 必须含问题、以及“补回归词”风险行由本项部分替代；#19 的委派实现仍保留，Verification 归属本项。
- 能力矩阵由 `proposed/pipeline/2026-10-18-storycraft-parity-matrix.md` 维护，本 Note 不另建第二张表。

## 参考目标的实际实现

参考目标（只读参考，不复制文件）把长篇生产拆成四层：

| 层 | 参考实现 | 责任 |
| --- | --- | --- |
| 上下文装配 | `Composer` / context package | 从作品角色卡、当前 state、canon、章纲、hooks、摘要中选 protected/compressible 片段 |
| 写作 | `WriterAgent` | 按 chapter memo、角色卡、治理上下文写整章；同时产出 chapter summary 与状态增量 |
| 审稿 | `ContinuityAuditor` | 对照 governed context 输出 observations（code、assessment、summary、证据行）；空 observations 合法 |
| 状态 | settler + `StateValidator` | 从正文抽取增量状态/hooks；LLM 对比旧/新投影，输出 observations；必要时 `reconciliationRequired` |

工作流：

```
prepareWriteInput
  -> writer.writeChapter
  -> reviewChapterDraft (ContinuityAuditor)
  -> buildPersistenceOutput
  -> StateValidator
  -> persist chapter + truth files
  -> return review observations / token usage
```

修订是独立操作 `reviseDraft`：读取当前正文与 review observations，按 mode 调 reviser；审稿不可用是 observation，不是正文有罪的证据，也不自动授权重写。StateValidator 在持久化前运行，可以修正投影；校验不通过只追加 observation，不阻断落盘，也不触发整章重写。

关键结论：

- 没有全局角色词/对白词表；
- 人名权威来自**作品角色卡与 canon**；
- 正文问题以 observation 呈现，不靠正则硬阻断；
- 草稿、审稿、状态、持久化分节点，但状态校验不通过只追加 observation，不自动整章重写；
- 参考目标的能力还包括 forecast、fanfic、spinoff、interactive film、市场研究；本项不复刻。

## 能力对拍清单

能力矩阵由 `proposed/pipeline/2026-10-18-storycraft-parity-matrix.md` 的生产编排能力表维护；本 Note 只记录工作流、节点错误和整改设计，不另建第二张表。
## 工作流对拍

### 参考节点

```
作者意图/作品配置
  -> foundation（角色卡、story_frame、volume_map、style）
  -> chapter intent / memo
  -> context package
  -> writer
  -> continuity auditor
  -> settler（chapter summary + fact/hook delta）
  -> state validator
  -> persist
  -> observations 返回作者/主编
  -> 需要时独立 revise
```

### 当前节点

```
story_propose / story_init
  -> story_outline / 作者确认
  -> story_next
  -> story_plan / 作者确认
  -> story_delegate writer（宿主落盘）
  -> story_delegate reviewer（问题条目）
  -> story_delegate reviser（按条目）
  -> story_state / story_summarize
```

### 差异与决定

| 节点 | 参考 | 当前 | 决定 |
| --- | --- | --- | --- |
| 上下文装配 | 语义选择 protected/compressible | `story_brief` 固定段 | 本项只补预算说明；语义选择列后续 |
| 草稿审稿 | 独立 auditor，observations，不自动改 | reviewer 问题条目 | 本项保留 reviewer；未登记人名 warning |
| 状态抽取 | 正文后自动 settler | 手写 `story_state` | 本项不自动 settler；避免在 warning 阶段自动落状态 |
| 状态对账 | StateValidator | 无 | 后续独立工作项 |
| 持久化 | 原子 persist + truth validation | 每动作事务 | 保留；不复制 pipeline 类 |
| 失败 | `review-unavailable` observation | delegate 失败可重试/回退 | 本项取消“误报→重写”；区分不可用与正文问题 |
| 作者闸门 | 计划/章纲确认 | 面板确认 + 自动发送 | 确认只落确认，动作按钮填输入框 |

## 节点错误清单

| 节点 | 现象 | 根因 | 修法 | 状态 | owner | 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| `story_init` | 模型读 `works/<id>/bible/characters.json` | `artifact.path` 是虚拟路径，schema 描述成“相对工作区文件” | 明确 virtual；禁止 read/grep；指向 `story_bible` | 已修（`845a4c0`） | `tools.js` / `scope.js` | 检查工具描述；真实首章不再报路径 |
| `grep` | 扫描 `works/` 被守卫拦住 | 默认扫描作品库 | 提示限定项目/作品；人设禁止 | 已修（`845a4c0`） | `scope.js` / 人设 | 节点测试 |
| `story_next` | 计划确认后仍 `missing:['outline']` | `last === undefined` 分支写死 missing | 已确认后 `missing:[]` | 已修（`533bad1`） | `store-db.js` | 单元测试 |
| `story_status` | 看不到计划是否确认 | 只返回章节/审稿 | 返回 `outline.writtenAt/approvedAt` | 已修（`76c072d`） | `store-db.js` / `tools.js` | 单元测试 |
| 面板确认 | 确认后自动写正文 | 确认按钮内 `face.send` | 确认只落库；动作按钮填输入框 | 已修（`b75d44c`） | `client.js` | E2E/手工 |
| 动作按钮 | 需复制/手打 | 只提示不写入或直接发送 | 明确“填入输入框”，保留作者补充 | 已修（`b75d44c`） | `client.js` | E2E |
| consistency | 角色词/对白片段被当人名，整章重写 | 全局词表硬阻断 | warning；人物卡权威；删除硬词表依赖 | 待修（#21） | `facts.js` / `landing.js` | warning 测试 + 真实首章 |
| delegate | 三次 writer 失败 | 误报被当正文有罪 | 不因 warning 重试；失败分类 | 待修（#21） | `delegate.js` / skills | 会话回归 |
| 上下文 | 主会话 2.87M tokens | 失败重写 + 历史累积 | 取消误报重写；新会话；预算 | 待修（#21） | 编排/测量文档 | 测量 |

## 已交付节点修复

截至 2026-10-20，节点错误中以下修复已提交，本文保留它们作为对拍/回归依据，不把它们当作未修缺陷：

- `533bad1`：确认全书计划后 `story_next` 不再误报 `outline`；
- `76c072d`：`story_status` 返回 `outline.writtenAt/approvedAt`；
- `b75d44c`：确认全书计划/章纲不自动发送，动作按钮填入输入框；
- `845a4c0`：明确 `artifact.path` 是虚拟路径，禁止 `read/grep` 作品库。

上述提交的回归仍需并入 #21 的最终验证；未完成的行为以本 Note 提案为准。
## 提案

### 1. 一致性：warning，不是 gate

- `checkDraft` 不再抛 `consistency-violation`；未登记人名、地名、尺寸都进 `warnings`；
- `story_write` / `story_revise` 正常落盘，回执带 warning；
- 删除 `ROLE_NOUNS` / `DIALOGUE_STOPS` 及其过滤；不再保留“可选词表过滤”，避免继续维护无法穷举的清单；
- 人名权威是作品角色卡、别名、已确认正文说话人；
- reviewer / `story_review` 承接“这是新人物还是称谓”的判断；
- warning 是主编可见的回执；作者是否看到取决于主编汇报。本项不新增 warning 持久化或面板 badge；审稿可重新判断正文里的人名。

### 2. 工作流：保留显式节点，不复制原子 pipeline

- 保留 `story_next` + 作者闸门 + 每动作事务；
- 增加“审稿 observation”语义：reviewer 的问题条目可以包含未登记人名，但不触发自动 revise；
- 草稿落盘、审稿、修订、状态仍分开；这符合作者控制，也避免把参考 pipeline 误读成自动重写；参考的 revise 是独立操作；
- 未来如果要做 StateValidator，单列工作项，不在本项里偷加。

### 2.1 清稿审稿（clean path）

参考目标允许 `observations: []`。当前 `writeReview` / delegate reviewer 把空清单当 `empty-review`，`story_next` 又要求修订，导致干净章节也必须制造一个问题再改一遍。

本项决定：

- `story_review` / delegate reviewer 允许 `items: []`，落一轮“清稿”审稿（记录“无问题”，不是不审）；
- `story_next` 对清稿审稿直接进入摘要/定稿，不要求 `story_revise`；
- 有问题的审稿仍按原流程修订；
- 清稿不是自动通过：作者仍可要求再审或改写；
- 阶段机必须同步：清稿审稿把章留在 `reviewed` 并记录“零问题”标志；`foldState`/`story_state` 接受 `reviewed + 零问题`，不能继续要求 `revised`；`story_next` 直接进入摘要/定稿；
- 不把清稿伪装成一次 `revise`，也不虚增版本。
- 清稿不再返回 `empty-review`；“审稿未覆盖当前版本”的既有错误是 `review-required`，不是 `empty-review`；`empty-review` 只保留给 reviewer 输出格式/空内容的真实错误。
### 3. 节点修复

- `story_init`/artifact schema 明确虚拟路径；
- 禁止 read/grep 作品库的人设与技能说明；
- `story_next` 的 `missing` 只表示真实缺失；
- `story_status` 返回 outline；
- 面板确认不自动发送，动作按钮填输入框；
- delegate 失败分类：不可用/超时/输出不合约才重试；warning 不重试。

### 3.1 技能与失败映射

- `storycraft-studio-orchestration`：删掉“自造人名会被拒收”“主编代写”文案；改为 warning + reviewer 判断；委派失败只在服务不可用/超时/输出不合约时重试。
- `storycraft-review`：未登记人名作为审稿观察，不直接退稿；清稿审稿允许无问题。
- `storycraft-write-craft`：不写“名字必须命中全局词表”；只提醒使用人物卡。
- `storycraft-longform-chapter`：清稿审稿后不能强制“审稿→修订→定稿”；允许 `reviewed + 零问题` 直接摘要/定稿，阶段机与技能同步。
- 错误映射：`delegation-unavailable`（无服务）、`delegation-failed`（启动/超时/非 completed）、`delegation-output-invalid`（标记/格式不合契约）、`delegation-word-range`（字数门）。审稿失败不新增“正文有罪”错误；按 delegate 失败返回，保留 `story_next` 的 review 步骤。
### 4. 文档材料

- 本 Note 作为对拍设计；
- 实施时只在既有 `proposed/pipeline/2026-10-18-storycraft-parity-matrix.md` 更新能力矩阵；`storycraft/` 文档只链接该表，不另建矩阵；
- Issue #21 记录范围、验收、评审证据；
- #19 保留委派实现，修正其一致性合同。

## 备选方案

- **继续扩全局词表**：无法穷举，误报一次整章重写；放弃。
- **照搬参考的 StateValidator/ContinuityAuditor**：当前没有同等 state/observation 模型，直接搬会引入新持久化；本项只对齐失败策略与人名权威。
- **整章全自动 pipeline**：与作者闸门和现有动作边界冲突；放弃。
- **把 warning 直接当错误**：重复本轮失败；放弃。

## 验收条件

本 Note 证明设计自洽；产品验收属于工作项 #21，不在此重复。

1. 能力矩阵由既有 parity-matrix Note 更新，包含长篇核心能力、差距和状态；
2. 工作流表把参考的 writer → review observation → persistence/state validation → persist 映射到当前动作，并标注保留/缺失/非范围；
3. 一致性设计明确：无全局词表硬判定，未登记人名 warning，清稿审稿可行；
4. 节点错误清单区分已交付修复与待修项，并给出 owner/验证方式。

## 风险

- 未登记人名不再硬拒，可能漏过自造人名；以 warning + reviewer + 作者补卡承接。
- 不做 StateValidator，状态矛盾仍可能漏；单列后续工作。
- 参考目标还有 forecast/同人/番外等能力，本项不覆盖，需在能力矩阵标非范围。
- 真实单章测量仍需新会话与干净作品；旧会话历史会污染测量。
