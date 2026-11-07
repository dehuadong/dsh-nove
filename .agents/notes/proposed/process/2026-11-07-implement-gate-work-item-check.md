# Agent Note: implement-gate：work-item-check 与 return-to-discuss

Status: proposed

工作项：修正 `tools/implement-gate` 的进入/返回规则，使 `discuss` 可以分支到 `planning` 或直接 `implement`，并在实现中允许回到 `discuss`。

## Problem

当前 Gate：

- `implement` 命令可直接从 `discuss` 进入，符合分支流程；
- 但实现中遇到范围外问题，`phase` 一直停在 `implement`，无法写 proposed Note 或回到讨论；
- 没有 proposed Note 也能 implement，导致“无规划开工”；
- `proposed` 路径被当成特殊拦截，文档治理/笔记也被卷进工作流。

不能简单要求“所有 implement 必须有 proposed”：Skill 允许机械小改不写 Note，GATES 也允许工作已充分定义时直接 implement。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `see-dsh-novel/docs/agents/GATES.md:37-43` | 范围内修正返回负责步骤；范围/合同变化回 Discuss，再重新授权 | 复刻新增 `return-to-discuss`，不自动续授权 |
| `see-dsh-novel/.agents/skills/implement/SKILL.md:44-57` | Implementation Review 发现合同问题返回项目 gate；范围内修正继续 | Gate 允许 implement→discuss，planning/implement 仍分支 |
| 本仓库 `AGENTS.md#工程工作流` | discuss 后按 GATES 推进；不要求固定三步 | 不把 planning 设为 implement 的强制前置 |

## Proposal

### 1. implement 前置：工作项检查

`implement` 命令的 task 只有两种合法形态：

- `proposed:<topic>`：必须有同 topic 的 `proposed/` Note；
- `mechanical:<description>`：机械小改，不要求 Note。

其他：

- 若 task 能匹配一个 proposed Note topic，按 proposed 处理；
- 否则拒绝进入 implement，保持当前 phase，记录 `blockReason='work-item-required'`；
- 不查 `capabilities.yaml`，不引入项目级耦合。

### 2. `return-to-discuss`

新增 `implement_gate({ action: 'return-to-discuss', reason })`：

- 从 `implement`（或 `planning`）回到 `discuss`；
- 保留 task；
- 清 blockReason；
- 允许写 proposed Note；
- 不自动授予新范围。

### 3. 配置调整

保留：

- `codeExtensions`：识别代码文件；
- `protected`：marker/state 永远不可改。

调整：

- `proposed`：不再作为特殊代码路径；proposed Note 属于文档，discuss 也可写。配置键保留解析但忽略，避免旧 marker 立即失效；
- `codePaths`：默认改为空；需要拦 `package.json`/`tsconfig` 的项目自行声明，避免默认过度拦截；
- 文档、YAML/JSON、notes 不进入代码门禁。

### 4. 机械小改

- `mechanical:` 任务允许 implement，无需 proposed；
- `complete` 的 proposed 检查跳过 mechanical；
- 机械任务仍受代码写门禁，不能借 mechanical 改无关代码。

### 非目标

- 不查 capabilities.yaml；
- 不把文档治理纳入 planning/implement；
- 不自动把 proposed Note 转 implemented（仍由 Agent 完成）。

## Alternatives considered

**绝对要求 proposed。** 最强理由是简单；违反 Skill 机械小改免写规则与分支流程，故不采用。

**查 capabilities.yaml 作为工作项。** 最强理由是项目内精确；Gate 是通用插件，不能耦合产品账本，故不采用。

**保留 proposed 特殊拦截。** 最强理由是保护规划笔记；会把文档治理卷入工作流，故改为普通文档。

**删除所有配置，只靠 proposed。** 最强理由是简化；没有 codeExtensions 无法区分代码与文档，故保留。

## Acceptance criteria

1. `discuss` 可直接 implement（有 proposed 或 mechanical）；
2. 无工作项 implement 被拒绝，phase 不变，`blockReason=work-item-required`；
3. `mechanical:` 无 proposed 可 implement，complete 不要求 Note；
4. `return-to-discuss` 从 implement 回 discuss，保留 task；
5. proposed Note 在 discuss 可写（文档路径不再特殊拦截）；
6. `codePaths` 默认空，`proposed` 配置不再影响分类；
7. 测试覆盖上述分支与 complete 的 proposed/mechanical 行为。

## Plan Review

- Standards：分支流程、机械例外、文档绕行都对齐 GATES/Skill。
- Spec：进入、拒绝、返回、配置默认都可观察。
- Architecture：Gate 保持通用；项目能力账本不进入 Gate。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有 marker 含 `proposed` 与 `codePaths`，配置保留但语义变化；README 必须同步；
- 无工作项 implement 只记 blockReason，Agent 可能看不到；需要 status/README 提示；
- mechanical 可能被滥用，需在描述里要求具体范围。
