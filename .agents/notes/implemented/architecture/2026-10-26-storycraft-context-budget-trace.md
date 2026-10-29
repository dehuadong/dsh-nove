# Agent Note: 故事工坊：上下文 token 预算与持久化 trace（R12）

Status: implemented

## 问题

`story_context` 与 `story_brief` 曾按字符/字节预算（8000 字符、8192 字节），口径不同且无法换算成模型实际收到的 token；装配 trace 只存在于当次回执，落盘后查不到“这次为什么丢了检索段”。产物合同 v2 已定义 `trace` 字段与 `validateChapterTrace`，但没有生产者、校验器也未注册。

## 决定

### 1. 计数与预算

- 新增 `accounting.ts`：`estimateTokens` = CJK 字符 1 token、其余每 4 字符 1 token（向上取整），与参考实现同一公式；不引入 tokenizer（零依赖、离线安装），trace 的 `notes` 写明是估算值。
- 单位统一为 tokens。context 默认 8000、brief 默认 2600（等量于原先的字符/字节量），两个动作都接受可选 `budget`（正整数，缺失或非法回退默认值）。
- 可压缩段上限只属于 context：`state 600`、`recent 1000`、`retrieval 800`、`style 400`、`characters 600`、`volumeMap 800`。
- protected 段（权威/任务/硬约束/章纲/全书计划/正文/标准）**不设上限、永不压缩或丢弃**；只有 protected 自身超过总预算时才置 `overflow` 并写一条 `notes`。
- 裁剪顺序 `retrieval → recent → state → characters → volumeMap → style`：能压就压，压不进剩余预算就整段丢弃；一个段只会出现在 `trimmed` 或 `dropped` 之一。

### 2. trace 的合同与落盘

- 内容就是合同 v2 的 trace 字段：`chapter`、`plannerInputs`、`composerInputs`、`selectedSources`、`contextTiers`、`tokenBudget`、`retrieval`、`notes`、`trimmed`、`dropped`、`budget{limit,used,unit}`、`sections`、`missing`、`overflow`。
- R12 给合同加的增量：`sections[].chars/tokens/dropped/trimmed/reason`、顶层 `missing`/`overflow`；`budget.unit` 收敛为 `tokens`；校验器 `validateChapterTrace` 注册进 `ARTIFACT_CONTENT_VALIDATORS`，并校验 `content.chapter === scope.chapter`。
- `retrieval` 取合同形状 `{engine:'sqlite-fts5-bm25', query, selectionMode:'complete', candidates[{id,kind,source,score}], semanticSelectedIds}`；检索失败写进 `notes`。
- 只有实际发出的段进入 `selectedSources`/`contextTiers`/`tokenBudget`；`sections` 保留全部段（含被丢的）并标原因。
- artifactId `trace:<chapter>:<role>`（`writer|planner|reviewer|reviser|summarizer`），`kind:'trace'`、`scope.chapter` 必填；revisionId 是内容哈希，同内容重复装配幂等复用、不报错。
- 落盘只在**派发**时发生：`delegate` 启动子代理前写；`planner` 的章行由写 plan 时创建，所以它的 trace 在 plan 落库后写。`story_context`/`story_brief` 保持只读、面板 `/brief`（GET）与装配函数都不写；brief 的 trace 只在回执返回。
- 已定稿章节照常记录：`putArtifactOnDb` 的 `allowSettled` 对 `trace` 放开（与 `summary` 同理，trace 记录读取、不改章内容）。
- 读取面：`story_read` 的 `trace` 分支，规则与其他章节 artifact 一致——只能读当前章；跨章查看留给后续面板。
- 写入失败只吞掉、不影响派发：`delegate` 回执不带 trace，不为诊断信息污染派发回执。

### 3. identity 与回执

- `ARTIFACT_IDENTITY` 增加 `trace: /^trace:([1-9]\d*):(writer|planner|reviewer|reviser|summarizer)$/`；`remapChapterArtifacts` 对 trace 改章号段、同步 `content.chapter`、删除章节时一并删除（与 plan/summary/review 同一条 identity-change 例外）。
- `story_context`/`story_brief` 回执的 trace 与落盘用同一组数字；`story_context` 多一个动作专属 `review{round,revision}`。回执 `sections[].sourceIds` 不含 `works/` 路径（`sourceIdOf` 去掉作品前缀），保持 #22 的“模型不拿作品路径”。
- 回执与落盘 trace 的 `retrieval.candidates[].source` 保持合同字段名：`sanitizeOutput` 只把**虚拟路径**形态的 `source` 解析成 artifact id，已经是 id 的值原样保留。

## 备选方案

- **加 tokenizer 依赖**：零依赖、离线安装、模型可切换；否决，误差由预算余量吸收。
- **继续用字符、只加 trace**：#64 的目标就是 token 口径；否决。
- **在装配函数或只读动作里写**：面板 GET 与手动预览都会写库，还会迫使只读动作标 `mutates`（子代理守卫会拒）；否决，只在派发时写。
- **给 protected 段也设上限**：破坏“protected 永不丢”的既有契约，也让长正文成为常态超限；否决，超限只标记。
- **trace 只进回执不落盘**：跨会话查不到派发理由；否决。
- **语义重排/embedding**：等测量证明词法排序不够再做；本项不做。

## 后果

- 上下文与简报的预算现在是同一个估算口径，回执里能看到每段与分档的 token 数、以及哪些段被压/被丢；派发一次会在作品库里留下一条 trace（内容哈希去重）。
- 估算与真实分词有偏差（CJK 1:1），方向偏保守；拿到模型窗口后可以把默认值改成按窗口推导。
- protected 不设上限意味着长正文可以吃满预算并挤掉全部可压缩段；`overflow` 现在显性化，是否给正文设硬上限留给测量结果决定。
- 每次派发多一次 artifact 写入；暂不做保留期清理，内容哈希天然去重。

## 验证

- `tests/accounting.test.mjs`：估算公式、空串、混合文本与求和。
- `tests/context.test.mjs`：预算边界（恰好用满、非法回退）、可压缩段上限、裁剪顺序、protected 不被压/丢、`overflow` 仅由 protected 触发、`trimmed`/`dropped` 互斥、trace 的分档与总和一致。
- `tests/artifact-remap.test.mjs`：trace 写入、同内容幂等、内容变化产生新 revision、章节移动后 ID/`scope.chapter`/`content.chapter` 同步、删除后消失。
- `tests/delegate.test.mjs`：planner 派发在 plan 落库后留下 `trace:1:planner`。
- `tests/tools.test.mjs`：`story_context` 接受 `budget`；回执 trace 与落盘同形；`story_read` 只读当前章 trace；回执不含 `works/` 路径。
- `tests/bible.test.mjs`：brief 的 token 预算、回退、trace 与 `overBudget`。
- 全量：`ci.mjs` 52 个单元文件 + 19 条面板 spec 全过；`npm pack` 后装进临时 profile，DSH 启动、根页 200。
- 三章真实装配的数字（主会话工具参数/结果规模）由 #65 在真实链路记录。

- 交付证据：52 个单元契约文件与 19 条面板 spec 全过；tarball 装临时 profile 后 DSH 启动、根页 200；trace 的幂等、重编号、删除与只读作用域由单测覆盖；三章真实装配的测量数字由 #65 记录。
