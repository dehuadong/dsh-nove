# 交接文档：R6a 长篇方法资源已交付，下一步 R9b 语义对账 / R7 分析

> 更新时间：2026-10-23  
> 交接范围：`dehuadong/dsh-nove` 的 `storycraft/`；实现提交 `ba1e0c1`（本文件随后单独提交）。  
> 下一会话默认焦点：**R9b 语义状态对账**（未立项）；备选 **R7 拆稿分析**（需作者提供参考作品）。

## 1. 当前结论

### 已交付并关闭

- **#41 R6a 长篇方法资源**：
  - 新增 `storycraft/skills/longform/storycraft-longform-method/`：`SKILL.md` + `references/foundation-design.md`、`reader-contract-and-progression.md`、`state-projection.md`；
  - 规划、写作、审稿与定稿前主编在各自技能正文里按触发读取；方法技能只给判断依据，不产出提交内容；
  - 短篇、剧本、修订者与 `delegate.js`、动作 schema、阶段机、落盘、UI 均未改；
  - 新增 `tests/skill-references.test.mjs`；`skills.test` 同步 `all` 9 个、`longform` 2 个；README、对拍矩阵、路线图已同步；
  - 设计记录迁至 `implemented/pipeline/2026-10-23-storycraft-longform-method-references.md`。
- **#39 R6b 形态路由**、**R6b-fix**、**#40 R9 状态预检**、**R6c 创意阶段沟通规则**、**#38 备份闭环**、**#37 面板重设计** 已交付；细节见 Issue/Note，不在此重述。

### 验证现状

- 单元：**35 个文件全过**（`node storycraft/scripts/ci.mjs --no-e2e`）。
- 新增 `skill-references.test.mjs`：references 存在且被方法技能与四个角色点名、无孤儿、无代码块/`story_submit`/`payload`、伏笔三态与 `state-validation.js` 的 `HOOK_STATES` 一致。
- 规划文档检查：`node scripts/decisions/check.mjs` 通过。
- E2E：**未跑**。本机 Playwright/DSH 登录弹窗阻塞，不能声称 E2E 通过。
- Implementation Review：Spec 复审 PASS；Standards 复审剩余项（Note 生命周期路径）随 Verify 迁移关闭。

## 2. 下一步

### 默认：R9b 语义状态对账（未立项）

R9 只做确定性预检：重复事实 warning、伏笔状态机、二次归档拒绝；**不判断事实是否被正文支持**。R9b 的触发条件是「有测量显示需要 LLM 调用」，不要因为方法资源已交付就直接加模型调用。

建议先测量：真实章节中 `story_state` 的事实与伏笔，有多少条与正文不一致、审稿/修订返工是否集中在这里；没有数据就先不立项。

### 备选：R7 拆稿分析（需作者提供参考作品）

长/短篇合并一份拆解技能与 lens，区分证据与借鉴。没有可归档的参考作品时保持未排期。

### 不要在本轮做

- 不给 `story_state` 加 LLM 调用而不先测量；
- 不做自动改写、自动抽取或 settler 投影（R11）；
- 不新增 architect/planner 委派（R10）；
- 不扩写短篇/剧本方法，除非另开工作项。

## 3. 关键产物与证据

- 工作项：[#41 R6a 长篇方法资源](https://github.com/dehuadong/dsh-nove/issues/41)
- 实现 Note：`.agents/notes/implemented/pipeline/2026-10-23-storycraft-longform-method-references.md`
- 路线图：`.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md`
- 对拍矩阵：`.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md`
- InkOS 2.0 增量：`docs/report/inkos/2.0-harness-delta.md`
- 最近提交：
  - `ba6c3c1` R6a 规划
  - `ba1e0c1` R6a 实现与交付文档

## 4. 已知风险/边界

- 方法技能是**按需加载**：角色技能正文点名了触发，静态测试只能证明点名，不能证明模型运行时一定加载。
- 角色目录（`write` / `review` / `plan`）单独挂载时不含方法技能；当前预设只用 `all`，拆目录时要补。
- `state-projection.md` 不是语义对账：它只说明现有三态与投影边界，不能判断事实是否被正文支持。
- 伏笔身份是 `text` 精确文本；同义改写会被当成新伏笔，重复事实也只按精确文本 warning。
- 35 单测通过不等于 E2E 或真实链路通过；真实使用验收仍由作者最后做一次。
- 旧会话中已加载的工具/技能不会热替换；新会话或重载插件后才生效。

## 5. 建议技能

- `planning`：先立项 R9b 或 R7，收敛测量/输入与验收；
- `implement`：实现门禁通过后写代码与测试；
- `code-review`：对变更做 Standards/Spec 双轴复审；
- `verify`：核对验收、迁移 Note 生命周期、更新工作项；
- `research`：需要再核对 InkOS 的语义对账/拆解实现时；
- `handoff`：下一次会话结束再交接。

## 6. 门禁命令

默认 R9b：

```text
批准，使用技能planning 执行规划 R9b 语义状态对账
```

若改选 R7（先准备参考作品）：

```text
批准，使用技能planning 执行规划 R7 拆稿分析
```

## 7. 不要做

- 不要把「35 单测通过」写成「E2E/真实链路通过」；
- 不要把方法参考被点名说成「写作质量提升」；
- 不要把确定性预检宣传成语义对账；
- 不要给 `story_state` 增加 LLM 调用而不先测量；
- 不要让子代理直接落盘；
- 不要恢复 `patch→polish→rewrite` 自动阶梯；
- 不要删除 #37/#38/#39/#40/#41 的既有证据或历史 Note。
