# 能力保真审计

来源：`AGENTS.md#保真原则`、`AGENTS.md#保真工作法`、`docs/dsh-mapping.md`。

每行一个能力；`未审` 行不得进入 implement。判定：

- `等价`：行为与源工程一致；
- `机制等价`：DSH 机制不同，但行为等价且有验证；
- `保真债`：缺字段/产物/消费者/校验，必须在“债/偏差”列写偿还路径；
- `未审`：尚未审计。

| 能力 | 源证据 | 源行为不变量 | 复刻现状 | 判定 | 债/偏差 |
|---|---|---|---|---|---|
| `runtime.load` | `inkos-master/packages/core/src/harness/runtime.ts` | 插件/预设加载后注册动作与客户端骨架，真实会话可调用 | `src/index.ts`、`tests/tools.test.mjs`、`artifacts/real-runs/runtime.load.json` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；`docs/dsh-mapping.md` 运行时 |
| `workspace.single-form` | `inkos-master/packages/core/src/harness/builtin-profiles.ts:15-33` | 工作区只承载一种形态；预设声明 form 并与工作区匹配；一作品一库 | `src/storage/repositories/catalog.ts`、`tests/workspace-form.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；当行补齐：当前 preset form 是代码表 `PRESET_FORM`，尚未由预设配置声明 |
| `runtime.session-binding` | `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话绑定 profile 与 workId；绑定后不原地改绑；重启恢复 | `src/current.ts`、`tests/current.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；`docs/dsh-mapping.md` 会话绑定 |
| `runtime.commands` | `inkos-master/packages/cli/src/commands/init.ts` | `init [name]` 不经过模型初始化工作区 | `src/commands.ts`、`e2e/commands.spec.cjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；`docs/dsh-mapping.md` 命令入口 |
| `runtime.telemetry` | `inkos-master/packages/core/src/harness/execution-evidence.ts:4-15` | 每次委派记录 usage/耗时/失败回执 | `src/call-evidence.ts`、`src/telemetry.ts`、`tests/model-calls.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `artifact.identity` | `inkos-master/packages/core/src/harness/artifact-revisions.ts:14-110` | revision 有 parent/checksum/byteLength/status；读取 current；跨作品隔离 | `src/artifact-store.ts`、`tests/artifact-identity.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：`docs/dsh-mapping.md` 作品存储差异（源文件落盘 vs SQLite）未证明读取/导出等价 |
| `panel.workbench` | `inkos-master/packages/studio/src/pages/` | 面板属于 storycraft 预设与作品工作区，不全局显示 | `src/client.ts`、`e2e/load.spec.cjs`、`e2e/panel-preset.spec.cjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：面板内容仍混排长篇/短篇/剧本，尚未拆成各形态独立面板 |
| `foundation.architect` | `inkos-master/packages/core/src/agents/architect.ts` | 基础设定分阶段产出；未完成不得确认 | `src/roles/architect/`、`tests/foundation-production.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `foundation.hooks` | `inkos-master/packages/core/src/state/state-reducer.ts:76-140` | pendingHooks 在 chapter 0 以 deferred 进入；resolved 不可 supersede；supersede 需理由 | `src/state-projection.ts`、`tests/foundation-hooks.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `foundation.approval` | `inkos-master/packages/core/src/interaction/session.ts:9-10` | 作者确认绑定 foundation revision；改稿失效；面板/会话记录来源 | `src/storage/repositories/foundation.ts`、`tests/panel-approval.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `cast.single-authority` | `inkos-master/packages/core/src/harness/` 角色数据 | 角色卡是唯一权威；brief/context 不读旧 characters 真值 | `src/facts.ts`、`src/context/`、`tests/context.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `plan.outline` | `inkos-master/packages/core/src/agents/architect-tool.ts`、`pipeline/runner.ts:478-505` | 主线必填；新计划撤销旧确认；未确认阻断章纲；卷图是投影 | `src/storage/repositories/catalog.ts`、`tests/outline.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `runtime.fidelity-audit` | `AGENTS.md#保真原则` | 每个能力有源证据/不变量/现状/判定；verified 不得未审；债/偏差有归属 | `docs/fidelity-audit.md`、`scripts/check-fidelity-audit.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `runtime.recovery` | 待审计 | 待审计 | `src/recovery.ts` | 未审 | 后续行 |
| `plan.chapter` | `inkos-master/packages/core/src/agents/planner.ts:22-60`、`models/input-governance.ts` | 章纲固定 `plan:<n>` 身份；五字段/body/threadRefs；未确认阻断正文；确认绑定 current revision | `src/storage/repositories/chapters.ts`、`tests/memo-consumers.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `context.brief` | `inkos-master/packages/core/src/harness/context-compiler.ts:1-160` | 上下文片段按 protected/compressible 分层；protected 超预算抛错；去重后按优先级装配；trace 记录预算与来源 | `src/context/brief.ts`、`tests/bible.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：语义压缩未实现；当前超预算按 section 丢弃，偿还路径为 `context.compress` 或 brief compiler |
| `context.retrieval` | `inkos-master/packages/core/src/retrieval/local-search.ts:29-100` | 查询由任务/章纲/伏笔/指令组成；检索按 scope/kind 过滤；命中带 source 标注；按分数与章号稳定排序 | `src/retrieval.ts`、`tests/retrieval.test.mjs`、`tests/context-retrieval.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `chapter.write` | `inkos-master/packages/core/src/agents/writer.ts:100-160`、`utils/length-metrics.ts` | 章号/标题/正文写成一版；plan/context 先决；字数按 zh_chars 剥离 Markdown 元数据；显式 min/max 硬校验 | `src/roles/writer/agent.ts`、`src/storage/repositories/chapters.ts`、`tests/chapter-length.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：language/en_words 未实现；state settlement 归 `chapter.settle` |
| `chapter.review` | `inkos-master/packages/core/src/pipeline/chapter-review.ts:1-80` | 正文非空才审；按 counting mode 计字数；模型审稿失败转 `review-unavailable` observation 而非中断；结果含 wordCount/usage | `src/roles/reviewer/agent.ts`、`src/storage/repositories/reviews.ts`、`tests/review-unavailable.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：review 结果仍不含 wordCount/usage；failure 回退已补 |
| `chapter.revise` | `inkos-master/packages/core/src/agents/reviser.ts:1-130`、`utils/text-range-edits.ts` | 模式为 polish/rewrite/rework/anti-detect/spot-fix；spot-fix 只替换选中的源码范围并保留范围外字节；修订后按 lengthSpec 校验 | `src/revision.ts`、`src/roles/reviser/agent.ts`、`tests/revision-modes.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：spot-fix 仍是整段重写，范围替换未实现；模式词表与 zh_chars 长度已补 |
| `chapter.summary` | `inkos-master/packages/core/src/agents/writer.ts:342-355` | 摘要含 chapter/title/characters/events/stateChanges/hookActivity/mood/chapterType；绑定 bodyRevision；只描述已发生正文 | `src/roles/summarizer/agent.ts`、`tests/summary-binding.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `chapter.settle` | `inkos-master/packages/core/src/agents/settler-tool.ts:35-75` | 结算提交 postSettlement/factOps/hookOps/newHookCandidates/chapterSummary；newHooks 由宿主铸 id；hook 状态只走 op；摘要已绑定正文 | `src/state-settle.ts`、`src/storage/repositories/state.ts`、`tests/state-v2-settle.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `chapter.finalize` | `inkos-master/packages/core/src/agents/writer.ts:600-650`、`pipeline/runner.ts:999-1040` | 只有状态草案 ready 且绑定当前正文才定稿；定稿写 state 事件并锁 settled；重复定稿拒绝 | `src/storage/repositories/state.ts`、`tests/settle-draft.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：按 process Note 逐项重验 |
| `chapter.reopen` | `inkos-master/packages/core/src/interaction/edit-controller.ts:18-35`、`:338-375` | 作者可编辑已定稿章节；replace 归档旧版、写新正文、清 runtime、不删后续章 | `src/storage/repositories/chapters.ts`、`tests/reopen-target.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；`docs/dsh-mapping.md` 章节重开：源直接编辑，复刻 reopen+revise |
| `chapter.move-delete` | `inkos-master/packages/core/src/state/chapter-delete.ts:1-120` | 只允许删除最新章；章节文件进 `.trash`；索引/快照/runtime 回滚到前一章；源没有移章动作 | `src/storage/repositories/chapters.ts`、`tests/chapter-edit.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；当行补齐：已限制最新章、移章拒绝；仍缺 `.trash` 章节文件与快照回滚，只有 DB backup |
| `state.check` | `inkos-master/packages/core/src/agents/state-validator.ts:1-120`、`agents/state-validation-tool.ts:1-30` | 语义对账比较 old/new state+hooks；未变化短路；返回 observations/consistent/reconciliationRequired；reconciliation 必须给理由 | `src/state-check.ts`、`tests/state-check.test.mjs` | 保真债 | 复审缺口：2026-11-07 复审 needs_changes；后续行：结构化 `state/state-validator.ts` 未实现；consistent/reconciliationRequired 已补，预/后结算差异见 dsh-mapping |
| `export.work` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `backup.restore` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `materials.import` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `search.unified` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `panel.logs` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `panel.analysis` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `short.outline` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `short.batch-draft` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `short.review-revise` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `short.package` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `script.spec` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `script.scenes` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `script.scriptset` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `script.review-revise` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
