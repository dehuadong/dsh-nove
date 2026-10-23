# 交接文档：故事工坊 R6b/R9 已交付，下一步 R6a 长篇方法资源

> 更新时间：2026-10-23  
> 交接范围：`dehuadong/dsh-nove` 的 `storycraft/`；当前提交 `9e13bbc`。  
> 下一会话默认焦点：**R6a 长篇方法资源**（未立项）；备选 **R9b 语义对账**。

## 1. 当前结论

### 已交付并关闭

- **#39 R6b 形态路由**：
  - `domain.js` 的 `FORM_META`；
  - `delegate.js` 的 `writerSkills(form)`；
  - writer 按 form 加载 `storycraft-write-craft` + `storycraft-short-story` / `storycraft-short-drama`；
  - 提示按「章 / 篇 / 集」显示；
  - reviewer/reviser 只加载角色技能。
- **R6b-fix**：
  - 短篇技能去掉 `stories/*.md` 输出契约；
  - 阶段顺序改为「篇纲 → 正文 → 审稿 → 修订 → 摘要 → 定稿」。
- **#40 R9 状态预检**：
  - `state-validation.js`：normalize + 伏笔状态机；
  - `foldState` 在闸门后、写库前校验；
  - 重复事实 warning；重复/倒退 hook、`hook-not-found`、`hook-not-open` 拒绝；
  - 已定稿再次 settle 返回 `chapter-settled`。
- **R6c 创意阶段沟通规则**：
  - 讨论不自动执行；
  - 缺信息只问一个关键问题；
  - 完整 brief 写进 `story_propose.notes`；
  - Architect/规划内部化。
- **#38 备份闭环**、**#37 面板重设计** 已交付；不在此重述，见 Issue/Note。

### 验证现状

- 单元：**34 个文件全过**（`node storycraft/scripts/ci.mjs --no-e2e`）。
- E2E：**未跑**。本机 Playwright/DSH 登录弹窗阻塞，不能声称 E2E 通过。
- 规划文档检查：`node scripts/decisions/check.mjs` 通过。
- `HANDOFF.md` 曾在 #40 提交中误删，已用 `9e13bbc` 恢复。

## 2. 下一步：R6a

范围建议（尚未立项）：

1. 新增三份长篇方法 references：
   - `foundation-design.md`：主线/卷末不可逆变化/人物弧代价/初始伏笔；
   - `reader-contract-and-progression.md`：开篇承诺、进展轴、余波、因果归属；
   - `state-projection.md`：factOps / hook 生命周期 / 状态投影边界。
2. 放进 `storycraft/skills/plan/storycraft-plan-craft/references/` 或 `storycraft/skills/write/storycraft-write-craft/references/`，由对应 `SKILL.md` 正文点名。
3. 接入规划、写作、审稿技能的阅读触发，不新增动作。
4. 更新 README、对拍矩阵、路线图；R6a 移到已交付。
5. 加最小静态测试：references 存在且在 SKILL 正文被点名。

不要在本项做：
- 语义对账（R9b）；
- LLM 调用；
- 新动作/schema；
- 自动改写。

## 3. 关键产物与证据

- 路线图：`.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md`
- 对拍矩阵：`.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md`
- InkOS 2.0 增量：`docs/report/inkos/2.0-harness-delta.md`
- R6b 实现 Note：`.agents/notes/implemented/pipeline/2026-10-23-storycraft-form-aware-delegation.md`
- R9 实现 Note：`.agents/notes/implemented/pipeline/2026-10-23-storycraft-state-preflight.md`
- 最近提交：
  - `526feec` R6b
  - `576625d` R6b-fix
  - `b6cc388` R9 规划
  - `d9cd45d` R9 实现
  - `9e13bbc` 恢复 HANDOFF

## 4. 已知风险/边界

- `state-validation.js` 只做确定性检查；**不是语义对账**，不能判断事实是否被正文支持。
- 重复事实用精确字符串匹配，同义改写不报。
- `story_propose.notes` 是 brief 载体，但不是独立 artifact；不要把全部约定塞进 premise。
- 委派形态路由已修，但短篇/剧本技能正文可能还有旧口径；另开 R6b-fix 后续项。
- E2E 环境未恢复；若需验证 UI，先解决 Playwright/DSH 登录弹窗，不要用“单元通过”代替。
- 旧会话中已加载的工具不会热替换；新会话或重载插件后才生效。

## 5. 建议技能

- `planning`：先立项 R6a，收敛三份 references 的归属与验收；
- `implement`：实现门禁通过后写 references/接线/测试；
- `research`：需要再核对 InkOS `foundation-design` / `reader-contract` / `state-projection` 原文时；
- `code-review`：对 R6a 变更做 Standards/Spec 双轴复审；
- `verify`：最后核对 references 被点名、34 单测、文档检查；
- `handoff`：下一次会话结束再交接。

## 6. 门禁命令

```text
批准，使用技能planning 执行规划 R6a 长篇方法资源
```

若改选语义对账：

```text
批准，使用技能planning 执行规划 R9b 语义状态对账
```

## 7. 不要做

- 不要把“34 单测通过”写成“E2E/真实链路通过”；
- 不要把确定性预检宣传成语义对账；
- 不要给 `story_state` 增加 LLM 调用而不先测量；
- 不要让子代理直接落盘；
- 不要恢复 `patch→polish→rewrite` 自动阶梯；
- 不要删除 #37/#38/#39/#40 的既有证据或历史 Note。
