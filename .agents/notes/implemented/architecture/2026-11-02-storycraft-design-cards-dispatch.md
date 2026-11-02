# Agent Note: 故事工坊：architect 合并 design + cards 派发

Status: implemented

工作项：当前任务（不新建 GitHub issue）。把 architect 的 frame/rules/roles 三个派发合并为一次 `design` 派发，cards 仍独立，形成两次子代理调用。

## Problem

当前 architect 正常流程是四次派发：

1. `frame`；
2. `rules`；
3. `roles`；
4. `cards`。

其中 frame/rules/roles 共同描述“这本书是什么”，体量通常远小于角色卡；拆成三次带来三次冷启动、三次技能加载与三次 prompt。cards 数量不确定，单独派发可以保留 1:1 校验和最大 payload 隔离。

参考工程 `inkos-master` 的 architect 一次生成整套 foundation；本项目因 64 KB 提交上限、失败整体重来与 cards 体量，选择拆分。本项是折中，不回到一次调用。

## 对拍参考

- `inkos-master/packages/core/src/agents/architect.ts`：`ArchitectOutput` 一次包含 storyFrame/volumeMap/bookRules/roles/hooks；一次 foundation 调用。
- 本地 `2026-10-24-storycraft-foundation-production.md:77` 否决“一次调用全部 foundation”：单次 payload 大、失败整体重来、难定位；采用四 stage。
- 本地 `submission.ts` 的 payload 上限 64 KB；cards 无数量上限，不能保证和设计块同批提交。
- 本地 `src/store-db.ts` 的 foundation stage 状态与面板四格：frame/rules/roles/cards 四个派生布尔；本项保留这四个状态。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| architect 一次全量 | design + cards 两次 | cards 体量不可控，保留 1:1/重试隔离 | 等价适配 | 单元 |
| 四阶段独立 | design 合并前三段 | 降冷启动，保留 cards 隔离 | 采纳 | 路由/状态 |
| 一次调用全 foundation | 不采用 | 64 KB/整体重试 | 不采用 | payload |

## Decision

### 新 dispatch stage：`design`

`story_delegate(role:'architect', stage:'design')` 一次提交：

```json
{
  "storyFrame": "Markdown",
  "volumeMap": "Markdown",
  "currentFocus": "Markdown",
  "bookRules": { "version": "2", "...": "..." },
  "rolesIndex": { "roles": [{ "name": "…", "tier": "major|minor" }] }
}
```

宿主在一个事务内写：

- `bible:story_frame`；
- `bible:volume_map`；
- `bible:current_focus`；
- `bible:book_rules`；
- `roles:index`。

任一字段不合法则整批不写，保留现有原子性。

### 状态与路由

- `FOUNDATION_STAGES` 仍是 `frame/rules/roles/cards` 四个**状态布尔**，面板四格不变；
- 新增 `FOUNDATION_DISPATCH_STAGES = ['design','cards']`，只决定派发顺序，不增加第五个状态布尔；
- `design` 完成后前三格同时为 true；
- 新增 `foundation.dispatchStage`：
  - 前三格任一未完成 → `design`；
  - 前三格完成且 cards 未完成 → `cards`；
  - 全部完成 → 无。
- 保留 `foundation.nextStage` 作为四个状态的“首个未完成”兼容字段；`story_next` 使用 `dispatchStage`，不再用 `nextStage`；
- `story_next` 返回 `foundationStage: foundation.dispatchStage`，正常流程从四次变为：
  ```text
  design → cards → foundation-approval
  ```
- `cards` 仍要求 `stages.roles=true`，仍只读 roles 索引；
- `foundationStateOf` 返回 `nextStage`（兼容）与 `dispatchStage`；`readManifest`、`story_approve`、delegate 回执都保留 `nextStage`，`dispatchStage` 作为 foundation state 字段暴露，供 `story_next` 路由；client 类型同步，面板不渲染它。

### 阶段注册与写入

- `writeFoundationStage` 接受 `design` 与手动 `frame/rules/roles/cards`；
- `design` 不是 `FOUNDATION_STAGES` 的第五布尔，而是 `FOUNDATION_DISPATCH_STAGES` 的第一项；
- `writeFoundationStage` 的 whitelist 改为 `FOUNDATION_WRITE_STAGES = [...FOUNDATION_DISPATCH_STAGES, ...FOUNDATION_STAGES]`（去重）；
- `design` 分支在一个事务内写五件 artifact，任一校验失败整批不写；
- 手动 `frame/rules/roles` 保留原顺序守卫；`design` 不需要先有 frame，因为它自带 frame 字段；
- `cards` 仍要求 `stages.roles=true`。

### 守卫

- proposal token 检查对 **payload 的 frame 文本**执行，不读库（design 内 frame 尚未落盘）；
- rules 主角一致性检查对 **payload.bookRules.protagonist.name** 与 **payload.storyFrame** 执行，不读库；
- design 写 roles 后执行 `dropRoleCardsOnDb`，索引变化时丢弃旧卡，避免 stale cards 1:1 通过；
- design 的写入顺序：frame/volume/current_focus → book_rules → roles:index → drop stale cards；全部在同一事务。

### 兼容与手动入口

- `writeFoundationStage` 继续接受 `frame/rules/roles/cards` 作为手动/测试入口；正常 `story_next` 不再逐段派发；
- `design` 是新增阶段，不删除已有 stage 数据；没有旧作品迁移；
- `frame/rules/roles` 的手动重跑仍可用，但完成后 `dispatchStage` 会自动回到 cards/完成；
- `story_next` 的 `foundationStage` 枚举与 `story_delegate` schema 增加 `design`。

### 校验与 schema

- `submission.ts` 的 architect stage map 增加 `design`，键必须是
  `storyFrame/volumeMap/currentFocus/bookRules/rolesIndex`，不许多、不许少；
- `story_submit` 的 payload 大小仍受现有 64 KB 限制；design 超限返回现有 `submit-too-large`，不静默截断；
- `story_delegate` 的 `stage` 枚举、`story_next` 的 `foundationStage` 枚举、`DELEGATE_OUTPUT.foundation`、client 类型都加 `design`；
- `DELEGATE_OUTPUT.foundation` 加可选 `dispatchStage`（`design|cards`），保留 `nextStage`；
- `story_next` 的 `foundationStage` 使用 `dispatchStage`；`writeFoundationStage` 的回执 `foundationStage` 可以是 design；
- 面板仍读四个 `stages`，不读 `dispatchStage`；四格显示不变；
- `storycraft-architect/SKILL.md` 改为两个正常阶段：
  - `design`：五字段 payload，一次提交；
  - `cards`：角色卡；
  - 手动 `frame/rules/roles` 只作为兼容入口，不用于正常流程；
  - 删除“只提交一个阶段”的旧描述，改为“正常只提交 design 或 cards 之一；手动修复才用单段”。

### 会话

- 两次派发是**两个独立子代理 session**；
- 不复用同一 session：cards 只带 roles 索引/proposal，design 全文不进入 cards 上下文；
- 不新增 continuable session 生命周期。

### 测试

- `writeFoundationStage({stage:'design'})` 原子写五件 artifact；任一坏字段整批不写；
- design 后 `stages.frame/rules/roles=true`，`dispatchStage='cards'`；
- `story_next` 顺序为 design → cards → approval；`memo-consumers` 的 `foundationStage==='frame'` 改为 `'design'`；
- cards 仍 1:1，缺卡/错 tier 拒绝；
- design 的 proposal-token/主角守卫使用 payload；roles 变更后 stale cards 被清理；`foundation-premise`/`foundation-production`/`submission` 增加对应测试；
- 既有 frame/rules/roles 手动测试保持；
- `foundation-production.test.mjs` 增加 design payload、prompt shape、非法字段原子性断言；
- 超 64 KB 的 design 走现有 `submit-too-large`；
- panel 四格仍显示 frame/rules/roles/cards；
- 94 单元 + 49 E2E 通过。

## Testing

- `foundation-production`：design 原子写五件 artifact、四格状态、`dispatchStage`、design→cards→approval、stale card 清理、prompt shape、坏 design 不落盘。
- `foundation-premise`：design 的提案不匹配与主角不一致守卫。
- `submission`：design 五字段 shape 与超 64 KB。
- `memo-consumers`/`skills`/`skill-evidence`：下一步为 design，路由与面板不变。
- 完整 CI：94 单元 + 49 E2E。

## Alternatives considered

**A. 一次生成全部 foundation。** 最强理由是最少派发、最接近参考。否决原因：cards 无数量上限，64 KB 风险；一次失败全部重来；本项不改变这个判断。

**B. 四阶段保持。** 最强理由是失败隔离最细。否决原因：frame/rules/roles 通常小且共享同一设计上下文，三次冷启动收益低。

**C. design + cards（本项）。** 保留最大 cards 的隔离，前三段合并。

**D. 同一 session 跨两次派发。** 最强理由是复用上下文。否决原因：cards 会继承 design 全文，可能更贵；需要新的 session 生命周期；失败隔离变差。

## Consequences

- design payload 比单 stage 大；若接近 64 KB，仍需拆分或提示作者；
- design 失败会重试三块，较单 stage 回退大；
- 面板四格与 dispatch 两段不一致，需要文档说明；
- 保留手动 stage 会增加分支，但避免破坏既有入口；
- 不减少 cards 的体量风险。
