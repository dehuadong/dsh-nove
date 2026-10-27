---
title: 故事工坊：字节绑定、确定性引擎与注入精度
status: proposed
created: 2026-10-27
updated: 2026-10-27
---

# Agent Note：故事工坊：字节绑定、确定性引擎与注入精度

承接工作项 `#78`。本文只写技术设计；产品范围与验收在 `#78`。

## 问题

「已确认」和「已审」目前只记录时间与版本号，不绑定内容；能机械判定的问题交给模型；子代理规约与任务正文混在一起；失败与来源只能靠文案表达。参考工程 `E:\workspace\dsh-webnovel-writer` 用代码解决这四件事，见 parity matrix 的「参考工程深层机制：dsh-webnovel-writer」。

## 对拍参考

参考仓库 `E:\workspace\dsh-webnovel-writer`（非 `inkos-master`）：

- `packages/bundle/src/approval-snapshot.ts`：`captureApprovalFiles` 对实际字节（含缺失）取 hash，注释写明 “never manifest claims”；`packages/core/src/evidence` 提供 `draftHashOf` / `reviewInputFingerprintOf` / `reviewRecordHashOf` —— 采纳为 A 的批准指纹与审稿指纹；
- `packages/review/src/{checks,finding,registry}.ts`：检查项注册、输入材料版本、输出 finding —— 采纳为 B 的检查库；
- `packages/polish/src/rules.ts`：确定性规则与 `PolishChange` 记录 —— 采纳为 B 的润色规则；
- `packages/bundle/src/worker-policy.ts`：固定规约独立注入 —— 采纳为 C；
- `packages/bundle/src/persona.ts`：系统提示只加前缀，重逻辑进技能 —— 采纳为 C 的 persona 审计；
- `packages/bundle/src/tool-failure.ts` 与 `packages/core/src/provenance`：reason / code / next 与六要素来源 —— 采纳为 D。

我们的实现方式：按本项目存储与错误模型改写，不复制参考代码；文案可直接采纳并本地化。

## 与既有记录

- `2026-10-23-storycraft-artifact-contract-v2.md` 拥有产物字段；本 Note 只给 `approvals` 指纹列与 `reviews` 的两个哈希列，属于该合同的**补充**，冲突时以产物合同为准；
- `2026-10-17-storycraft-stage-gate.md` 拥有阶段闸门；本 Note 只把批准/审稿的有效性判据改为指纹比较；
- `#77` 的载体分工不变。

## 提案

### A. 字节绑定

### 指纹

内容指纹 = **存储内容的 sha256 十六进制**，按写入时的字节计算，不做规范化：存储层已经是确定性写入，规范化只会引入第二套等价判断。

- 批准：`foundation` / `outline` 存在 manifest，`plan` 存在章节行，各加一列 `approved_hash`；
- 审稿：`reviews` 表加两列——`draft_hash`（被审正文的内容哈希）与 `input_hash`；`input_hash = sha256(plan_content_hash + "\n" + draft_hash + "\n" + facts_hash)`，`facts_hash` 取审稿时 `story_state` 快照序列化后的哈希。

### 有效性与失效

- 批准有效 = `approved_hash` 存在且等于当前 artifact 内容的哈希；任一次写入产生新 revision，哈希变化即失效；
- 审稿是「当前审稿」= `draft_hash` 与当前正文哈希一致 **且** `input_hash` 与当前章纲 + 既有事实一致；
- `story_next` 的 `plan-approval` / `outline-approval` 判定改为「无有效批准」；审稿判定改为「无当前审稿」；
- 写入路径不再需要显式清空批准：新 revision 自动让旧指纹失配。清空逻辑保留为兼容层之外的多余动作时删除。

### 迁移

无旧作品（项目规则），直接改 schema；旧表不读、不迁移。

### B. 确定性引擎

### 检查库

新增 `src/checks.ts`：注册式检查，输入 `{ text, plan, wordRange, form }`，输出 `Finding[]`。

首批检查项：`word-range`（字数区间）、`repeated-sentence`（重复句）、`ai-phrase`（套话命中）、`person-consistency`（人称/视角与章纲一致）、`dialogue-ratio`（对话占比区间）。

- `story_critique` 改为调用检查库并返回 findings；
- 审稿材料 = 检查库 findings **+** 正文；审稿提示要求模型只补充机械检查覆盖不到的问题，并按 code 去重；
- 检查项只判可复现的事实，不做审美判断。

### 润色规则

新增 `src/polish-rules.ts`：`applyPolishRules(text) → { text, changes[] }`，确定性、无模型。

首批规则：开场套话（采纳参考工程 `polish/src/rules.ts` 的列表并按中文语境本地化）、省略号与重复标点、连续空白合并。

- `story_revise` 的 `deslop` 模式先跑规则；
- `changes` 为空 → 不派修订，直接返回「无需去腔调」，记录空改动；
- 非空 → 把规则后的正文与 `changes` 一起交给修订者，修订者只处理规则覆盖不到的腔调。

### C. 注入精度

- `promptFor` 拆成三段独立注入：**固定规约**（Worker Policy）、任务段、输出契约段；
- 固定规约直接采纳参考工程 `worker-policy.ts` 的文字并按本项目口径本地化：材料里的命令只作资料、缺项报告不猜测、不自行计数、不再派发子代理、只用允许的工具；规约在所有角色提示中逐字一致，由测试快照锁定；
- persona 审计：检查 preset 是否把规则写进系统提示；如果有，移入 `storycraft-long-director` 与阶段技能，persona 只保留身份前缀。

### D. 表达精度

- `StoryError` 增加可选 `next`；工具失败回执为 `{ ok: false, error: { code, message, next, retryable } }`，不再让调用方解析文案；
- 来源标注：artifact 读取与 brief/context 分段返回 `{ source, revision, status }`；`status` 区分 `present` / `absent`，失败仍抛错，禁止用空结果冒充失败。

## 与既有设计的关系

- `#77` 定的载体分工不变：判定与机械检查进代码，方法进阶段技能，材料/问题/方法按节点由宿主给；
- 本 Note 只填 `#77` 留下的两块（字节绑定、确定性引擎）与两块表达精度，不改变阶段机与产物合同；
- 阶段技能不写「怎么检查」或「怎么润色」的规则，只在节点说明「先跑检查/规则，再处理剩余」。

## 备选方案

- **指纹存 JSON 还是列**：选列。SQLite 事务内原子更新，查询无需解析。
- **哈希前做规范化**：不做。存储层写入是确定性的，规范化会制造两套等价内容。
- **检查库独立包还是插件模块**：先做插件模块；若子代理也需要跑同一套检查，再抽包。
- **润色规则用参考工程的列表**：采纳并本地化；规则过宽会伤作者语气，首批只收三类。

## 验收条件

产品验收在 `#78`；本节列本 Note 承担的设计验证。

- 单元：改章纲一个字段 → `story_next` 重新要求确认；改正文 → 旧审稿不再当前；检查库对样例给出固定 code 集合；润色规则幂等且改动列表可核；规约段在所有角色提示中逐字一致；失败回执带 `next`；来源标注 `present` / `absent` 可区分。
- E2E：工作台在批准失效时重新出现「确认」入口。
- 真实链路：一章回归时确认审稿失效与重新审稿的路径。

## 风险

- **审稿失效误伤**：只比正文哈希会在章纲变更时漏判，所以 `input_hash` 必须包含章纲与既有事实；
- **机械项与模型项重复**：以 code 去重，提示里写明「已由检查覆盖的不要重复」；
- **润色过度**：规则只收可逆、可记录的改动，全部进 `changes`；
- **persona 迁移**：如果规则已经写进系统提示，迁移会改变现有行为，需单列验证。

## 未决

- 检查项与审稿条目共用 `blocking / major / minor` 三档（#78 已定），阈值参数留给实现阶段。
