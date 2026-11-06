# 能力保真审计

来源：`AGENTS.md#保真原则`、`AGENTS.md#保真工作法`、`docs/dsh-mapping.md`。

每行一个能力；`未审` 行不得进入 implement。判定：

- `等价`：行为与源工程一致；
- `机制等价`：DSH 机制不同，但行为等价且有验证；
- `保真债`：缺字段/产物/消费者/校验，必须在“债/偏差”列写偿还路径；
- `未审`：尚未审计。

| 能力 | 源证据 | 源行为不变量 | 复刻现状 | 判定 | 债/偏差 |
|---|---|---|---|---|---|
| `runtime.load` | `inkos-master/packages/core/src/harness/runtime.ts` | 插件/预设加载后注册动作与客户端骨架，真实会话可调用 | `src/index.ts`、`tests/tools.test.mjs`、`artifacts/real-runs/runtime.load.json` | 机制等价 | `docs/dsh-mapping.md` 运行时 |
| `workspace.single-form` | `inkos-master/packages/core/src/harness/builtin-profiles.ts:15-33` | 工作区只承载一种形态；预设声明 form 并与工作区匹配；一作品一库 | `src/storage/repositories/catalog.ts`、`tests/workspace-form.test.mjs` | 保真债 | 当行补齐：当前 preset form 是代码表 `PRESET_FORM`，尚未由预设配置声明 |
| `runtime.session-binding` | `inkos-master/packages/core/src/harness/session-binding.ts:17-25` | 会话绑定 profile 与 workId；绑定后不原地改绑；重启恢复 | `src/current.ts`、`tests/current.test.mjs` | 机制等价 | `docs/dsh-mapping.md` 会话绑定 |
| `runtime.commands` | `inkos-master/packages/cli/src/commands/init.ts` | `init [name]` 不经过模型初始化工作区 | `src/commands.ts`、`e2e/commands.spec.cjs` | 机制等价 | `docs/dsh-mapping.md` 命令入口 |
| `runtime.telemetry` | `inkos-master/packages/core/src/harness/execution-evidence.ts:4-15` | 每次委派记录 usage/耗时/失败回执 | `src/call-evidence.ts`、`src/telemetry.ts`、`tests/model-calls.test.mjs` | 等价 | 无 |
| `artifact.identity` | `inkos-master/packages/core/src/harness/artifact-revisions.ts:14-110` | revision 有 parent/checksum/byteLength/status；读取 current；跨作品隔离 | `src/artifact-store.ts`、`tests/artifact-identity.test.mjs` | 机制等价 | `docs/dsh-mapping.md` 存储（SQLite 虚拟路径） |
| `panel.workbench` | `inkos-master/packages/studio/src/pages/` | 面板属于 storycraft 预设与作品工作区，不全局显示 | `src/client.ts`、`e2e/load.spec.cjs`、`e2e/panel-preset.spec.cjs` | 保真债 | 后续行：面板内容仍混排长篇/短篇/剧本，尚未拆成各形态独立面板 |
| `foundation.architect` | `inkos-master/packages/core/src/agents/architect.ts` | 基础设定分阶段产出；未完成不得确认 | `src/roles/architect/`、`tests/foundation-production.test.mjs` | 等价 | 无 |
| `foundation.hooks` | `inkos-master/packages/core/src/state/state-reducer.ts:76-140` | pendingHooks 在 chapter 0 以 deferred 进入；resolved 不可 supersede；supersede 需理由 | `src/state-projection.ts`、`tests/foundation-hooks.test.mjs` | 等价 | 无 |
| `foundation.approval` | `inkos-master/packages/core/src/interaction/session.ts:9-10` | 作者确认绑定 foundation revision；改稿失效；面板/会话记录来源 | `src/storage/repositories/foundation.ts`、`tests/panel-approval.test.mjs` | 等价 | 无 |
| `cast.single-authority` | `inkos-master/packages/core/src/harness/` 角色数据 | 角色卡是唯一权威；brief/context 不读旧 characters 真值 | `src/facts.ts`、`src/context/`、`tests/context.test.mjs` | 等价 | 无 |
| `plan.outline` | `inkos-master/packages/core/src/agents/architect-tool.ts`、`pipeline/runner.ts:478-505` | 主线必填；新计划撤销旧确认；未确认阻断章纲；卷图是投影 | `src/storage/repositories/catalog.ts`、`tests/outline.test.mjs` | 等价 | 无 |
| `runtime.fidelity-audit` | `AGENTS.md#保真原则` | 每个能力有源证据/不变量/现状/判定；verified 不得未审；债/偏差有归属 | `docs/fidelity-audit.md`、`scripts/check-fidelity-audit.mjs` | 等价 | 无 |
| `runtime.recovery` | 待审计 | 待审计 | `src/recovery.ts` | 未审 | 后续行 |
| `plan.chapter` | 待审计 | 待审计 | `src/storage/repositories/chapters.ts` | 未审 | 后续行 |
| `context.brief` | 待审计 | 待审计 | `src/bible/` | 未审 | 后续行 |
| `context.retrieval` | 待审计 | 待审计 | `src/search-index.ts` | 未审 | 后续行 |
| `chapter.write` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.review` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.revise` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.summary` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.settle` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.finalize` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.reopen` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `chapter.move-delete` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
| `state.check` | 待审计 | 待审计 | 待审计 | 未审 | 后续行 |
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
