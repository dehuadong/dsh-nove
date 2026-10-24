# 交接文档：A0 tickets 已交付，L-R10a 消费者迁移规划未通过（2026-10-24）

> 更新时间：2026-10-24
> 仓库：`dehuadong/dsh-nove`，分支 `main`，HEAD `e28196f`。
> 本轮范围：A0 #45 的实现 tickets #46–#49 已交付；L-R10a #51、S1 #53、observation #52 已立规划，Plan Review 未通过；#45 仍 in-progress。

## 1. 当前结论

### 已交付（本轮）

- **#46 A0-2 foundation 与章节 artifact 接入 v6 registry**：`7e674d2`
  - foundation token：story_frame / volume_map / book_rules / roles index / role card；章节 token：ChapterMemo（`plan:<n>`）/ ChapterSummary（`summary:<n>`）/ ChapterMeta 投影。
  - 每类走 `artifact-contract.js` 的 ID/scope/content 校验；revision 为内容哈希；旧 revision 不可变可读。
  - 作者闸门：`approveChapterPlan` 绑定当前最新 memo revision；manifest/readWork/status/export 带 planRevision/provenance；`story_next`/`writeChapter`/`delegate`/`context` 的 gate 统一读 `planApproved`。
  - v6 旧库缺 A0 列时 `openWork` 返回 `schema-version-mismatch`。
- **#47 A0-3 hook/fact/observation 合同接入**：`b821090`
  - `state-events.js`：hook upsert 不改状态；progress/mention/defer/resolve/supersede 走转移表；非法转移不写事件；fact upsert/expire 投影有效区间与 sourceChapter。
  - review observation：`review:<n>:r<bodyRev>:<round>`，sourceRefs 必须落在正文或计划文本；`loadRoleInput` 的 reviser 优先读 observation，缺失时回退旧审稿文本。
  - 边界：旧 `foldEvents` 忽略带 `op` 的 v2 事件；旧 state-validation/check/settle 继续消费 text-hook/string-fact。
- **#48 A0-4 短篇/剧本独立 artifact 存储**：`293215f`
  - `short:<id>` / `script:<id>`；不写长篇章表；不接收 `scope.chapter`；必填、编号重复、空场景、字符统计校验。
- **#49 A0-5 共享方法技能与角色薄契约**：`64c8194`（复审修正 `17dc053`）
  - `storycraft-long-writing`（4 refs）、`storycraft-short-writing`（production-checklist）、`storycraft-script-writing`（episode-scene-craft）。
  - 角色/形态技能薄化；`storycraft-longform-method` 保留迁移别名；R6a Note 标注部分替代并互链；README/对拍矩阵更新为 14 技能/9 references。

### 验证现状

- 单元：**43 个文件全过**（`node storycraft/scripts/ci.mjs --no-e2e`）。
- 规划文档检查：`node scripts/decisions/check.mjs` 通过（52 条记录）。
- E2E：**未跑**。本机 Playwright/DSH 登录弹窗仍阻塞，不能声称 E2E 通过。
- Implementation Review：每个 ticket 做了 Standards/Spec 双轴复审并修正了 material findings（计划闸门双权威、v6 旧库误判、v2 事件被旧 fold 误读、observation 引文校验、volume_map 校验、短篇/剧本 scope 与统计等）。
- 真实模型/真实链路验收：未做；A0 收口前仍由作者做一次。

## 2. #45 与 L-R10a 规划现状

`#45` 的验收 4 已按路线图范围修订：A0 只负责消费者映射与可测试契约；真实生产者/消费者归 L-R10a #51，短篇/剧本归 S/D，context/trace 归 R12，observation/reviews 归 #52。

已接：ChapterMeta 投影、export/readWork/status 的 planRevision/provenance、reviser 的 observation 读取、短篇/剧本存储层隔离。
未接：foundation（story_frame/volume_map/book_rules/roles）没有生产消费者；ChapterMemo/ChapterSummary 的生产者仍是旧 `chapter_plans`/`summaries`；hooks/facts v2 投影尚未替换 settler/state 链；observation/reviews 仍走 `reviews`。

因此 **#46–#49 已关闭，#45 仍 in-progress；#53/#56 已实现待最终验收，#54 rejected，#55 仍 planning。**

### S1a-demo #53 实现状态（2026-10-24）

- `story_plan` 写 `plan:<n>`，`chapter_plans` 不再读写；`body`/`threadRefs` 在 action 边界必填。
- `readPlan`/brief/context/readChapter(view:'plan')/export/observation 引文都从 memo 渲染；`story_read(plan:n)` 返回 memo JSON，当前/旧 revision 可读。
- 批准绑定 memo revision，正文首版/重写/修订不清空；`planApprovalState`/`assertPlanApproved` 统一闸门；`blocked` 与 `missing` 分离。
- commit `09b7907`、`125f9ae`、`9c5f0d6`；E2E 未跑（Playwright 环境阻塞）。
- 已知取舍：直接 store 调用允许省略 body（测试 fixture），`story_plan` action 用 `requireBody` 强制。

### S1b #56 实现状态（2026-10-24）

- `remapChapterArtifacts`：删除/移动时只保留每章最新 plan/summary/review 等 chapter-scoped artifact，重算 content-hash，更新 ID/scope/content。
- review target 指向被移动 memo 时重绑；identity 章的 review 也跟随；sourceRefs 的 `chapter:<n>`/`plan:<n>` 同步改号。
- 受影响章的批准/revision 清空；move/delete 都有 backup；settled 章节拒绝。
- `chapter-edit-blocked` 已移除；`artifact-remap.test.mjs` 覆盖移动/删除、review target、身份章、批准清空。
- commit `fc42c4d`、`e28196f`；`node storycraft/scripts/ci.mjs --no-e2e` → 45 个单测文件通过；E2E 未跑。
- 已知取舍：`chapter-remap-conflict` 只在目标已存在同 revision 不同内容时触发，正常一致数据不可达；context/trace 无生产 writer，只随 scope 迁移。

### S1a-demo #53 规划状态（历史）

### S1a-demo 合同补丁 #54 规划状态

#54（`blocked`/章节编辑阻断/store 批准入口）两轮未通过，5 项冲突：

1. `missing` 已承载 `plan-approval`，`blocked` 与其权限未分离；`delegateOf` 仍按 `missing` 抑制。
2. helper 保留“无 memo legacy 通过”，S1a-demo 要求删除该回退；没有 owner/顺序。
3. `chapterRemap(delete)` 只映射幸存章，删除最后章/被删章本身有 memo 时不命中；S0 又不含 memo，出现无 owner 窗口。
4. body/参数校验与 `plan-not-approved` 的先后在 Note/AC 中矛盾。
5. `story_next` 描述、orchestration 技能、面板阻断提示、`readWork.planApproved` 回退的 owner 未落。

### 章节身份与批准合同 #55 规划状态

#55 两轮未通过，根因是“章号=章节身份”与 memo/批准/重编号耦合。仍需裁决：

- **A**：保留章号身份，新建 S1b 负责 memo/章节重映射，接受重编号丢旧 artifact 历史；
- **B**：引入稳定 chapter UUID，改 chapters/artifacts/消费者/UI（更大，但避免反复重映射）；
- **C**：S1a-demo 前禁止所有删/移章，memo 工作暂不承诺章节编辑。

当前 blocker：memo 重映射无 owner；#53/#54 的 `missing/blocked`/错误顺序尚未同步；重编号失效不可测；`outline` absent vs blocked 未区分；§1 的临时 ID/重算 revision 属于 S0/S1b 实现。

### S1b #56 规划状态

#56（章节 artifact 重映射）已起草设计，但 **blocked by #55**：章节身份/批准合同未通过，S1b 的 owner（S0 还是 S1）与重编号失效测试都未定。**#56 目前不做 Plan Review、不实现。**

## 3. 下一步

1. **先裁决章节身份模型 A/B/C**（这是产品/架构分叉，不是实现细节）：
   - A 保留章号身份，S1b 负责重映射；
   - B 引入稳定 chapter UUID；
   - C S1a-demo 前禁止所有删/移章。
2. 裁决后更新 #55，并让 #53/#54/#56 的 AC 以 #55 为准；不要直接实现 #51/#53/#54/#55/#56。
3. 若不继续切片规划，做一次最小代码 spike（memo 写读 + 批准 + 消费者）用证据再回报价。
4. 真实链路 #50 在 L 完成后一次性执行；E2E 环境阻塞解除后补跑。

## 4. 关键合同/决策

- 产物合同：[`2026-10-23-storycraft-artifact-contract-v2.md`](.agents/notes/proposed/pipeline/2026-10-23-storycraft-artifact-contract-v2.md)。
- Skill 组织：[`2026-10-23-storycraft-skill-organization-v2.md`](.agents/notes/proposed/pipeline/2026-10-23-storycraft-skill-organization-v2.md)。
- L-R10a 迁移设计（proposed）：[`2026-10-24-storycraft-consumer-migration.md`](.agents/notes/proposed/pipeline/2026-10-24-storycraft-consumer-migration.md)；#51 未通过 Plan Review。
- 作者闸门：outline/章纲必须作者确认；ChapterMemo 是章纲唯一权威；`planApproved` 要求批准 revision 等于当前最新 memo。
- 只 v6：不做 v1–v5 迁移、legacy 读或 `artifact_contract` 标志。
- hook/fact/observation 新合同与旧 text-hook/string-fact 并存有明确边界，L 再迁移。
- 短篇/剧本不映射到 Chapter；实际流水线/UI 归 S/D。

## 5. 重要风险/边界

- `readChapterMeta` 的 `observationIds` 只列 review artifact；observation 内容消费目前只在 reviser 路径。
- v2 状态事件读取-追加不是原子事务；并发追加可能返回旧投影，L 接 settler 时需收紧。
- `sourceRefs` 引文校验只覆盖本章正文/计划；跨章或摘要引用未开放。
- 旧技能名仍作为迁移别名存在，L 切换路由后下线；当前目录数量以 `skills.test` 为准。
- 真实模型不用于开发测试；最终只做一次作者验收。

## 6. 验证命令

```text
node storycraft/scripts/ci.mjs --no-e2e
node scripts/decisions/check.mjs
git status --short
git log --oneline -6
```

E2E 在环境阻塞解除后再跑；不要在本机弹窗未解决时声称通过。

## 7. 建议技能

- `verify`：A0 消费者收口后做最终验收。
- `planning`：为 A0 消费者新增工单，或把消费者整体改归 L 时更新 #45 验收。
- `implement`：L/S/D 实现。
- `code-review`：每个 ticket/切片复核。
- `research`：需要再核对 InkOS 的 foundation/state 消费路径时，先读 `docs/report/inkos/`。

## 8. 不要做

- 不要把 #45 标 complete 或把 AC4 当已满足；
- 不要把 #51 标 ready 或进入实现；Plan Review 仍有 blocker；
- 不要恢复旧库迁移/兼容；
- 不要在没有消费者的情况下声称 A0 完成；
- 不要删除 #45–#49 或历史证据；
- 不要复制 InkOS 代码/文件；按结构与领域语言重写。
