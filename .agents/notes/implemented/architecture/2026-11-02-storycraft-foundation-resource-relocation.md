# Agent Note: 故事工坊：基础设定资源归位与 planner 直读

Status: implemented

工作项：当前任务（不新建 GitHub issue）。把基础设定方法与全书计划方法按消费者归位，删除 `storycraft-long-foundation` 壳，planner 不再通过 architect 技能读 foundation。

## Problem

当前 `storycraft-long-foundation` 是 architect 和 planner 共用的“基础设定 + 全书计划”技能，但两类方法混在同一份 `references/foundation-design.md`：

- architect 需要：故事框架、世界、卷图、人物、角色索引/卡；
- planner `story_outline` 需要：全书计划三段、卷摘要、结局方向、初始伏笔；
- architect 不写全书计划，也不产初始伏笔；
- planner 不应加载 `storycraft-architect` 角色合同。

同时 `storycraft-long-foundation/SKILL.md` 只有 793 B，正文不加载 reference，真正方法在 `foundation-design.md`，形成空壳 + 孤儿资源。

## 对拍参考

- 参考工程 `inkos-master/packages/core/skills/inkos-long-writing/SKILL.md:24` 用一个共享技能，并按节点明确加载 `foundation-design.md`；本项目已选择 architect 与 planner 分角色，不能直接照搬单技能。
- 参考 `ArchitectOutput` 一次产出 storyFrame/volumeMap/bookRules/roles/pendingHooks；本项目 architect 不产 hooks，已登记为差异。
- 本地 `src/skill-routing.ts` 的 `story_outline` 当前指向 `storycraft-long-foundation`；`roleSkills('architect')` 也指向它。
- 本地 `tests/skill-references.test.mjs` 已把 `long-foundation` 和 `long-plan` 列为 stage skills，需同步改。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| 一个共享 long-writing | 按消费者拆 architect / outline | 角色合同与 planner 节点分离 | 等价适配 | 单元 |
| foundation-design 含全书计划 | foundation 只留基础设定；计划归 outline | architect 不做计划 | 采纳（本地结构） | 产物 |
| 按节点加载 reference | 两个技能各自的 `## 资源` | references 不自动加载 | 采纳 | 静态 |

## Decision

### 文件归位

```text
storycraft-architect/
  SKILL.md
  references/
    foundation-design.md        # 故事框架、世界、卷图、人物、角色索引/卡

storycraft-long-outline/        # 新增 planner 全书计划技能
  SKILL.md
  references/
    outline-design.md           # 全书计划三段、卷推进、结局、初始伏笔、动作边界

storycraft-long-plan/           # 保留：章纲
  SKILL.md
  references/
    chapter-plan.md
    chapter-plan-examples.md
```

- 删除 `storycraft-long-foundation/`（SKILL 与 references）；
- `foundation-design.md` 中“全书计划三段 / 初始伏笔 / 与动作的边界”移入 `outline-design.md`；
- `foundation-design.md` 只保留 architect 使用的部分；
- `outline-design.md` 接收“初始伏笔”后，其中 `state-projection.md` 的引用改为 `../storycraft-long-settle/references/state-projection.md`；
- 新增 `storycraft-long-outline/SKILL.md`，作为 planner 全书计划入口；
- 不新增宿主级 resource-only 协议：planner 通过 `storycraft-long-outline` 技能加载自己的 reference，不加载 architect。

### 路由

- `roleSkills('architect')` 只返回 `storycraft-architect`；
- `methodForStep('story_outline', longform)` 返回 `storycraft-long-outline` + `references/outline-design.md`；
- `story_plan` 仍返回 `storycraft-long-plan` + `references/chapter-plan.md`；
- `storycraft-long-outline` 不依赖 `storycraft-architect`；
- `storycraft-architect` 的 Resource 段指向自己的 `foundation-design.md`；
- 更新 `src/delegate.ts:675` 的 architect prompt：删除 “longform foundation-design” 的旧提法，改为只加载 `storycraft-architect` 并读其 `references/foundation-design.md`；
- 同步更新 `storycraft-long-director/SKILL.md:22` 的路由表、`storycraft-architect/SKILL.md:9,42,52` 的旧路径，避免 `scripts/validate-skills.mjs` 的 dangling skill 检查失败。

### 资源加载

按 [统一 references 加载契约](../process/2026-11-02-storycraft-skill-reference-loading.md)：

- 三个技能各有一个顶层 `## 资源` 段；
- 每个技能只有一个“必读” reference，对应其 `RoleMethod`/step 的 reference；
- 删除“只读本技能”矛盾句；
- 跨技能引用按契约解析。

### 旧规划

- `2026-11-02-storycraft-foundation-skill-scope.md` 标记为 **superseded**，不再作为实现合同；
- 本 Note 取代其“阶段技能集”方向；
- `2026-11-02-storycraft-skill-reference-loading.md` 仍拥有通用加载格式，本 Note 只引用不复制。

## Testing

- `tests/foundation-production.test.mjs`：architect prompt 不再出现旧 foundation 技能，且要求读 `references/foundation-design.md`。
- `tests/skill-evidence.test.mjs`：architect 只加载角色技能；`story_outline` 路由到 long-outline。
- `tests/skill-references.test.mjs`：三份新资源、body 路径、必读映射、40 行上限。
- 完整 CI：94 单元 + 49 E2E。

## Alternatives considered

**A. 保留 long-foundation 空壳，只补 Resource 段。** 最强理由是改动最小。否决原因：architect/planner 方法继续混放，planner 仍加载 architect 相关方法，且空壳没有存在价值。

**B. 把 foundation-design 放在 architect 下，planner 直接读文件。** 最强理由是少一个 planner 技能。否决原因：需要新增 resource-only 路由/路径协议，超出本次范围；`storycraft-long-outline` 技能已能承担 planner 入口，且保留 `RoleMethod` 单参考合同。

**C. 把全书计划并回 architect 一次产出。** 最强理由是接近参考工程一次 foundation 输出。否决原因：本项目已把四阶段拆分，architect 不产 hooks；会改变四阶段与作者确认合同。

## Consequences

- 拆 outline 后，architect 的 volume map 与 planner 的卷摘要可能重复；outline-design 只写走向判断，卷图字段仍归 architect；
- 新增一个 planner 技能，技能总数不变（删 1 加 1），但路由测试需同步；
- 方法拆成两份可能漂移；边界按“产物属主”固定，foundation 不写计划三段，outline 不写角色卡；
- 真实链路需复测 architect 四阶段 + story_outline，确认 planner 不会请求 architect 技能。
