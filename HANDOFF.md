# 交接文档：R9b 语义状态检查已交付，下一步 R11 settler 自动链路 / R7 分析

> 更新时间：2026-10-23  
> 交接范围：`dehuadong/dsh-nove` 的 `storycraft/`；实现提交 `716b894`（本文件随后单独提交）。  
> 下一会话默认焦点：**R11 settler 自动投影与自动对账**（未立项）；备选 **R7 拆稿分析**（需作者提供参考作品）。

## 1. 当前结论

### 已交付并关闭

- **#42 R9b 语义状态检查**：
  - 新增只读动作 `story_state_check`（`state-check.js`）：确定性预检先短路，再让 validator 子代理核对正文；
  - 返回最多 8 条建议性 findings、`revision`、`counts`、`warnings`、`durationMs`；宿主校验正文引文，`evidenceVerified` 可 true/false/null；
  - 正文改版返回 `state-check-stale`；无服务/超时/无提交/坏 payload 都报错，不返回「干净」；
  - 新增 `storycraft-state-check` 技能与 `story_submit` 的 `validator` 角色；动作 30→31，技能 9→10（`review` 2）；
  - 显式调用，不塞进 `story_state`；findings 只作建议，不阻断、不自动改 delta；
  - 设计记录迁至 `implemented/pipeline/2026-10-23-storycraft-semantic-state-check.md`。
- **#41 R6a 长篇方法资源**：`storycraft-longform-method` 三份 references，规划/写作/审稿/主编按触发读取。
- **#39 R6b 形态路由**、**R6b-fix**、**#40 R9 确定性预检**、**R6c 创意阶段沟通规则**、**#38 备份闭环**、**#37 面板重设计** 已交付；细节见 Issue/Note。

### 验证现状

- 单元：**36 个文件全过**（`node storycraft/scripts/ci.mjs --no-e2e`）。
- 新增 `state-check.test.mjs`：只读、主会话限定、确定性短路、findings/引文校验、stale、失败码、缺章纲仍可检查、prompt 不含其他章正文或路径。
- `submission.test.mjs` / `tools.test.mjs` / `skills.test.mjs` 同步；动作 31、`all` 10、`review` 2。
- 规划文档检查：`node scripts/decisions/check.mjs` 通过（46 条记录）。
- E2E：**未跑**。本机 Playwright/DSH 登录弹窗阻塞，不能声称 E2E 通过。
- Implementation Review：Standards / Spec 两轴复审后无剩余实质问题；修正了 cleanup 顺序、missing-change 引文约束、卡片上下文范围、告警与测试覆盖。

## 2. 下一步

### 默认：R11 settler 自动投影与自动对账（未立项）

R9b 只提供显式只读检查；R11 才把同一 validator 接进自动链路：

1. settler 从正文抽取 delta；
2. 复用 R9b 的 normalize/validate 与 validator；
3. 有可重算差异时带 findings 重算一次（只一次）；
4. 仍不一致或 validator 不可用：保留旧投影、**不自动定稿**，返回 observations；
5. 只有重算后一致才 fold 并定稿。

与 InkOS 的差异：InkOS 在未解决时仍落盘章节、保留旧状态；我们的阶段机把定稿与状态写入绑在一起，因此未解决时不自动定稿，避免 `settled` 但状态未应用。该差异已写进 R9b Note。

### 备选：R7 拆稿分析（需作者提供参考作品）

长/短篇合并一份拆解技能与 lens，区分证据与借鉴。没有可归档的参考作品时保持未排期。

### 不要在本轮做

- 不把 R9b 的 check 自动塞进 `story_state`；
- 不给 `story_state` 增加 LLM 调用而不先测量/立项；
- 不新增 architect/planner 委派（R10）；
- 不扩写短篇/剧本方法，除非另开工作项。

## 3. 关键产物与证据

- 工作项：[#42 R9b 语义状态检查](https://github.com/dehuadong/dsh-nove/issues/42)
- 实现 Note：`.agents/notes/implemented/pipeline/2026-10-23-storycraft-semantic-state-check.md`
- R6a 工作项：[#41](https://github.com/dehuadong/dsh-nove/issues/41)
- 路线图：`.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md`
- 对拍矩阵：`.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md`
- InkOS 2.0 增量：`docs/report/inkos/2.0-harness-delta.md`
- 最近提交：
  - `491d761` R9b 规划
  - `082fe0f` R11 自动链路衔接
  - `716b894` R9b 实现与交付文档

## 4. 已知风险/边界

- `story_state_check` 是**显式**动作：不跑就不检查；技能点名只能降低漏跑，不能保证每次运行。
- 语义判断有主观性；对话无提示语、跨章承接、合法归一化会误报，因此只出 advisory，允许 `fact-ambiguous`。
- `missing-change` 只提醒最重要的几条，不是完整抽取；不能替代 R11 settler。
- 引文校验只证明「这段话在正文里」，不证明归属与含义正确；`evidenceVerified: false` 不丢条目。
- 检查结果绑定正文 `revision`；改版后要重跑，检查期间改版返回 `state-check-stale`。
- 36 单测通过不等于 E2E 或真实链路通过；真实使用验收仍由作者最后做一次。
- 旧会话中已加载的工具/技能不会热替换；新会话或重载插件后才生效。

## 5. 建议技能

- `planning`：立项 R11 或 R7，收敛自动链路/输入与验收；
- `implement`：实现门禁通过后写代码与测试；
- `code-review`：对变更做 Standards/Spec 双轴复审；
- `verify`：核对验收、迁移 Note 生命周期、更新工作项；
- `research`：需要再核对 InkOS settler/validator 实现时；
- `handoff`：下一次会话结束再交接。

## 6. 门禁命令

默认 R11：

```text
批准，使用技能planning 执行规划 R11 settler 自动投影与语义对账
```

若改选 R7（先准备参考作品）：

```text
批准，使用技能planning 执行规划 R7 拆稿分析
```

## 7. 不要做

- 不要把 `story_state_check` 写成自动校验或阻断闸门；
- 不要把「36 单测通过」写成「E2E/真实链路通过」；
- 不要把方法参考被点名说成「写作质量提升」；
- 不要把确定性预检宣传成语义对账；
- 不要给 `story_state` 增加 LLM 调用而不先立项；
- 不要让子代理直接落盘；
- 不要恢复 `patch→polish→rewrite` 自动阶梯；
- 不要删除 #37–#42 的既有证据或历史 Note。
