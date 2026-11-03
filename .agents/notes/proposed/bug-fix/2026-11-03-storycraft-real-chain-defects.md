# Agent Note: 故事工坊：真实链路三处缺陷修复

Status: proposed

工作项：当前任务「真实链路缺陷修复」。产品范围与验收归本 Note；实现完成后随代码转入 implemented。真实会话 `session-4604579f-a577-4ea1-88a1-51d867f3d7b6`（workspace `E:\novelist\N003`）的立项记录是本项的触发证据。

## Problem

R3 结构与安装验证通过后，真实链路第一次跑立项（propose → init → foundation）暴露三处缺陷。它们都不影响"能写"，但都会让作者或后续角色拿到错误信息。

### 1. `story_read` 读 `bible:hooks` 返回 `[object Object]`

真实结果：

```json
{"artifactId":"bible:hooks","revisionId":"eded7f0a4d5b","kind":"hooks",
 "content":"[object Object]","startLine":1,"endLine":1,"totalLines":1}
```

`story_read` 的 `bible` 分支默认走 `readTextArtifact`，随后 `String(read.artifact.content)`（`src/tools/actions/index.ts`）。`bible:hooks` 的产物内容是对象数组，`String()` 把它压成 `[object Object]`。`roles:index`、`role:<slug>` 已经用 `JSON.stringify`，只有 hooks 等结构化 bible 条目走错分支。

影响：architect 复核、面板详情、真实链路验收读初始伏笔时全部看到坏值；`story_read` 的"按 artifactId 读取"契约对 hooks 不成立。

### 2. 委派 telemetry 全空

真实结果：

```json
{"durationMs":247867,
 "usage":{"inputTokens":null,"outputTokens":null,"totalTokens":null,
          "cacheReadTokens":null,"cacheWriteTokens":null,
          "usageSource":"unavailable","modelCalls":0,"outputChars":3,
          "model":null,"provider":null}}
```

同一次 `story_status`：`callsWithUsage:0`、`callsWithoutUsage:1`、`usageComplete:false`。

`callEvidence` 只有在拿不到 child Session 时才走 fallback（`outputChars` 取 `result.output`，`modelCalls` 保持 0）。这说明 `activation.childId` 或 `sessions.get(childId)` 至少一处没有命中；即使拿到 Session，`ownEvents()` 也不是已确认的公开方法。结果是 E7 的调用日志字段在真实链路下不可用。

### 3. architect 阶段必读参考没有确定性加载

子代理实际读了 `skills/storycraft-architect/references/foundation-design.md`，但没有读它第 41 行指向的 `../../storycraft-long-settle/references/state-projection.md`。

代码现状：`architectPrompt` 只有一句"方法参考是 `references/foundation-design.md`，提交前必须先读它"；`skill-routing.ts` 的 `roleMethod('architect', …)` 返回 `undefined`，architect 阶段没有任何 reference 进入运行时路由；`prompt-kit` 对其它角色也只发"去读"的提示，不读文件内容。是否加载完全由模型决定。

影响：初始伏笔的身份/状态口径没有进入子代理上下文；本次产物恰好是 11 条 `deferred`，但这是模型行为，不是阶段保证。

实施评审还发现：初版方案让 architect foundation 注入两份参考，与已实现决定 [统一技能 references 加载契约](../../implemented/process/2026-11-02-storycraft-skill-reference-loading.md)（单必读）及 [B2b 检索授权](../../implemented/feature/2026-10-31-storycraft-b2b-context-skill-retrieval.md)（每节点一个 reference）冲突。解决方案不是改这两条合同，而是修正 `foundation-design.md` 的边界：初始伏笔的**种子契约**归 architect 参考，运行期五态归 `state-projection.md`，architect 阶段只注入一份。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/architect.ts:27-73` | architect 的 foundation prompt 在代码里拼装，直接带 `pendingHooks`/`initialHooks` 与 `renderHooksProjection` 的投影结果；不依赖模型自行读文件 | 采纳"阶段 prompt 自带方法契约"；用运行时读取并内联**一份** reference 实现，不复制参考的 prompt 文案 |
| `inkos-master/packages/core/skills/inkos-long-writing/SKILL.md:24` + `references/foundation-design.md:19` | 每个节点只 Load 一份 reference；`foundation-design.md` 自带 `## Initial hooks`，不跨技能链接状态投影 | 采纳：architect foundation 只注入 `foundation-design.md`；把种子契约收回该文件，运行期五态仍归 `state-projection.md` |
| `inkos-master/packages/core/src/state/state-projections.ts` | hooks 的持久化是结构化记录，读取/展示经 `renderHooksProjection` 渲染成文本，不让对象直接落进字符串 | 采纳"结构化与文本分开"；`story_read` 对结构化内容输出 JSON |
| `inkos-master/packages/core/src/llm/pi-stream`（`pi-stream.test.ts:245`、`678`） | provider 流里的 `usage` 被映射为 `tokenUsage` 并随调用落库 | 采纳"usage 来自 provider/session 事实"；不伪造缺失值 |
| 我们的 `bible:hooks` 读取 | 无参考实现（InkOS 无 `story_read` 文本读取动作） | 无参考实现；按本仓 artifact 读取契约修复序列化 |

检索范围：`inkos-master/packages/core/src/{agents,state,studio}` 与 `inkos-master/packages/studio/src` 中未找到按 artifactId 返回文本内容的读取动作；InkOS 的读取是内部投影与 Studio API，不是本项目的 `story_read`。故这一项按本仓契约处理，不假称有参考实现。


## Proposal

### 缺陷 1：结构化 bible 条目的读取

- `story_read` 的 `bible` 分支在拿到 `read.artifact.content` 后统一归一化：字符串原样返回，其它值 `JSON.stringify(value, null, 2)`；
- 行窗口（`startLine`/`lineCount`/`totalLines`/`hasMore`）在这段字符串上继续生效，不改返回 schema；
- 该归一化只覆盖 `bible` 分支；`trace`/`plan`/`summary`/`roles`/`role` 已显式 JSON 化，不动。

### 缺陷 2：委派使用证据的解析链

定位结论（单测复现）：one-shot child 完成后会被 session store 释放，`sessions.get(childId)` 在 record 时已拿不到；必须在 `startActivation` 之后立即捕获 Session 对象，并在 record 时作为首选。若存储确实不可用，回退到 `agents.get(childId).session`。

修法：

1. `DelegateHost`/`CallTelemetry` 只增加一个 `resolveSession?: (id) => any`，由 tool 层构造（`sessions.get` → `agents.get(id).session`），不再把 `sessions`/`agents` 两个字段散落到各 host；
2. `child-run` 在启动后调用 `resolveSession` 捕获 Session，record 时优先使用捕获值，其次再解析一次；
3. `callEvidence` 接受 Session 对象，按 `ownEvents` → `events` → `snapshotEvents` 读取事件；没有事件历史但拿到 dispatch output 时，`outputChars` 回退到 `result.output`，`modelCalls` 保持 0；
4. `modelCalls` 计 assistant 消息数、`outputChars` 计 assistant 文本 + tool 参数，`usageSource` 只由 usage 行决定；
5. 测试覆盖：Session 被 store 释放但 agent registry 仍持有、`events()` 访问器、无事件历史回退、resolver 缺失时显式 `unavailable` 且不抛错。

### 缺陷 3：architect 必读参考的确定性加载（单参考）

- 修正 `skills/storycraft-architect/references/foundation-design.md`：把初始伏笔的**种子契约**写全——身份是 `text` 的精确文本、`hookId` 稳定且本次唯一、提交不带 `status`/起始章、宿主把种子置为 `deferred`、后文不得换措辞；运行期五态与转移用一行链接指向 `state-projection.md`，不复制全文；
- 新增 `src/skill-references.ts`：architect `foundation` 与手动 `hooks` 阶段都只列 `storycraft-architect/references/foundation-design.md` 一份；加载器从 `skills.ts` 的 `SKILLS_ROOT` 读取（复用既有事实属主），缺失抛 `StoryError('architect-reference-missing')`；
- `architectPrompt` 增加 `## 必读参考（运行时已加载，直接遵守）` 段并列出实际参考；其余阶段恢复原文"提交前必须先读它"，不改 planner/writer/reviewer 的加载方式；
- `state-projection.md` 增加一句边界：初始种子的身份/状态由 architect 参考定义，本文只负责运行期五态；不重复定义种子字段。

### 不改的部分

- 不新增/删除动作，不改 schema、错误码、回执字段；
- 不改 hooks 的五态语义与初始伏笔的 `deferred` 口径；
- 不把运行期五态全文抄进 `foundation-design.md`；只把种子契约的几条不变量收回该文件；
- 不改 B2b 的检索单参考与加载契约的单必读；
- 不做通用的 skill 引用自动展开。

## Alternatives considered

**把 `state-projection.md` 的关键段落抄进 `foundation-design.md`（初版备选）。** 最强理由是零运行时改动、安装形态必然可用；初版以"两份文件各存一份、settler 更新必然漂移"为由否决。修订后只抄**种子契约**的几条不变量（种子不带 status、宿主置 deferred、身份=text），运行期五态仍在 `state-projection.md`，因此不再构成口径双份。

**允许 architect foundation 注入两份参考（初版方案）。** 最强理由是确定性最高、完全复用 `state-projection.md`；但违反已实现的 B2b 检索单参考与加载契约的单必读，且需要改动两条既有合同来支持一个新缺陷，故放弃；改为让 `foundation-design.md` 自包含种子契约。

**修改 B2b/加载契约，允许节点多参考。** 最强理由是一次解决所有"方法文档互相链接"的情况；但这会改变检索预算与角色授权合同，影响面大于本缺陷，故不在本项内做。

**让 `skill` 工具加载技能时自动展开全部 `必读` 链接（通用）。** 最强理由是一次改动覆盖所有角色；但会改变所有技能的上下文体积、链接链可能递归、无法按阶段控制预算，故不采用。

**只加输出校验：`bible:hooks` 种子不合 schema 就拒绝。** 最强理由是能挡住坏产物；但挡不住"模型没读参考、产出了 schema 合法但语义错误的伏笔"，且本次产物已经过 schema，故只能作为补充，不作为本项主修法。

**保持现状，靠提示词加强语气。** 最强理由是改动最小；但真实会话已经证明模型会跳过相对链接，语气不构成阶段保证，故不采用。

## Acceptance criteria

1. `story_read` 读 `bible:hooks` 返回可解析的 JSON 字符串，包含 `hookId` 与 `status`；同一真实作品复读不再出现 `[object Object]`；
2. 新增单元测试覆盖：结构化 bible 内容 → JSON；字符串 bible 内容原样；`startLine`/`lineCount` 窗口与 `totalLines` 正确；`outline` 分支保持原行为；
3. architect `foundation` prompt 只含一份参考 `foundation-design.md`，包含种子契约标记（`hookId`、`deferred`、不写 `status`），不包含五态全文，也不再要求模型自行读取参考；文件缺失时抛 `architect-reference-missing`；
4. 加载器复用 `skills.ts` 的 `SKILLS_ROOT` 单根；源码布局与 `lib/..` 布局解析到同一目录，有测试断言；不新增第二套包根推导；
5. 成功委派的回执在真实会话中满足：`childSession` 非空、`modelCalls >= 1`、`outputChars > 0`；provider 提供 usage 时 `usageSource` 为 `session`/`partial` 且 token 字段非空，provider 未提供时保持 `unavailable` 但不得把 `modelCalls` 记成 0；`story_status` 的 `callsWithUsage` 与之一致；
6. 既有全部单元 + 49 E2E、`npm run verify-notes`、`node storycraft/scripts/ci.mjs --smoke` 全部通过；
7. 更新 E7 调用日志 Note、`2026-11-02-storycraft-architect-initial-hooks.md` 与加载契约的验证/边界记录；doc 收口已完成（`2026-10-23-storycraft-longform-method-references.md` 已归档，资源归位 Note 已标部分替代），实施时只补本项验证结果；本 Note 随代码转 implemented。

验收 1 与 5 的后半段需要一次真实调用：作者在真实会话重跑一次 `story_delegate(architect, foundation)`，代理从会话日志与 `story_read`/`story_status` 回执取证据；不把这次真实运行计入开发测试，也不要求作者重复多次。

## 修订记录（2026-11-03）

实施评审（Standards + Spec）后的修订：

- **合同冲突**：初版两参考注入与 B2b/加载契约冲突；改为「`foundation-design.md` 自包含种子契约 + 单参考注入」，不改两条既有合同；
- **缺陷 1 越界**：`outline` 分支已恢复原 `String()`，归一化只覆盖 `bible`；测试补了文本透传与行窗口；
- **缺陷 2 访问器**：`callEvidence` 增加 `ownEvents` → `events` → `snapshotEvents` 回退，并在无事件历史时回退 dispatch output；Session 捕获提前到 `startActivation` 之后（store 释放后仍可读）；
- **事实重复**：`skill-references` 复用 `skills.ts` 的 `SKILLS_ROOT`，单一根；测试去掉硬编码绝对路径并验证 `lib/..` 同根；
- **文档收口**：`2026-10-23-storycraft-longform-method-references.md` 已归档；`skill-organization-v2`、资源归位 Note、加载契约、交付盘点已更新，`verify-notes` 110 篇通过（独立 docs 提交）。

## Plan Review

- Standards：单参考与 B2b/加载契约一致；种子契约归 architect 参考、运行期五态归 `state-projection.md`，符合一个事实一个家；文档替代链已闭合。
- Spec：范围、非目标、失败行为与验收可观察；真实运行依赖已写明；缺陷 1 只覆盖 `bible` 分支，缺陷 3 只注入一份。
- Architecture：`skill-references` 是唯一"阶段→参考"路由，复用 `SKILLS_ROOT`；telemetry 用单个 `resolveSession` 注入，不把 `sessions`/`agents` 散到各 host；不改 `model_calls` schema。
- 结论：通过，进入实施需新的 implement 授权。

## Risks

- **telemetry 捕获假设**：捕获依赖 `startActivation` 后的 Session 对象；若 host 在启动返回前就释放，仍需回退 `agents`。真实会话验收必须覆盖；
- **参考注入的固定成本**：foundation 只多约 2.8 KB（约 0.7k tokens），可接受；不扩展到其它阶段；
- **种子契约的边界**：只写种子不变量，不复制运行期五态；`state-projection.md` 必须保留"初始种子由 architect 定义"的一行，防止双份；
- **文件路径**：单根来自 `SKILLS_ROOT`，缺失即抛错；`--smoke`/pack-check 覆盖 skills 文件；
- **结构化 JSON 让 hooks 读取变长**：11 条 hooks 约数 KB，读取按需发生；行窗口仍可截断；
- 修复后真实会话需要再跑一次 foundation 才能验证 telemetry 与参考注入，模型行为仍可能波动，验收只锁定"阶段保证"与"读取/回执事实"。
