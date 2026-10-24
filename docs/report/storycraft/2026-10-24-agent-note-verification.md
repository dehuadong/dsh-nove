# Agent Note 归档核验（2026-10-24）

这是对 2026-10-24 批量从 `proposed/pipeline` 移到 `implemented/pipeline` 的 17 份 Note 的逐份核验记录。

## 方法

每份 Note 按四项核对：

1. 对应工作项已关闭或有明确验收证据；
2. 设计中点名的代码路径/符号存在；
3. 对应测试文件存在，且 `node storycraft/scripts/ci.mjs --no-e2e` 通过（50 个单元文件）；
4. 真实链路证据只在其确实覆盖的范围内引用；未覆盖的产品差距不得写成“已完成”。

机械检查 `node scripts/decisions/check.mjs` 通过（61 条记录）。

## 核验结果

| Note | 工作项 | 代码/测试证据 | 结果 |
| --- | --- | --- | --- |
| 2026-10-19-storycraft-retrieval.md | #16 | `retrieval.test.mjs`、`store-search.test.mjs` | 通过 |
| 2026-10-19-storycraft-works-scope-guard.md | #17 | `scope.js`、`scope.test.mjs` | 通过 |
| 2026-10-20-storycraft-artifact-identity.md | #22 | `artifact-store.js`、`artifact-store.test.mjs`；已注明被 v2 合同部分替代 | 通过 |
| 2026-10-20-storycraft-host-delegation.md | #19 | `delegate.js`、`delegate.test.mjs` | 通过 |
| 2026-10-20-storycraft-role-submission.md | #23 | `submission.js`、`submission.test.mjs` | 通过 |
| 2026-10-20-storycraft-reviser-recovery.md | #23 | 复核说明：实现并入 `story_submit`，本 Note 是证据记录 | 通过（非独立设计） |
| 2026-10-23-storycraft-artifact-contract-v2.md | #45–#49 | `artifact-contract.js`、`artifact-contract.test.mjs` | 通过 |
| 2026-10-24-storycraft-memo-migration.md | #53 | `renderChapterMemo`、`memo-consumers.test.mjs` | 通过 |
| 2026-10-24-storycraft-chapter-artifact-remap.md | #56 | `remapChapterArtifacts`、`artifact-remap.test.mjs` | 通过 |
| 2026-10-24-storycraft-chapter-identity-approval.md | #55 | 批准 API/面板、`store-chapter.test.mjs` | 通过 |
| 2026-10-24-storycraft-summary-migration.md | #57 | `summary:<n>`、`summary-binding.test.mjs`、`summary-consumers.test.mjs` | 通过 |
| 2026-10-24-storycraft-state-migration.md | #58 | v2 事件、`state-v2-settle.test.mjs`、`state-events.test.mjs` | 通过 |
| 2026-10-24-storycraft-bible-artifacts.md | #59 | `bible-artifacts.test.mjs` | 通过 |
| 2026-10-24-storycraft-foundation-consumers.md | #60 | `foundation-consumers.test.mjs` | 通过 |
| 2026-10-24-storycraft-foundation-production.md | #44 | `foundation-production.test.mjs`；真实会话四阶段 | 通过 |
| 2026-10-24-storycraft-observation-migration.md | #52 | `writeReview`、`observation-consumers.test.mjs`；真实审稿 issue/resolved | 通过 |
| 2026-10-24-storycraft-consumer-migration.md | #51 | 各切片测试；真实单章链路 #50 | 通过（范围仅迁移切片） |

## 发现（不影响归档，但需要后续处理）

1. `consumer-migration` 声称“旧结构退役”，但 `db.js` 仍保留 `CREATE TABLE chapter_plans` 与 `CREATE TABLE summaries` 的空表定义；全仓没有读写这些表的代码。属于**死 schema 清理**，不影响迁移切片已交付的判断。
2. `consumer-migration` 的验证只引用 `#50` 单章；L 产品层差距（planner、上下文预算、多章等）归 `#62`，不能据此外推 L 完成。
3. `reviser-recovery` 是 #19 的实测证据，设计实现归 #23；保留 implemented 但不应作为独立能力再排期。
4. `artifact-identity` 与 `artifact-contract-v2` 的替代关系已在两份 Note 中互相写明；未删除旧 Note，因为其独立理由仍有价值。

## 结论

17 份归档记录的交付证据成立；没有发现需要退回 `proposed` 的记录。剩余两项 `proposed/pipeline`（对拍矩阵、skill-organization-v2）按原判断保留。死 schema 清理另立工作项，不在文档治理里顺手改。
