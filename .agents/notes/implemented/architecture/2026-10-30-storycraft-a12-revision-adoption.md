# Agent Note: A12 正文与章纲的版本 adoption

Status: implemented

工作项：`#86`。

## Problem

正文与章纲已经是不可变版本：`chapter_versions` 按 `(number, revision)` 追加，`plan:<n>` artifact 按 revision 追加。但产品只暴露“当前”：

- 作者只能通过 `story_read chapter:<n>:r<k>` 或 `plan:<n>` 的显式 revision 读到历史；
- 没有历史列表，也没有把历史版本设为当前的动作；
- 面板只能看到当前正文/章纲，回滚只能靠整部作品的备份恢复（A10），粒度太粗。

`#4` 的 A12 行因此仍是“待开”。

## Decision

采用**追加新 revision 的 adoption**，不引入 artifact current 指针表，也不改 schema。

### 动作分类（按 #77）

| 动作 | 类别 | 入口 | 变更 |
| --- | --- | --- | --- |
| `story_history` | 只读 | 主会话工具 | 不写库 |
| 回滚正文/章纲 | 作者面板操作 | 章节详情「版本」页 → `/api/see-storycraft/chapter/adopt` | 追加 revision、更新 current、失效下游 |

回滚不进入状态卡 action id，也不由模型工具调用；`story_history` 只报告。

### 历史读取

新增只读 `story_history`：

- 输入：`work`、`chapter`；
- 输出：`stage`、`body: [{revision, words, createdAt, current}]`、`plan: [{revisionId, createdAt, current, approved}]`；
- 当前正文 = `chapters.current_revision`；当前章纲 = `plan:<n>` 中 rowid 最大的一行（revision id 是内容哈希，不能按字符串排序）；
- `approved` = `plan_approved_at !== null && plan_revision === revisionId`；`planApproval: off` 时仍报告实际批准位，但 UI 标注“无需确认”；
- 正文按 revision 倒序，当前项唯一标记；空历史返回空数组，章节不存在返回 `chapter-not-found`。

### 显式 adoption

新增宿主面板 route，输入：

- `work`、`chapter`、`target: body|plan`、`revision`（正文 `r<k>`，章纲 revision id）、`expectedCurrent`（正文 `r<k>`，章纲 revision id）。

规则：

- 只允许**最新章节**（manifest 里的最后一章）；旧章返回 `chapter-not-current`，避免 `story_read` 只能读当前章的限制被绕开；
- 当前已变化 → `revision-conflict`；目标不存在 → `revision-not-found`；目标就是当前 → `revision-current`；
- 只允许 source 类产物：正文、章纲；审稿/摘要/state 事件不可 adoption；
- 一个事务内完成：追加 revision、更新 current、失效下游、写检索、追加 `revision-adopt` 事件。

正文：

- 只允许未定稿章节；定稿返回 `chapter-settled`，先 `story_reopen`；
- 新 revision = 当前 revision + 1，body 为旧 revision 的正文，title 沿用当前章节标题（标题不在版本合同内）；
- 阶段回到 `written`；`current_revision` 指向新 revision；state draft 失效；旧正文 search doc 删除、新 revision 建 doc；
- 需要当前章纲已批准；否则 `plan-not-approved`；
- 最新审稿的 revision 是旧值，`story_next` 会要求重审；不要依赖 review 的 `stale` 字段（审稿绑定的是章纲 revision，不是正文）。

章纲：

- 只允许 `planned` 章节（还没有正文）；有正文返回 `chapter-exists`，不隐式回滚正文；
- 复制旧 `plan:<n>` 的 content，revisionId 用 **`adopt:<sourceRevisionId>:<timestamp>`**，不能复用内容哈希（同一 `(artifact_id, revision_id)` 会触发 `artifact-revision-exists`）；
- 新 plan revision 的 provenance 记为 `edited`；`putArtifactOnDb` 会清空 `plan_approved_at` / `plan_revision` / `plan_approved_source`，阶段保持 `planned`；
- 不改变正文、摘要、审稿。

事件：

- `events.kind = 'revision-adopt'`，payload `{ kind, target, fromRevision, newRevision }`；
- 只入事件审计，不入检索、不参与状态投影；与 `chapter-edit` 一样不建 search doc。

### 版本轮次

adoption 会产生新的 `current_revision`，因此**计入** `revisionRounds = currentRevision - 1`。到达 3 轮上限后仍允许 adoption（作者显式回滚），但之后的 revise 继续被 `revision-limit` 拒绝；不因回滚重置轮次。

### 可见面

面板章节详情增加「版本」视图：

- 列出正文版本与章纲版本，当前项标记，章纲显示批准状态；
- 「回滚到这一版」按钮走宿主 route，带 `expectedCurrent`；
- 回滚成功后刷新阶段、正文、审稿/摘要徽标；定稿、非最新章节、已有正文的章纲回滚等不适用状态禁用并写原因；
- 版本列表只展示元数据，正文预览复用现有 chapter 读取；预览体验归 E2，不在本项扩张。

## 对拍参考

- `inkos-master/packages/core/src/harness/tools/work-artifacts.ts:105-145`：`adopt_work_revision` 用 `expectedCurrentRevisionId` 防并发覆盖，拒绝派生 artifact，只允许 `source/`；adoption 记录 `work_revision_adopted` 事件。
- `inkos-master/packages/core/src/__tests__/artifact-methods.flow.test.ts:53-105`：显式候选审阅不自动 adoption；adoption 后 `currentRevisionId` 改变、无关候选保持。
- `inkos-master/packages/core/src/state/manager.ts:612-655`：整章 `rollbackToChapter` 是删章/审稿拒绝的粗粒度回滚，不是单产物版本切换。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| artifact 有 `currentRevisionId` 指针，adopt 切换指针 | 追加一份新 revision，current 自然成为最新 | 现有正文/章纲没有 artifact current 列；事件/版本要求单调，追加不产生第二权威 | 等价适配 | 历史列表 current、回滚后 revision+1 |
| adopt 显式 `expectedCurrentRevisionId` | `expectedCurrent` 必填，冲突 `revision-conflict` | 防并发覆盖是必须保留的合同 | 采纳 | 冲突测试 |
| 只允许 source/，派生 artifact 拒绝 | 只允许正文与章纲；审稿/摘要拒绝 | 与参考同向，避免把证据/投影当正文 | 采纳 | 派生目标拒绝测试 |
| adoption 记录审计事件 | `revision-adopt` 事件 | 需要可追溯谁在何时回滚到哪一版 | 采纳 | 事件断言 |
| 面板是作者操作 | 回滚走面板 route，模型只有 `story_history` | #77：版本切换是作者动作，不是协议步骤 | 采纳 | 面板 E2E |

## Alternatives considered

**A. 给 artifacts 加 current 指针表，adopt 直接切换指针。** 最强的理由是语义最贴近参考实现，历史 revision 原地成为当前，不产生重复 revision。否决原因：正文已有 `chapters.current_revision`，章纲没有；再加一套 artifact current 会形成两套 current 权威，且需要 schema 升版与旧作品处理。追加新 revision 复用现有读取路径。

**B. 只做历史列表，不提供 adoption。** 最强的理由是最小、零风险。否决原因：A12 的核心是“切换与回滚可观察”，只读历史无法完成回滚；整部备份粒度太粗。

**C. 把审稿/摘要也纳入 adoption。** 最强的理由是作者可能想恢复旧审稿。否决原因：审稿与摘要按正文/章纲 revision 绑定，恢复旧审稿会制造“旧证据配新正文”的错配；它们应随正文回滚自然过期。

**D. 章纲复制沿用内容哈希 revision id。** 最强的理由是与普通写入一致。否决原因：同内容会得到同一 revision id，`artifact-revision-exists` 直接拒绝；adoption 必须用带来源与时间的 salt。

## Testing

- `storycraft/tests/revision-adopt.test.mjs`：正文/章纲历史、当前标记、正文回滚（内容、stage、draft、search、event、nextStep）、章纲回滚（adopt: id、批准清空）、冲突/当前/不存在/非最新章/未批准章纲/非法 target/已有正文的章纲回滚。
- `storycraft/tests/tools.test.mjs` 与 `scripts/check-built-tools.mjs`：36 个动作，`story_history` 只读。
- `storycraft/e2e/workbench.spec.cjs`：版本页加载、正文回滚 confirm、回滚后当前版本 r3 可见。
- 全量 `node storycraft/scripts/ci.mjs`：83 单元 + 29 E2E。

## Consequences

- 作者可以在面板查看正文/章纲历史并回滚；回滚是追加 revision，历史不会丢失，current 仍只有一个权威。
- 正文回滚回到 written，必须重新审稿；摘要/审稿不被删除但不再覆盖当前正文；state draft 失效。
- 章纲回滚只允许未写正文的章节，批准清空；已写章节要改章纲先处理正文。
- adoption 计入 3 轮修订上限，不能靠回滚绕过。
- 面板在定稿/非 planned 状态下禁用回滚按钮并给原因；服务端仍做最终校验。
- 标题不随正文版本回滚；state 事件不回滚；整库回退仍归 A10 备份恢复。
