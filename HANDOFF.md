# 交接文档：R11 已交付，下一步 A0 产物合同 v2（R10 暂停）

> 更新时间：2026-10-23  
> 交接范围：`dehuadong/dsh-nove` 的 `storycraft/`；实现提交 `9abdd8e`（本文件随后单独提交）。  
> 下一会话默认焦点：**A0 产物合同 v2**（未立项）；R10 foundation 委派暂停，等 A0 后再决定。

## 1. 当前结论

### 已交付并关闭

- **#43 R11 settler 自动投影与语义对账**：
  - 新增主会话写动作 `story_settle`：settler 从正文抽取 delta → 确定性预检 → R9b `story_state_check`；
  - major/确定性差异带反馈重算一次；仍不一致返回 `settled:false`、proposed 与 findings，不写库；
  - 首次空 delta 可零 counts 定稿；被 major 拒绝后的第二次空 delta 视为未解决；
  - 成功后 `foldState` 写 events 并定稿；`story_next` 定稿步骤改为 `story_settle`，`story_state` 保留手动回退；
  - 新增 `storycraft-state-settler` 技能与 `story_submit` 的 `settler` 角色；动作 31→32，技能 10→11（`review` 3）；
  - 不新增表/schema；baseline 用正文 revision + 事件序号，变化即 `state-settle-stale`；
  - 设计记录迁至 `implemented/pipeline/2026-10-23-storycraft-settler-auto-projection.md`。
- **#42 R9b 只读语义检查**：`story_state_check`、validator 角色、引文校验。
- **#41 R6a 长篇方法资源**：`storycraft-longform-method` 三份 references。
- **#39 R6b**、**R6b-fix**、**#40 R9**、**R6c**、**#38**、**#37** 已交付；细节见 Issue/Note。

### 验证现状

- 单元：**37 个文件全过**（`node storycraft/scripts/ci.mjs --no-e2e`）。
- `state-settle.test.mjs`：成功、首次空 delta、minor、major→重算、两次 major、两次 invalid、空重算 unresolved、闸门、stale（revision 与 seq）、无服务/超时/无提交/坏 payload、validator 不可用、prompt 边界、技能路由。
- 手动 `story_state` 闸门顺序保持不变；`story_settle` 额外要求正文。
- 规划文档检查：`node scripts/decisions/check.mjs` 通过（47 条记录）。
- E2E：**未跑**。本机 Playwright/DSH 登录弹窗阻塞，不能声称 E2E 通过。
- Implementation Review：Standards / Spec 两轴复审后无剩余实质问题；修正了 gate 顺序、空重算安全、技能路由、基线测试、文档计数。

## 2. 下一步

### 默认：A0 产物合同 v2（未立项）

R11 之后做了产物结构与资源对拍补审，结论是 R10 不能按现有 world/plan/characters/text-hook 格式直接实现。先定：

- story_frame / volume_map / book_rules / 角色卡；
- hook 身份与生命周期；
- 结构化章节摘要、observation 证据；
- facts 三元组/有效期、chapter memo threadRefs；
- 迁移与兼容策略。

报告：[2026-10-23-artifact-and-resource-parity-audit.md](docs/report/inkos/2026-10-23-artifact-and-resource-parity-audit.md)。

A0 之后再把 R10 拆成 R10a（合同/存储）与 R10b（architect 分阶段生成）。R9b/R11 已交付的 text hook/fact 逻辑要在新合同下复审。

### R10 foundation 委派（暂停）

#44 已退回 `Status: planning`。当前映射是成本驱动的默认，不是产物结构比较后的决定；不要直接实现。

### 备选：R7 拆稿分析（需作者提供参考作品）

长/短篇合并一份拆解技能与 lens，区分证据与借鉴。没有可归档的参考作品时保持未排期。

### 不要在本轮做

- 不按旧格式实现 R10；
- 不把 `story_settle` 做成自动后台/无人值守；
- 不新增候选表/schema 而不立项；
- 不扩写短篇/剧本自动结算，除非另开工作项；
- 不跳过作者对全书计划/章纲的确认。

## 3. 关键产物与证据

- 工作项：[#43 R11](https://github.com/dehuadong/dsh-nove/issues/43)
- 实现 Note：`.agents/notes/implemented/pipeline/2026-10-23-storycraft-settler-auto-projection.md`
- R9b 工作项：[#42](https://github.com/dehuadong/dsh-nove/issues/42)
- 路线图：`.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md`
- 对拍矩阵：`.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md`
- 产物结构补审：[docs/report/inkos/2026-10-23-artifact-and-resource-parity-audit.md](docs/report/inkos/2026-10-23-artifact-and-resource-parity-audit.md)
- InkOS 2.0 增量：`docs/report/inkos/2.0-harness-delta.md`
- 最近提交：
  - `048e808` R11 规划
  - `9abdd8e` R11 实现与交付文档

## 4. 已知风险/边界

- 自动结算最坏 2 次 settler + 2 次 validator；成本和时延高于手动，显式调用、不做后台。
- settler 质量依赖模型与技能；dev 测试用假子代理，不能证明真实抽取正确；最终真实链路仍由作者验收。
- minor findings 被接受后仍可能有错；`missing-change` 不是完整抽取，`fact-ambiguous` 只是建议。
- 事实只追加、不能撤回；settler 写错旧事实只能后续覆盖或人工处理。
- 首次空 delta 可定稿；被 major 拒绝后的空重算不定稿，避免静默接受空状态。
- 37 单测通过不等于 E2E 或真实链路通过；真实使用验收仍由作者最后做一次。
- 旧会话中已加载的工具/技能不会热替换；新会话或重载插件后才生效。

## 5. 建议技能

- `planning`：立项 R10 或 R7，收敛真值/输入与验收；
- `implement`：实现门禁通过后写代码与测试；
- `code-review`：对变更做 Standards/Spec 双轴复审；
- `verify`：核对验收、迁移 Note 生命周期、更新工作项；
- `research`：需要再核对 InkOS foundation/architect 实现时；
- `handoff`：下一次会话结束再交接。

## 6. 门禁命令

默认 A0：

```text
批准，使用技能planning 执行规划 A0 产物合同 v2
```

若改选 R7（先准备参考作品）：

```text
批准，使用技能planning 执行规划 R7 拆稿分析
```

## 7. 不要做

- 不要按旧 world/plan/characters/text-hook 格式实现 R10；
- 不要把 `story_settle` 写成自动后台或无人值守；
- 不要把「37 单测通过」写成「E2E/真实链路通过」；
- 不要把自动结算通过说成「状态一定正确」；minor findings 仍可能是错；
- 不要给 `story_settle` 增加超过一次的重算或循环；
- 不要让子代理直接落盘；
- 不要删除 #37–#44 的既有证据或历史 Note。
