# Agent Note: 故事工坊：统一技能 references 加载契约

Status: implemented

工作项：当前任务（不新建 GitHub issue）。统一所有带 `references/` 的技能正文的加载入口，修复“SKILL 说只读本技能、真正方法在 reference”的结构性缺口。

## Problem

`skill` 工具只加载 `SKILL.md`；`references/*.md` 不会被自动读取。若 SKILL 只说“字段/示例由 references 提供”，又不给相对路径和读取指令，模型就只拿到薄技能壳。

已确认的缺口：

| 技能 | 未显式提及的 references |
|---|---|
| `storycraft-architect`（原 `storycraft-long-foundation`） | `foundation-design.md`（3324 B） |
| `storycraft-long-plan` | `chapter-plan.md`、`chapter-plan-examples.md` |
| `storycraft-long-prose` | `reader-contract-and-progression.md`、`scene-dialogue-and-length-budget.md` |
| `storycraft-long-settle` | `state-projection.md` |
| `storycraft-short-outline` | `outline.md` |
| `storycraft-short-prose` | `production-checklist.md` |
| `storycraft-script-spec` | `spec.md` |
| `storycraft-script-scene` | `episode-scene-craft.md` |

`storycraft-long-director`、`storycraft-longform-chapter`、`storycraft-review`、`storycraft-revise-craft` 已提到 references，但格式不统一。

这不是单个技能写漏，而是“薄技能 + references”缺少加载契约。

## 对拍参考

- 参考工程 `inkos-master/packages/core/skills/inkos-long-writing/SKILL.md:24` 明确写：
  ```text
  Load `references/foundation-design.md` while creating or rebuilding a book foundation.
  ```
  它没有把“读哪个 reference”留给读者猜。
- 参考工程同一技能按节点列出 `foundation-design`、`reader-contract-and-progression`、`state-projection` 的读取时机。
- 本地 `src/delegate.ts:263-266` 已给子代理加“这一节点只读 <skill> 的 <reference>”提示；这是 **B2b 的单参考授权**：每个角色节点最多一个 reference。
- 本地 `src/skill-routing.ts:76-82`、`src/context.ts:508-516`、`src/skill-search.ts:142` 都只索引/注入一个 reference；本项不突破该合同。
- 本地 `src/skill-routing.ts` 的 `RoleMethod.reference` 只描述“这个方法文件”，不负责加载；技能正文必须自描述。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| SKILL 明确 Load reference | 每个带 references 的 SKILL 增加“资源”段 | references 不自动加载 | 采纳 | 静态测试 |
| 按节点说明读取时机 | 一个“必读”+其余“按需” | 与 B2b 单参考授权一致 | 等价适配 | 技能正文 |
| 方法在共享技能 | 保留现有技能归属 | 不改变角色/产物合同 | 不采用新结构 | 回归 |

## Decision

### 统一格式

每个带 `references/` 的 `SKILL.md` 增加**一个顶层** `## 资源` 段，放在 `## 用法` 之前；不得嵌套在其它 H2 下：

```markdown
## 资源

- 必读：`references/chapter-plan.md`
- 按需：`references/chapter-plan-examples.md`
```

规则：

1. 路径必须是 `references/<file>.md` 的相对路径；跨技能引用写成 `../<skill>/references/<file>.md`；
2. 所有 `references/*.md` 必须出现在该段，分类为“必读”或“按需”；
3. **每个技能最多一个“必读”**；有 `RoleMethod.reference` 的技能，必读必须等于该 reference（reviewer 的 `review-dimensions` 属于此类）；
4. 没有 `RoleMethod.reference` 的技能（longform-chapter、director、reviser）不得写无条件“必读”，全部列为“按需”并在行内注明条件；**architect 例外**：它虽无 `RoleMethod`，但 `foundation-design.md` 是其唯一产物方法，允许一个“必读”；
5. 删除“这一节点只读本技能”这类与 references 矛盾的句子；
6. 保持 `tests/skill-references.test.mjs` 的 ≤40 行技能壳上限；architect 是 68 行角色合同，不适用该上限。

### 各技能分类

- `storycraft-architect`：必读 `references/foundation-design.md`（无 `RoleMethod`，按规则 4 例外）；
- `storycraft-long-outline`：必读 `references/outline-design.md`；
- `storycraft-long-plan`：必读 `chapter-plan.md`；按需 `chapter-plan-examples.md`；
- `storycraft-long-prose`：必读 `scene-dialogue-and-length-budget.md`（当前 `RoleMethod` 引用）；按需 `reader-contract-and-progression.md`；
- `storycraft-long-settle`：必读 `state-projection.md`；
- `storycraft-short-outline`：必读 `outline.md`；
- `storycraft-short-prose`：必读 `production-checklist.md`；
- `storycraft-script-spec`：必读 `spec.md`；
- `storycraft-script-scene`：必读 `episode-scene-craft.md`；
- `storycraft-longform-chapter`：按需 `flow-details.md`（无 `RoleMethod.reference`，不设无条件必读）；
- `storycraft-long-director`：`creative-dialogue.md`、`dispatch-templates.md`、`reporting.md` 均按需；
- `storycraft-review`：必读 `review-dimensions.md`（`roleMethod('reviewer')` 的 reference）；
- `storycraft-revise-craft`：`deslop.md` 按需（deslop 模式）。

`reader-contract-and-progression.md` 不设为必读，是因为 B2b 已规定 writer 节点只授权 `scene-dialogue...`；如果后续要把它纳入 writer 上下文，需单独改 B2b，不在本项偷跑。

### 加载路径

- `skill` 工具返回 `<skill_resources> Base directory ...`；模型用它解析相对路径后 `read`；
- 不在 prompt 里写死安装目录；
- 子代理现有 `delegate.ts` 的“只读本节点 reference”提示保留，正好对应唯一“必读”；
- 主会话由 SKILL 资源段负责；“按需”资源不默认注入。

### 静态校验

扩展现有 `tests/skill-references.test.mjs`（不新建文件，保持 94 单元）：

- 遍历所有 `skills/*/references/*.md`；
- 每个 reference 必须在对应 SKILL 的 `## 资源` 段出现，且分类可解析；
- 每个列出的相对路径必须存在；
- 每个技能最多一个“必读”；
- 有 `RoleMethod.reference` 的技能，必读等于 `roleMethod` 的 reference；architect 例外，必读等于 `references/foundation-design.md`；
- 扫描 SKILL 正文中所有 `references/...` 字符串：
  - 同一句里点名了 `<skill>`（如“读 `storycraft-long-plan` 的 `references/chapter-plan.md`”）时，按该 skill 解析；
  - 没有点名 skill 时按当前技能目录解析；
  - 两种解析都必须命中真实文件；
- 按上述规则，`architect:9`、`longform-chapter:13`、`short-story:11`、`short-drama:11` 已点名目标 skill，不需要改写；`revise-craft:9` 也已点名 long-prose；真正需要修正的只有 `review:11` 的 `state-projection.md`（当前句点名 long-prose，但文件在 long-settle）；
- 有 references 的 SKILL 不得出现“只读本技能”且无路径的句子；
- 保持 40 行上限；architect 豁免（角色合同，68 行）。

### 更新旧规划

[2026-11-02-storycraft-foundation-skill-scope](../../rejected/feature/2026-11-02-storycraft-foundation-skill-scope.md)：

- 原“roles/cards 只加载 architect”“搬方法”不执行；
- 该篇转为 `rejected`（superseded by 资源归位 Note），不再作为实现合同；
- 资源归位与 planner 直读由 [基础设定资源归位与 planner 直读](../architecture/2026-11-02-storycraft-foundation-resource-relocation.md) 拥有；
- 两篇互相链接，避免重复实现。

## Testing

- `tests/skill-references.test.mjs`：13 个带 references 的技能各有一个 `## 资源`，所有文件被列出、路径存在、必读映射正确、body 路径可解析、40 行上限。
- `npm run verify-notes` 与完整 CI：94 单元 + 49 E2E 通过。

## Alternatives considered

**A. 把 references 内容全部内联进 SKILL。** 最强理由是模型一定读到。否决原因：references 是细节/示例，全部内联会让每次加载都变重；统一入口即可。

**B. 由宿主自动注入所有 references。** 最强理由是无需模型记得读。否决原因：违反 B2b 单参考授权，写作节点会看到计划/结算材料。

**C. 只改 `delegate.ts` 的 method 提示。** 最强理由是代码集中。否决原因：主会话直接调用、以及技能自身的“只读本技能”矛盾仍在；技能正文才是第一入口。

**D. 扩 B2b 允许每个技能多个必读。** 最强理由是 `long-prose` 的 reader-contract 也能进上下文。否决原因：这是独立的上下文预算/授权合同变更，超出本项；先用单必读修加载入口。

## Consequences

- 静态测试只能证明“写了路径”，不能证明模型真的读了；需要真实链路抽查；
- 一个必读不能覆盖所有方法；`reader-contract` 等按需资源仍可能被跳过，后续用独立 B2b 工单解决；
- 技能正文和 references 可能漂移；资源段只做入口，不复制正文；
- 40 行上限可能要求精简资源段描述，不能靠扩行解决。
