# Agent Note: 故事工坊：交付状态重审与对拍基线重排期

Status: rejected — 历史排期重审：状态词汇已被状态与证据唯一来源取代；见 implemented/process/2026-11-03-storycraft-status-evidence-ownership.md

工作项：当前任务（不新建 GitHub issue）。对旧基线下的“已实现/已交付”做状态重置，按新基线和 `write-agent-notes` 生命周期重新排期。

## Problem

`implemented/` 现有 90 篇、roadmap 有约 33 处“已交付/已关闭/已迁移”，这些结论大多建立在**旧对拍口径**上：

- 旧口径把 architect 四阶段拆成四个子代理；
- 旧口径把技能资源当作“可裁剪的方法”；
- 旧口径没有按 agent/prompt/tool-schema/state 的职责边界验收；
- 旧 Testing 只证明旧合同，不证明新基线。

R0 已确认参考是“同一 architect 内四段顺序调用 + 角色 agent/prompt/tool-schema 分层”。因此旧完成状态不能直接继承，必须做一次**交付状态重置**与重排期；否则 roadmap 会继续用旧完成度掩盖新差距。

## 对拍参考

- `docs/report/inkos/01.md:105-151`：Skill/References 与 Architect 分阶段；
- `inkos-master/packages/core/src/agents/architect.ts:269-332`：同一 agent 四段；
- `docs/report/inkos/2026-10-23-full-project-parity-audit.md`、`2026-10-23-artifact-and-resource-parity-audit.md`：产物/资源对拍；
- [对拍基线重审](../architecture/2026-11-02-storycraft-parity-rebaseline.md)：本项的上位裁决。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
|---|---|---|---|---|
| 以当前参考结构验收 | 旧 Note 只作历史证据 | 旧测试不覆盖新边界 | 采纳 | 状态表 |
| 已完成状态可追溯 | 加 baseline/status 列，不改旧 Testing | 保留历史，不伪造完成 | 采纳 | 矩阵 |
| 完全被取代才归档 | 部分取代保留并互链 | write-agent-notes 规则 | 采纳 | `verify-notes` |

## Proposal

### 状态词汇

旧条目不直接改写为“未完成”，而是增加新状态：

- `legacy-delivered`：旧口径已交付，未按新基线重验；
- `revalidated`：按新基线重验通过；
- `rework-required`：结构/上下文/技能边界不符，需整改；
- `revalidate-only`：行为可能仍有效，只需回归；
- `deferred` / `cancelled`：未做/作者取消。

`implemented` Note 的 `Status` 仍保留 `implemented`；状态重置写在 parity-matrix/roadmap，不篡改历史 Note 的 Testing。

### R0b 交付状态盘点

**范围**

- 90 篇 `implemented/` Note；
- roadmap 全部“已交付/已关闭/已迁移”行；
- parity-matrix 的“已对齐/已采纳/部分”状态行（状态表的属主）；
- 仅覆盖产品行为、角色、上下文、技能、产物；纯工具链/打包可标 `revalidate-only`。

**分类**

| 类别 | 例子 | 处置 |
|---|---|---|
| 基线无关 | 存储、备份、导出、面板基础、E2E 基建 | `revalidate-only` |
| 部分受影响 | E18 筛选、检索、UI 读模型 | `revalidate-only` + 回归 |
| 结构受影响 | architect/foundation、writer/reviewer/planner/reviser/settler、composer/context、skill 路由 | `rework-required` 或 `legacy-delivered` |
| 已取消 | A1b、E2 阅读器、D2/D3 等 | `cancelled` |
| 延期 | S/D | `deferred` |

**产出**

- 一张“能力/旧状态/新状态/证据缺口/所属阶段”表，**属主是 parity-matrix**；
- 每篇受影响 Note 的处置：保留、部分取代、完全取代、归档；
- roadmap 不再出现未加基线标注的“已交付”，状态链接到 matrix。

### 归档与取代（write-agent-notes）

- **部分取代**：旧 `implemented` Note 保留，双方**手工**加相对链接；只更新仍成立的事实，不重写 Decision。
- **完全取代**：新 Note 吸收旧篇的独特理由/备选/后果/验证缺口；入站链接改完后用
  `npx tsx .agents/skills/write-agent-notes/scripts/archive-agent-note.ts <implemented-note> --superseded-by <新笔记>` 归档；不物理删除。
- **仅需重验**：保留 `implemented`，在矩阵标 `revalidate-only`，补回归证据。
- **无防坑价值的过时提案**：按 skill 规则处理，不归档垃圾。
- 不批量归档 90 篇；只对“完全被新结构取代且无独立证据价值”的篇目执行归档。

### 重排期

1. **R0b 状态盘点**：产出分类表与 Note 处置，不改代码；
2. **R1 architect**：按 R0 裁决恢复四段/等价 runtime；
3. **R2 角色边界**：writer/reviewer/planner/reviser/settler 拆 agent/prompt/schema；
4. **R3 基础设施**：store-db/tools/context/client 拆职责；
5. **R4 重验**：逐能力跑旧回归 + 新契约 + 真实链路；
6. S/D 仅在 R4 后重开。

### 完成定义

任何条目只有同时满足：

- 新基线证据存在；
- 角色输入/输出/失败链路有测试；
- 真实链路抽查通过；

才可从 `legacy-delivered` 变为 `revalidated`。旧 CI 通过只算回归，不算完成。

## Alternatives considered

**A. 直接保留旧“已交付”，只改文档措辞。** 最强理由是尊重历史。否决原因：旧测试不覆盖新边界，继续用旧状态会误导排期，违背“对拍是规格”。

**B. 把 90 篇全部重写为 `rework-required`。** 最强理由是彻底。否决原因：大量存储/UI/工具链与角色边界无关，全部重写会制造噪音；应分类，不是一刀切。

**C. 全部归档后从零重来。** 最强理由是干净。否决原因：旧 Note 仍有真实历史证据和防坑价值；write-agent-notes 要求部分取代保留、完全取代才归档。

## Acceptance criteria

1. 90 篇 implemented Note、roadmap 已交付行与 parity-matrix 状态行完成分类，产出状态表；
2. 旧“L 完成/已对齐”一律标为 `legacy-delivered` 或撤回，不冒充新基线完成；
3. 受影响 Note 有明确处置（保留/部分取代/完全取代/归档），部分取代双方互链；
4. 完全取代的归档走 `.agents/skills/write-agent-notes/scripts/archive-agent-note.ts --superseded-by`（仅 implemented 路径），保留 manifest；
5. roadmap 增加 R0b，R1–R4 依赖明确；
6. 本项不改业务代码；
7. `verify-notes` 通过。

## Risks

- 分类会暴露大量旧工作，需要按域推进，不能一次重审全部；
- “完全取代”判断过宽会丢失历史证据；只对无独特理由的篇目归档；
- 旧 Testing 仍可能对新行为有回归价值，不能因状态重置删除测试；
- R0b 只做盘点，不解决结构问题；R1 仍要单独实现。
