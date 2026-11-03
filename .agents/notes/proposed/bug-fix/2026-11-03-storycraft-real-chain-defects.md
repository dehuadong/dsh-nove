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

影响：初始伏笔的身份/状态口径（五态、幂等、搁置语义）没有进入子代理上下文；本次产物恰好是 11 条 `deferred`，但这是模型行为，不是阶段保证。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/architect.ts:27-73` | architect 的 foundation prompt 在代码里拼装，直接带 `pendingHooks`/`initialHooks` 与 `renderHooksProjection` 的投影结果；不依赖模型自行读文件 | 采纳"阶段 prompt 自带方法契约"；用运行时读取并内联 reference 文件实现，不复制参考的 prompt 文案 |
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

先定位再修，禁止凭猜测换字段。实施第一步用现有真实会话复现并记录三件事：`sessions` 服务是否可取、`activation.childId` 是否有值、`Session` 上真实的事件访问器名。

修法（按定位结果组合）：

1. 在 tool 层把 session 解析做成函数传入 `CallTelemetry`：优先 `ctx.get('sessions')?.get(id)`；回退 `ctx.get('agents')?.get(id)?.session`；两者都不可用时保持显式 `unavailable`，不伪造数字；
2. `callEvidence` 接受 resolver，并按真实 Session API 读取事件（`ownEvents` 存在则用，否则用实际访问器）；
3. `modelCalls` 计 assistant 消息数、`outputChars` 计 assistant 文本 + tool 参数（现有口径），`usageSource` 只由 usage 行决定；
4. 定位与修复分别留测试：resolver 命中时 `usageSource` 为 `session`/`partial`、`modelCalls>0`；resolver 缺失时仍返回 `unavailable` 且 `modelCalls=0`，不得抛错。

### 缺陷 3：architect 必读参考的确定性加载

- 新增 `src/skill-references.ts`：按 `role + stage` 给出必读参考清单。architect `foundation` 为 `storycraft-architect/references/foundation-design.md` + `storycraft-long-settle/references/state-projection.md`；`hooks` 手动阶段同样带后者；
- 加载器从包内 `skills/` 读取文件内容，按候选根解析（源码布局 `src/roles/architect` 与构建布局 `lib/index.js` 分别对应 `../../../skills` 与 `../skills`），命中即用；全部候选都找不到时抛 `StoryError('architect-reference-missing')`，不静默跳过；
- `architectPrompt` 增加 `## 必读参考（运行时已加载，直接遵守）` 段，逐份给出文件标题与正文；原"必须先读它"的提示改为"以下参考已加载，不要再自行查找"；
- 只作用于 architect 的 foundation/hooks 阶段；planner/writer/reviewer 的现有"读一份 reference"方式不变。

### 不改的部分

- 不新增/删除动作，不改 schema、错误码、回执字段；
- 不改 hooks 的五态语义与初始伏笔的 `deferred` 口径；
- 不把 `state-projection.md` 抄进 `foundation-design.md`；
- 不做通用的 skill 引用自动展开。

## Alternatives considered

**把 `state-projection.md` 的关键段落抄进 `foundation-design.md`（最快）。** 最强理由是零运行时改动、安装形态必然可用；但同一口径会在两份技能文件里各存一份，settler/validator 更新时必然漂移，且仍然只是"模型读了这一份"，无法保证阶段加载，故不采用。

**让 `skill` 工具加载技能时自动展开全部 `必读` 链接（通用）。** 最强理由是一次改动覆盖所有角色；但会改变所有技能的上下文体积、链接链可能递归、无法按阶段控制预算，影响面远超本缺陷，故不采用。

**只加输出校验：`bible:hooks` 种子不合 schema 就拒绝。** 最强理由是能挡住坏产物；但挡不住"模型没读参考、产出了 schema 合法但语义错误的伏笔"，且本次产物已经过 schema，故只能作为补充，不作为本项主修法。

**保持现状，靠提示词加强语气。** 最强理由是改动最小；但真实会话已经证明模型会跳过相对链接，语气不构成阶段保证，故不采用。

## Acceptance criteria

1. `story_read` 读 `bible:hooks` 返回可解析的 JSON 字符串，包含 `hookId` 与 `status`；同一真实作品复读不再出现 `[object Object]`；
2. 新增单元测试覆盖：结构化 bible 内容 → JSON；字符串 bible 内容原样；行窗口计数正确；
3. architect `foundation` prompt 包含 `foundation-design.md` 与 `state-projection.md` 的正文标记（如五态列表），且不再要求模型自行读取这两份文件；文件缺失时抛 `architect-reference-missing`；
4. 加载器在源码布局与 `lib/` 构建布局下都能解析到 `skills/`；加载器接受可选的 roots 覆写以便单测，build 后做一次真实解析断言；
5. 成功委派的回执在真实会话中满足：`childSession` 非空、`modelCalls >= 1`、`outputChars > 0`；provider 提供 usage 时 `usageSource` 为 `session`/`partial` 且 token 字段非空，provider 未提供时保持 `unavailable` 但不得把 `modelCalls` 记成 0；`story_status` 的 `callsWithUsage` 与之一致；
6. 既有 96 单元 + 49 E2E、`npm run verify-notes`、`node storycraft/scripts/ci.mjs --smoke` 全部通过；
7. 更新 E7 调用日志 Note 与 `2026-11-02-storycraft-architect-initial-hooks.md` 的验证记录；在 `2026-10-23-storycraft-longform-method-references.md` 标记 architect foundation 的阅读触发由"角色自行调用 skill 工具"改为"运行时注入"（部分替代），并互链本 Note；本 Note 随代码转 implemented。

验收 1 与 5 的后半段需要一次真实调用：作者在真实会话重跑一次 `story_delegate(architect, foundation)`，代理从会话日志与 `story_read`/`story_status` 回执取证据；不把这次真实运行计入开发测试，也不要求作者重复多次。

## Plan Review

- Standards：与 E7 调用日志的字段与写入点一致（只修数据来源，不新增字段）；与初始伏笔 Note 的 `deferred` 口径一致；与长篇方法参考 Note 的阅读触发存在一处有意部分替代，已列入验收 7。
- Spec：范围、非目标、失败行为与验收可观察；真实运行依赖已写明，不把真实模型测试混入开发测试。
- Architecture：新增 `skill-references` 作为唯一"阶段→必读参考"路由，architect prompt 消费；telemetry 通过 resolver 注入，不改变 `model_events` schema；无循环依赖。
- 结论：通过，进入实施需新的 implement 授权。

## Risks

- **定位不充分的 telemetry 修复**：先复现再改；若两者都不可用，必须保留显式 `unavailable`，不得用 0 冒充成功；
- **注入参考抬高 architect prompt 体积**：foundation 两份参考约 5.8 KB（约 1.5k tokens），每次 foundation 调用增加固定成本；接受该成本，若后续阶段不需要则不注入；
- **文件路径在打包形态失效**：用候选根 + 缺失即抛错，并在 `--smoke`/build 后验证；pack-check 已覆盖 skills 文件；
- **结构化 JSON 让 hooks 读取变长**：11 条 hooks 约数 KB，读取按需发生；行窗口仍可截断；
- 修复后真实会话需要再跑一次 foundation 才能验证 telemetry 与参考注入，模型行为仍可能波动，验收只锁定"阶段保证"与"读取/回执事实"。
