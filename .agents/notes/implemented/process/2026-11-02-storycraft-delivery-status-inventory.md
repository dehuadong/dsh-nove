# Agent Note: 故事工坊：交付状态盘点（R0b）

Status: implemented

## Problem

旧 roadmap 与 parity-matrix 中的“已交付/已对齐”建立在旧对拍口径上，不能证明新基线完成。R0 已裁决 B 不保留为目标，并确定角色 agent/prompt/tool-schema 分层；因此必须先盘点 90 篇 implemented Note，再按新基线重排。

## Decision

- 90 篇 implemented Note 全部登记，不删除、不改写旧 Testing；
- 状态使用 `legacy-delivered`、`revalidate-only`、`rework-required`、`deferred`、`cancelled`；2026-11-03 起新增 `archived`，表示盘点后已归档、不再参与重验；
- 当前盘点：**revalidate-only 76、rework-required 11、legacy-delivered 2、archived 1**（结构相关合计 13）；
- 受影响篇目指向 R1（architect）、R2（角色边界）、R3（基础设施）或 R4（重验）；
- 2026-11-03 审计：`2026-10-23-storycraft-longform-method-references` 已归档，盘点存量变为 89 implemented + 1 archived，加载契约由 [统一技能 references 加载契约](./2026-11-02-storycraft-skill-reference-loading.md) 接管；
- 不把旧“已交付”改写成新基线完成。

## Inventory

### 汇总

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| revalidate-only | 77 | 行为可能仍有效，R4 回归/重验 |
| rework-required | 11 | 角色/prompt/schema/技能边界需整改 |
| legacy-delivered | 2 | 旧口径已交付，待 R1/R2 重做或重验 |
| deferred/cancelled | 0 | 本批 implemented 中无 |

### 明细

| Note | Class | R0b status | Next |
| --- | --- | --- | --- |
| [2026-10-17-storycraft-bible-and-brief](../architecture/2026-10-17-storycraft-bible-and-brief.md) | architecture | revalidate-only | R4 |
| [2026-10-17-storycraft-orchestration](../architecture/2026-10-17-storycraft-orchestration.md) | architecture | revalidate-only | R4 |
| [2026-10-17-storycraft-stage-gate](../architecture/2026-10-17-storycraft-stage-gate.md) | architecture | revalidate-only | R4 |
| [2026-10-17-storycraft-two-phase-commit](../architecture/2026-10-17-storycraft-two-phase-commit.md) | architecture | revalidate-only | R4 |
| [2026-10-18-storycraft-role-agents](../architecture/2026-10-18-storycraft-role-agents.md) | architecture | rework-required | R2 |
| [2026-10-18-storycraft-single-preset-and-forms](../architecture/2026-10-18-storycraft-single-preset-and-forms.md) | architecture | revalidate-only | R4 |
| [2026-10-18-storycraft-volumes-and-window](../architecture/2026-10-18-storycraft-volumes-and-window.md) | architecture | revalidate-only | R4 |
| [2026-10-19-storycraft-role-input-contracts](../architecture/2026-10-19-storycraft-role-input-contracts.md) | architecture | rework-required | R2 |
| [2026-10-19-storycraft-single-mode-delegation](../architecture/2026-10-19-storycraft-single-mode-delegation.md) | architecture | revalidate-only | R4 |
| [2026-10-19-storycraft-sqlite-store](../architecture/2026-10-19-storycraft-sqlite-store.md) | architecture | revalidate-only | R4 |
| [2026-10-19-storycraft-works-scope-guard](../architecture/2026-10-19-storycraft-works-scope-guard.md) | architecture | revalidate-only | R4 |
| [2026-10-20-storycraft-artifact-identity](../architecture/2026-10-20-storycraft-artifact-identity.md) | architecture | revalidate-only | R4 |
| [2026-10-20-storycraft-host-delegation](../architecture/2026-10-20-storycraft-host-delegation.md) | architecture | rework-required | R2 |
| [2026-10-20-storycraft-role-submission](../architecture/2026-10-20-storycraft-role-submission.md) | architecture | rework-required | R2 |
| [2026-10-21-storycraft-summary-revision-binding](../architecture/2026-10-21-storycraft-summary-revision-binding.md) | architecture | revalidate-only | R4 |
| [2026-10-21-storycraft-summary-transport](../architecture/2026-10-21-storycraft-summary-transport.md) | architecture | revalidate-only | R4 |
| [2026-10-22-storycraft-material-purpose](../architecture/2026-10-22-storycraft-material-purpose.md) | architecture | revalidate-only | R4 |
| [2026-10-22-storycraft-material-title-index](../architecture/2026-10-22-storycraft-material-title-index.md) | architecture | revalidate-only | R4 |
| [2026-10-23-storycraft-artifact-contract-v2](../architecture/2026-10-23-storycraft-artifact-contract-v2.md) | architecture | revalidate-only | R4 |
| [2026-10-23-storycraft-form-aware-delegation](../architecture/2026-10-23-storycraft-form-aware-delegation.md) | architecture | rework-required | R2 |
| [2026-10-23-storycraft-state-preflight](../architecture/2026-10-23-storycraft-state-preflight.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-bible-artifacts](../architecture/2026-10-24-storycraft-bible-artifacts.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-chapter-artifact-remap](../architecture/2026-10-24-storycraft-chapter-artifact-remap.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-chapter-identity-approval](../architecture/2026-10-24-storycraft-chapter-identity-approval.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-consumer-migration](../architecture/2026-10-24-storycraft-consumer-migration.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-foundation-consumers](../architecture/2026-10-24-storycraft-foundation-consumers.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-memo-migration](../architecture/2026-10-24-storycraft-memo-migration.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-observation-migration](../architecture/2026-10-24-storycraft-observation-migration.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-planner-delegation](../architecture/2026-10-24-storycraft-planner-delegation.md) | architecture | rework-required | R2 |
| [2026-10-24-storycraft-state-migration](../architecture/2026-10-24-storycraft-state-migration.md) | architecture | revalidate-only | R4 |
| [2026-10-24-storycraft-summary-migration](../architecture/2026-10-24-storycraft-summary-migration.md) | architecture | revalidate-only | R4 |
| [2026-10-26-storycraft-context-budget-trace](../architecture/2026-10-26-storycraft-context-budget-trace.md) | architecture | rework-required | R3 |
| [2026-10-27-storycraft-byte-binding-and-engines](../architecture/2026-10-27-storycraft-byte-binding-and-engines.md) | architecture | revalidate-only | R4 |
| [2026-10-28-storycraft-settle-finalize-split](../architecture/2026-10-28-storycraft-settle-finalize-split.md) | architecture | revalidate-only | R4 |
| [2026-10-29-storycraft-role-model-parity](../architecture/2026-10-29-storycraft-role-model-parity.md) | architecture | rework-required | R2 |
| [2026-10-30-storycraft-a10-projection-recovery](../architecture/2026-10-30-storycraft-a10-projection-recovery.md) | architecture | revalidate-only | R4 |
| [2026-10-30-storycraft-a12-revision-adoption](../architecture/2026-10-30-storycraft-a12-revision-adoption.md) | architecture | revalidate-only | R4 |
| [2026-10-30-storycraft-f13-perf-budget](../architecture/2026-10-30-storycraft-f13-perf-budget.md) | architecture | revalidate-only | R4 |
| [2026-10-30-storycraft-f8-call-observability](../architecture/2026-10-30-storycraft-f8-call-observability.md) | architecture | revalidate-only | R4 |
| [2026-10-31-storycraft-f14-retry-budget](../architecture/2026-10-31-storycraft-f14-retry-budget.md) | architecture | revalidate-only | R4 |
| [2026-11-02-storycraft-design-cards-dispatch](../architecture/2026-11-02-storycraft-design-cards-dispatch.md) | architecture | rework-required | R1 |
| [2026-11-02-storycraft-foundation-resource-relocation](../architecture/2026-11-02-storycraft-foundation-resource-relocation.md) | architecture | revalidate-only | R4 |
| [2026-10-20-storycraft-production-parity](../bug-fix/2026-10-20-storycraft-production-parity.md) | bug-fix | revalidate-only | R4 |
| [2026-10-20-storycraft-reviser-recovery](../bug-fix/2026-10-20-storycraft-reviser-recovery.md) | bug-fix | revalidate-only | R4 |
| [2026-10-20-storycraft-workbench-freshness](../bug-fix/2026-10-20-storycraft-workbench-freshness.md) | bug-fix | revalidate-only | R4 |
| [2026-10-24-storycraft-settle-timeout](../bug-fix/2026-10-24-storycraft-settle-timeout.md) | bug-fix | revalidate-only | R4 |
| [2026-10-27-storycraft-gate-panel-architect-remediation](../bug-fix/2026-10-27-storycraft-gate-panel-architect-remediation.md) | bug-fix | legacy-delivered | R1 |
| [2026-10-30-reviewer-quote-retry](../bug-fix/2026-10-30-reviewer-quote-retry.md) | bug-fix | revalidate-only | R4 |
| [2026-10-30-story-read-state-draft](../bug-fix/2026-10-30-story-read-state-draft.md) | bug-fix | revalidate-only | R4 |
| [2026-11-02-storycraft-story-read-foundation](../bug-fix/2026-11-02-storycraft-story-read-foundation.md) | bug-fix | revalidate-only | R4 |
| [2026-10-18-storycraft-outline-stage](../feature/2026-10-18-storycraft-outline-stage.md) | feature | revalidate-only | R4 |
| [2026-10-18-storycraft-quality-layer](../feature/2026-10-18-storycraft-quality-layer.md) | feature | revalidate-only | R4 |
| [2026-10-19-storycraft-outline-approval](../feature/2026-10-19-storycraft-outline-approval.md) | feature | revalidate-only | R4 |
| [2026-10-19-storycraft-retrieval](../feature/2026-10-19-storycraft-retrieval.md) | feature | revalidate-only | R4 |
| [2026-10-21-storycraft-material-ingest](../feature/2026-10-21-storycraft-material-ingest.md) | feature | revalidate-only | R4 |
| [2026-10-21-storycraft-panel-export](../feature/2026-10-21-storycraft-panel-export.md) | feature | revalidate-only | R4 |
| [2026-10-21-storycraft-retrieval-fts](../feature/2026-10-21-storycraft-retrieval-fts.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-bible-edit](../feature/2026-10-22-storycraft-bible-edit.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-brief-retrieval](../feature/2026-10-22-storycraft-brief-retrieval.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-chapter-edit](../feature/2026-10-22-storycraft-chapter-edit.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-epub-export](../feature/2026-10-22-storycraft-epub-export.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-panel-redesign](../feature/2026-10-22-storycraft-panel-redesign.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-style-samples](../feature/2026-10-22-storycraft-style-samples.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-txt-export](../feature/2026-10-22-storycraft-txt-export.md) | feature | revalidate-only | R4 |
| [2026-10-22-storycraft-unified-retrieval](../feature/2026-10-22-storycraft-unified-retrieval.md) | feature | revalidate-only | R4 |
| [2026-10-23-storycraft-backup-restore](../feature/2026-10-23-storycraft-backup-restore.md) | feature | revalidate-only | R4 |
| [2026-10-23-storycraft-semantic-state-check](../feature/2026-10-23-storycraft-semantic-state-check.md) | feature | revalidate-only | R4 |
| [2026-10-23-storycraft-settler-auto-projection](../feature/2026-10-23-storycraft-settler-auto-projection.md) | feature | revalidate-only | R4 |
| [2026-10-24-storycraft-foundation-production](../feature/2026-10-24-storycraft-foundation-production.md) | feature | legacy-delivered | R1 |
| [2026-10-27-storycraft-action-gates](../feature/2026-10-27-storycraft-action-gates.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-a9-skill-evidence](../feature/2026-10-31-storycraft-a9-skill-evidence.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-b1-epub-pdf-materials](../feature/2026-10-31-storycraft-b1-epub-pdf-materials.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-b2-skill-search](../feature/2026-10-31-storycraft-b2-skill-search.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-b2b-context-skill-retrieval](../feature/2026-10-31-storycraft-b2b-context-skill-retrieval.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-dashboard-e1-e5](../feature/2026-10-31-storycraft-dashboard-e1-e5.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-e13-self-check](../feature/2026-10-31-storycraft-e13-self-check.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-e6-analysis](../feature/2026-10-31-storycraft-e6-analysis.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-e7-call-logs](../feature/2026-10-31-storycraft-e7-call-logs.md) | feature | revalidate-only | R4 |
| [2026-10-31-storycraft-f5-backup-materials](../feature/2026-10-31-storycraft-f5-backup-materials.md) | feature | revalidate-only | R4 |
| [2026-11-01-storycraft-e18-work-chapter-filters](../feature/2026-11-01-storycraft-e18-work-chapter-filters.md) | feature | revalidate-only | R4 |
| [2026-11-01-storycraft-r5b-threadrefs](../feature/2026-11-01-storycraft-r5b-threadrefs.md) | feature | revalidate-only | R4 |
| [2026-10-18-storycraft-worker-skills](2026-10-18-storycraft-worker-skills.md) | process | rework-required | R3 |
| [2026-10-23-storycraft-longform-method-references](../../archived/process/2026-10-23-storycraft-longform-method-references.md) | process | archived | — |
| [2026-10-24-storycraft-ts-migration](2026-10-24-storycraft-ts-migration.md) | process | revalidate-only | R4 |
| [2026-10-24-storycraft-ts-pilot](2026-10-24-storycraft-ts-pilot.md) | process | revalidate-only | R4 |
| [2026-10-26-storycraft-bundled-build](2026-10-26-storycraft-bundled-build.md) | process | revalidate-only | R4 |
| [2026-10-26-storycraft-release-packaging](2026-10-26-storycraft-release-packaging.md) | process | revalidate-only | R4 |
| [2026-10-29-agent-notes-dsh-migration](2026-10-29-agent-notes-dsh-migration.md) | process | revalidate-only | R4 |
| [2026-10-31-storycraft-implement-gate](2026-10-31-storycraft-implement-gate.md) | process | revalidate-only | R4 |
| [2026-11-02-storycraft-skill-reference-loading](2026-11-02-storycraft-skill-reference-loading.md) | process | revalidate-only | R4 |

## Archive disposition

本批**不归档任何 Note**：

- R0 的新方案尚未在 R1/R2 落地，替代关系还不完整；
- 若此时归档旧 Note，会把仍 active 的合同/证据冻结；
- 只有新 Note 吸收旧篇独特理由/备选/后果/验证缺口、入站链接改完后，才执行
  `npx tsx .agents/skills/write-agent-notes/scripts/archive-agent-note.ts <implemented-note> --superseded-by <新笔记>`；
- 部分取代保留双方并手工互链；仅需重验保留 implemented。

## Alternatives considered

**A. 全部归档。** 最强理由是彻底切断旧基线。否决原因：大量存储/UI/导出/检索 Note 仍有独立证据价值，归档会冻结 active 事实，违反 write-agent-notes。

**B. 全部保持 implemented。** 最强理由是尊重历史。否决原因：旧“已交付”会被误读为新基线完成，R0b 的目的失败。

**C. 只改 roadmap 不改 Note。** 最强理由是少动。否决原因：90 篇是实际证据载体；没有逐篇处置，状态重置不可审计。

## Consequences

- parity-matrix 成为状态表属主，roadmap 只链接状态；
- 13 篇结构相关 Note（11 rework + 2 legacy）进入 R1/R2/R3，77 篇进入 R4 回归；
- 旧 CI 通过只算回归，不等于新基线完成；
- 后续归档必须逐篇执行，不批量。

## Testing

- `npm run verify-notes`：100+ 篇通过；
- 盘点覆盖 90/90 implemented Note；
- 本项不改业务代码，不运行 E2E。
