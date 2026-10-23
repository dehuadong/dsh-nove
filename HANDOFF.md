# 交接文档：A0 实现 tickets 已交付，#45 仍待消费者收口（2026-10-23）

> 更新时间：2026-10-23  
> 仓库：`dehuadong/dsh-nove`，分支 `main`，HEAD `64c8194`。
> 本轮范围：A0 #45 的实现 tickets #46–#49；A0 合同 Note 仍为 proposed，#45 仍 in-progress。

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
- **#49 A0-5 共享方法技能与角色薄契约**：`64c8194`
  - `storycraft-long-writing`（4 refs）、`storycraft-short-writing`（production-checklist）、`storycraft-script-writing`（episode-scene-craft）。
  - 角色/形态技能薄化；`storycraft-longform-method` 保留迁移别名；R6a Note 标注部分替代并互链；README/对拍矩阵更新为 14 技能/9 references。

### 验证现状

- 单元：**43 个文件全过**（`node storycraft/scripts/ci.mjs --no-e2e`）。
- 规划文档检查：`node scripts/decisions/check.mjs` 通过（50 条记录）。
- E2E：**未跑**。本机 Playwright/DSH 登录弹窗仍阻塞，不能声称 E2E 通过。
- Implementation Review：每个 ticket 做了 Standards/Spec 双轴复审并修正了 material findings（计划闸门双权威、v6 旧库误判、v2 事件被旧 fold 误读、observation 引文校验、volume_map 校验、短篇/剧本 scope 与统计等）。
- 真实模型/真实链路验收：未做；A0 收口前仍由作者做一次。

## 2. #45 仍未完成的部分

`#45` 的验收 4 要求“每个 A0 产物至少一个真实消费者（brief/context、检索、审稿、结算/对账、UI、导出/备份）”。本轮只完成了存储/合同与部分消费者：

- 已接：ChapterMeta 投影、export/readWork/status 的 planRevision/provenance、reviser 的 observation 读取、短篇/剧本存储层隔离。
- 未接：foundation（story_frame/volume_map/book_rules/roles）没有生产消费者；ChapterMemo/ChapterSummary 的生产者仍是旧 `chapter_plans`/`summaries` 表；hooks/facts v2 投影尚未替换 settler/state 链。这些按 handoff 属于 L/R10b，但 #45 的 AC4 尚未满足。
- 因此：**#46–#49 已关闭，#45 保持 in-progress，不能标 complete。**

## 3. 下一步

1. **收口 A0 消费者**（需新工单或作者重排）：为 foundation/memo/summary/hooks/facts 接 brief/context、检索、审稿、结算或导出中的真实消费者；只写入/读回不算。
2. 消费者收口后再重新规划 **L（R10a/R10b + R9b/R11 迁移）**，然后 S（短篇批量流水线）与 D（剧本 spec/场次）。
3. 若作者决定把消费者整体归入 L，需在 #45 明确改验收，而不是静默把 AC4 当已满足。

## 4. 关键合同/决策

- 产物合同：[`2026-10-23-storycraft-artifact-contract-v2.md`](.agents/notes/proposed/pipeline/2026-10-23-storycraft-artifact-contract-v2.md)。
- Skill 组织：[`2026-10-23-storycraft-skill-organization-v2.md`](.agents/notes/proposed/pipeline/2026-10-23-storycraft-skill-organization-v2.md)。
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
- 不要恢复旧库迁移/兼容；
- 不要在没有消费者的情况下声称 A0 完成；
- 不要删除 #45–#49 或历史证据；
- 不要复制 InkOS 代码/文件；按结构与领域语言重写。
