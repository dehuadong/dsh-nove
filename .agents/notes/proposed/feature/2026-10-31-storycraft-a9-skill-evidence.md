# Agent Note: 故事工坊：A9 技能加载证据

Status: proposed

工作项：当前任务 A9（不新建 GitHub issue）。产品范围与验收归本 Note。

## Problem

阶段技能、references 与 `skills/catalog.json` 已交付，`delegate.ts` 也按角色/形态选择技能，但没有任何可核对的加载证据：

- `story_context.trace` 只记上下文来源、预算与检索，不记技能；
- `story_delegate` 写出的 context trace 不记技能；
- architect/settler/validator 的提示也要求技能，但回执 trace 不记；
- 技能 id 与正文/reference 的对应关系只存在于代码分支和测试记忆里，无法从一次装配回读；
- 方法库的新增/删除依赖 catalog 与磁盘，缺少“映射到不存在技能”时的失败证据。

parity 矩阵的裁决是保留“子代理按提示自己 `skill`”，不复制 InkOS 的注入层；本项补的是 DSH 自有证据，不是运行时注入。

## 对拍参考

- `inkos-master/packages/core/src/...`：参考工程在 profile/动作结果中记 `skills-applied`，表示技能已被应用；
- `2026-10-18-storycraft-parity-matrix.md`「激活与证据」：参考注入并记 `skills-applied`；我们保留模型自行加载，补技能名存在性测试，不复制注入层；
- `2026-10-23-storycraft-skill-organization-v2.md` §5：宿主等价要求 `skill-evidence`（技能 id + revision）写入 ActionResult/trace，明确不复用 `skills-applied` 名字。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| Profile 注入技能并记 `skills-applied` | 记录宿主装配时要求子代理加载的技能 id + 内容 revision | DSH 子代理自行调 `skill`，宿主看不到实际加载 | 等价适配 | trace.skills |
| 运行时注入层 | 不新增注入层，保留子代理自行加载 | 不重复 DSH 已有能力，不改变现有角色边界 | 不采用注入 | 角色提示不变 |
| 技能应用记录 | `skill-evidence` 只写“请求加载”，不写“已应用” | 避免把装配证据冒充执行证据 | 收窄命名 | Note/字段说明 |

## Proposal

### 共享路由

新增 `src/skill-routing.ts`，成为角色/形态/步骤→技能与 reference 的**唯一**来源：

- `writer`：按 form 的 craft；
- `planner`：按 form 的 craft **加** method-reference 所属技能（`storycraft-long-plan`/`-short-outline`/`script-spec`），证据包含两者；
- `reviewer`：`storycraft-review` + review-dimensions；
- `reviser`：`storycraft-revise-craft`；
- `architect`：`storycraft-architect` **加** foundation-reference 所属技能（`storycraft-long-foundation`），证据包含两者；
- `settler`：`storycraft-state-settler`；
- `validator`：`storycraft-state-check`；
- `summarizer`：无技能（证据为空）。

`delegate.ts` 的 `writerSkills`/`plannerSkills`/`roleMethod` 改为从该模块导出（保留现有导出名）；`ROLE_META.skill` 删除，`promptFor` 改用路由；`store-db.ts` 的 `methodFor(step,form)` 改为调用同一 `methodForStep`，消除第三份映射。

### 证据

新增 `skill-evidence`：

- 先校验 id 属于 `skills/catalog.json`；再按 `skills.ts` 的目录解析读取 `skills/<id>/`；
- 对 `SKILL.md` 与 references 的相对路径（统一 `/`）和内容排序计算短 sha256 revision；
- 返回 `{ id, revision }`；技能不在 catalog、目录缺失或文件不可读时抛 `skill-missing`，不静默省略；
- `skillEvidence(ids, options?)` 接受可选 root 供测试注入，生产默认包根，避免测试改真实技能树。

`ContextTrace` 增加**必填** `skills: Array<{ id, revision, stage? }>`（所有 context trace 字面量同步；共享 `TRACE_OUTPUT` 才保持可选）：

- `assembleRoleContext` 按 role/form 写入；summarizer 为 `[]`；
- `story_context.trace.skills` 返回并声明；`story_delegate` 写出的 context trace 自动带；
- `delegateArchitect` 在写入 trace 的 `try` **之前**计算证据，`skill-missing` 直接中止派发，不被诊断 try 吞掉；
- `state-settle` 只记录实际请求的 stage：settler 必有，validator 仅在 semantic check 被调用时追加；`state-check` 记 validator；stage 字段区分，避免为未发生的 validator 作证；
- `ContextTrace` 由 `validateChapterTrace` 的严格 allowlist 持久化，必须同步 `artifact-contract.ts` 和契约测试；`store-db` 的写入路径一并覆盖；
- 共享 `TRACE_OUTPUT` 的 `skills` 保持可选，`story_brief` 不要求该字段。

字段只表示“宿主要求加载”，不表示子代理已经调用 `skill`；不记录正文全文，只记录 id/revision。

## Alternatives considered

**A. 只做测试，不写 trace。** 最强理由是零运行时成本。否决原因：作者和后续 Agent 无法从一次装配回读实际要求的技能，测试也只能证明代码映射，不能留下交付证据。

**B. 读 DSH 子代理的 skill 调用事件，记“已加载”。** 最强理由是最接近真实执行。否决原因：子代理事件只暴露工具调用，无法可靠区分 `skill` 参数与实际应用；且会把宿主证据变成对子代理行为的猜测。

**C. 只记技能 id，不记 revision。** 最强理由是简单。否决原因：技能正文/references 改动后无法判断两个批次是否用了同一方法版本。

**D. 复用 `skills-applied` 名字。** 最强理由是与参考字段同名。否决原因：语义不同；我们只记请求加载，不记应用，沿用会误导。

## Acceptance criteria

1. `skill-routing` 为 writer/planner/reviewer/reviser/architect/settler/validator 返回正确技能与 reference；writer 按 form 返回 craft；planner 返回 craft + method-reference 技能；architect 返回 architect + foundation-reference 技能；summarizer 为空；`store-db.methodFor` 不再有独立映射；
2. 每个映射的技能在 catalog 中存在且目录可读；revision 是 `SKILL.md` + references 的稳定内容哈希（路径统一为 `/`）；改动任一文件 revision 变化；planner 的 chapter-plan、architect 的 foundation-design 改动必须改变对应证据；
3. `story_context.trace.skills` 对四种可查询角色返回 `{id,revision}`；`story_delegate` 的 context trace、architect trace、settle/check receipt trace 也带技能证据；settle 只记录实际请求的 stage，validator 未被调用时不得出现；
4. 缺失 catalog 条目/目录/文件时派发失败为 `skill-missing`；architect 在 trace 诊断 try 之前失败，不得输出空证据后继续；
5. `artifact-contract.ts` 的 trace allowlist、契约测试、`story_context` 共享 `TRACE_OUTPUT`（可选）与 settle/check trace schema 同步；
6. 现有单元 + 29 E2E 通过；新增路由/证据/缺失/stage 测试；无 UI、无外部技能目录、无 `skills-applied` 字段。

## Risks

- revision 是内容哈希，不是供应商版本；相同内容不同格式会不同，这是预期；
- 只证明装配要求，不证明子代理实际调用 `skill`；命名与文档必须持续避免“已应用”的暗示；
- 技能目录读取发生在装配路径，需保持小文件读取，不扫描 references 正文进入 prompt；
- schema/回执增加字段会让 trace 略大；只存 id 与短 hash。
