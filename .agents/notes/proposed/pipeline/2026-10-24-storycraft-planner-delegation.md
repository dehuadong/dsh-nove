---
title: 故事工坊：L P0 planner 委派
status: proposed
created: 2026-10-24
updated: 2026-10-24
---

# Agent Note：故事工坊：L P0 planner 委派

## 问题

章纲目前由主编直接调用 `story_plan` 写，`story_delegate` 的角色只有 writer/reviewer/reviser/summarizer/architect。规划角色没有委派入口，导致：

- 主编既做编排又做章纲，违反“主编不亲自写”的角色边界；
- planner 的上下文（全书计划、卷图、人物卡、读者承诺）没有独立装配与回执；
- 多章验收无法验证“规划子代理 → 作者确认 → 写作”的真实交接。

## 对拍参考

- 参考工程 `inkos-master` 2.0.0 的 planner 角色负责章级 intent/memo（见 `docs/report/inkos/2026-10-23-full-project-parity-audit.md` 的角色对拍与 `2026-10-23-artifact-and-resource-parity-audit.md` 的 ChapterMemo）；
- 我们已采纳：`story_plan` 写 `plan:<n>` artifact、`story_context` 有 planner 角色、`storycraft-plan-craft` 已存在；
- 未采纳：参考实现的 capability/profile 注入；本设计用 DSH 的 `story_delegate` + `story_submit` + 宿主落盘等价。

## 与既有记录

- `story_plan` 的字段、`plan:<n>` 与作者确认归 [`2026-10-24-storycraft-memo-migration.md`](../../implemented/pipeline/2026-10-24-storycraft-memo-migration.md) 与 [`2026-10-24-storycraft-chapter-identity-approval.md`](../../implemented/pipeline/2026-10-24-storycraft-chapter-identity-approval.md)；
- 角色提交与失败重试归 [`2026-10-20-storycraft-role-submission.md`](../../implemented/pipeline/2026-10-20-storycraft-role-submission.md)；
- 委派总设计归 [`2026-10-20-storycraft-host-delegation.md`](../../implemented/pipeline/2026-10-20-storycraft-host-delegation.md)；
- L 产品收口与 #63 的工作项关系归 `#62` / `#63`。

本 Note 只拥有 planner 的委派路径、输入装配、提交校验与落盘边界，不重写章纲字段合同。

## 提案

### 1. 角色与契约

`ROLE_META` 增加：

```js
planner: { label: '规划', skill: 'storycraft-plan-craft' }
```

planner 只产出章纲，不写正文、不写全书计划、不确认章纲。全书计划仍归 `story_outline` + 作者确认；foundation 仍归 architect。

### 2. `story_delegate` 路由

- `role: 'planner'` 需要 `chapter`；
- preflight：
  - 全书计划必须已确认（否则 `outline-required`）；
  - 目标章已有 `plan:<n>` 时拒绝 `plan-exists`（改章纲走主编手动 `story_plan`，避免子代理悄悄覆盖已确认章纲）；
  - 章可以还没有正文，也不要求 entry 存在；
- `loadRoleInput` 用 `role:'planner'`，装配全书计划、卷图、人物卡、读者承诺与本次任务；不加载正文；
- 子代理提示要求加载 `storycraft-plan-craft`，并读 `storycraft-long-writing` 的方法正文；
- 返回紧凑回执：`plan:<n>` revision、`planApproved:false`、下一步提示；正文不进入主会话。

### 3. 提交与落盘

`story_submit` 的 planner payload：

```json
{"perspective":"…","goal":"…","obstacle":"…","cost":"…","turn":"…","body":"…","threadRefs":["可选：伏笔 id"]}
```

- 五项 + `body` 必填；`threadRefs` 可为空数组；
- `submission.js` 只做快速形状校验，字段语义由 `writePlan` 最终校验（单一权威，避免两套规则）；
- 宿主落盘调用 `writePlan`，写入 `plan:<n>`；不调用 `approveChapterPlan`；
- 落盘前检查作者未取消、current revision 未变化；失败不写半成品。

### 4. `story_next` 广告

所有“需要写章纲且 outline 已确认、没有被作者闸门 blocked”的分支，在返回 `action:'story_plan'` 时附带：

```json
{"delegate":{"role":"planner"}}
```

`blocked:['outline-approval']` 的分支不返回 delegate，避免在作者未确认时启动子代理。

### 5. 失败与回退

- delegate 服务缺失/超时/无提交：按现有 `delegation-unavailable` / `delegation-failed` / `delegation-no-submission` 停手；
- 不静默回退主编写章纲；作者可以显式走手动 `story_plan`；
- planner 不可用不影响已存在章纲的写作与后续阶段。

## 备选方案

- **保持主编写章纲**：角色边界不清，`#65` 多章验收无法覆盖 planner；否决。
- **让 planner 一次生成全书计划 + 章纲**：与 `story_outline` 的作者确认和 architect foundation 重叠；否决。
- **planner 直接落盘不提交**：绕过宿主校验，与所有角色契约不一致；否决。
- **允许 planner 覆盖已存在章纲**：会绕过章纲确认闸门；否决，改由主编手动 `story_plan`。

## 验收条件

1. `story_delegate(role:'planner')` 在 outline 已确认、无 plan 时成功写入 `plan:<n>`，回执不含正文；
2. 无 outline / 已有 plan / 子代理不可用/无提交时按错误码停手，不写 plan；
3. `story_next` 只在 outline 已确认且无 plan 时返回 `delegate:{role:'planner'}`；
4. planner 提交缺字段/threadRefs 非法被拒，错误回到子代理重提；
5. 作者确认章纲仍走面板，planner 不能代签；
6. 单测 + `ci --no-e2e` 通过；真实链路第 2 章由 planner 产出章纲，作者确认后 writer 继续。

## 风险

- planner 产出的章纲质量依赖模型与上下文；作者确认闸门仍是最后防线。
- 新增角色的技能名硬编码在 `ROLE_META`，改名需同步测试。
- 若允许改章纲，需要另立“重规划”路径；本设计只覆盖首次章纲。
