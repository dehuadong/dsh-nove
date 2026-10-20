---
title: 故事工坊：角色结果结构化提交（保留 DSH subagent）
status: proposed
created: 2026-10-20
updated: 2026-10-20
---

# Agent Note：故事工坊：角色结果结构化提交（保留 DSH subagent）

> 2026-10-20 部分替代：`proposed/pipeline/2026-10-20-storycraft-host-delegation.md` 中“子代理最终文本作为角色结果、父代理解析文本”的传输段由本项替换；DSH subagent、宿主侧编排、`subagent-cannot-land` 保留。

## 问题

`story_delegate` 目前把 DSH 子代理的**最终文本**当角色结果：

```text
子代理最终文本 → bodyOf(result) → 宿主落盘
```

父会话确实只收到紧凑回执（真实轨迹：writer 回执约 256 字符，不含正文），但代价是：

- 子代理必须把整章正文作为最终回答输出，子代理会话显示全文；
- 父代理解析自由文本，缺字段、夹解释、截断都只能靠启发式；
- 审稿/修订同样把 JSON/正文塞进聊天文本，无法做严格的结构与归属校验；
- 正文与审稿结果混在对话记录里，token 与 UI 都被重复占用。

这是**结果通道**问题，不是提示词问题。

## 参考基线与证据

参考工程 `inkos-master` 2.0.0（只读；用户 2026-10-20 授权功能对拍）。只吸收结构化提交的做法，不复制代码或文件。

- writer 调用 `submit_chapter_draft` 提交 `{ title, content }`（`packages/core/src/agents/writer.ts`，`submitStructured`）。
- reviser 有 `submit_chapter_edit_ranges` / `submit_chapter_range_replacements` / `submit_revised_chapter` 等结构化提交（`packages/core/src/agents/reviser.ts`）；spot-fix 优先用范围编辑，不全是整章提交。
- 落盘由 pipeline/runner 调 `writer.saveChapter()` 完成（`packages/core/src/pipeline/runner.ts`），角色 agent 不直接落盘。

关键不是“宿主内 worker”这个 runtime，而是：

1. 角色产出结构化结果；
2. 宿主接收并校验；
3. 宿主负责落盘。

## 与既有记录

- 本项**不替换** `host-delegation` 的 DSH subagent 与宿主侧 `story_delegate` 编排；只替换“最终文本作为角色结果”的传输段。
- 本项不改 #22 的 artifact ID / stage context 契约；#22 的 `story_read` 与阶段作用域保留。
- `role-input-contracts` 把 delegate 当例外、手动路径仍文本返回；本项不改手动路径，只改 delegate 角色通道。
- 交付时在 `host-delegation` 加部分替代 banner，并更新 #23/#22 的验证边界。
- 本 Note 新增 SubmissionStore 10 分钟 TTL；host-delegation 的“无新 TTL”不覆盖本通道。

## 提案

### 1. 协议

```text
story_delegate
  → 生成 delegationId（UUID；它本身就是 bearer token，不另设 nonce）
  → 将 delegationId 注入子代理任务
  → 子代理调用 story_submit(delegationId, payload)
  → story_submit 校验 delegationId、单次提交、大小、payload schema
  → 从 SubmissionStore entry 读取已绑定的 role / work / chapter
  → 写入宿主 SubmissionStore（内存，单次消费，TTL）
  → 子代理最终回答只写“已提交”
  → story_delegate 从 SubmissionStore 取 payload
  → 父代理只做阶段/DB 落盘校验（字数/mode 已在提交时校验）
  → 父代理调 writeChapter / writeReview / reviseChapter 落盘
  → 父会话收紧凑回执
```

`delegationId` 是唯一 bearer token；没有第二个 nonce。`depth > 0` 只表示“这是子代理”，不是认证；认证靠随机 `delegationId`。

### 2. `story_submit` 工具

参数：

```json
{
  "delegationId": "uuid",
  "payload": {}
}
```

- 只允许 `delegationDepthOf(exec) > 0` 的子代理调用；父代理调用返回 `submit-parent-denied`；
- `delegationId` 是 bearer token；work/chapter/role 从 SubmissionStore entry 读取，**不接受 payload 覆盖**；
- 工具不经过 `withCurrentWork`（子会话没有当前作品），也不声明 `mutates`（它不写作品库）；
- 不写作品库，不返回正文，只返回 `{ ok: true, submitted: true, bytes, words? }`；使用独立 `SUBMIT_OUTPUT` schema（含 ok/submitted/bytes/words），不复用共享 `OUTPUT`，否则 registry 会按 `additionalProperties:false` 拒绝；
- 单次提交：entry 已 `consumed` 时返回 `submit-already-consumed`；
- `payload` 最大 64 KiB；超长 `submit-too-large`；
- payload schema：
  - writer：`{ title, body }`；
  - reviewer：`{ items: [{ problem, where, impact, severity, fix, mode }] }`（父代理映射到 store 的 `location/problem/suggestion`）；
  - reviser：`{ body }`（`mode` 与 `resolved` 由父代理持有/计算，不从子代理接收）。
- 缺字段、reviewer 超过 8 条、reviser 的 body 为空均拒绝。

### 2.1 提交时校验（并入 #19 的 reviser 修正）

参考 `runWorkerAgentTool` 的 `validate + maxResultTurns=3`：校验在提交工具内完成，失败回给模型，子代理在同一次运行内修正后重提；宿主不重发角色。

`story_submit` 接收 payload 后、消费 entry 前校验：

- writer：`title` 非空，`body` 的 min/max 都硬校验；
- reviser：`body` 的 min/max 都硬校验；手动 `story_revise` 不新增校验（现状没有 checkWordRange，不能宣称 warning）；
- reviser mode（entry 持有，子代理不能改）：
  - `patch` 改动 ≤ 20%；
  - `polish` 改动 ≤ 40%；
  - `rewrite` 不限制比例；
  - `deslop` 必须减少腔调命中；
- 校验失败返回 `submit-word-range` / `submit-mode-violation`（带实际值、限制、`retryable:true`），**不消费 entry、不落盘**；
- 每次 `story_submit` 调用（含 schema/超长/字数/mode 校验失败）都计一次提交尝试；最多 3 次；第 3 次失败返回 `submit-attempts-exhausted` 给子代理；
- 成功才 `consumed=true`；父代理只读取 accepted 结果；父代理最终只看到 `delegation-no-submission`（含 attempts=3），不把子代理的 exhausted 当成父级错误码；

这直接修掉 #19 的 8 字 rewrite：8 字低于 min，返回 `submit-word-range`，不再成功。

Entry 额外保存 `mode`、`wordRange`、`attempts`；校验读取当前正文用只读 `readChapter`，不写库。

### 3. SubmissionStore

- 模块级内存 Map，key 为 `delegationId`；
- entry：`{ role, workId, chapter, mode?, wordRange?, payload, attempts, createdAt, consumed, bytes }`；
- TTL 10 分钟，单次消费；父代理读完即删除；
- 不持久化、不写 SQLite、不进作品导出；
- 父代理超时/失败时删除 entry，避免残留。

### 4. 父代理

- `delegate.js` 的 `promptFor` 同变更内改写：注入 `delegationId`，要求调用 `story_submit`，删除 `<<<TITLE/CHAPTER>>>`/JSON 输出与“不要调用任何动作”；
- 子代理结束后从 SubmissionStore `consume(delegationId)`；
- 没有提交 → `delegation-no-submission`；不做最终文本兜底；
- 父代理仍负责 `writeChapter` / `writeReview` / `reviseChapter`；字数/mode 不在父代理重复校验，避免 accepted 后二次拒绝；
- 落盘失败只重试落盘或报错，**不重新提交、不回退手动正文**；
- 回执保持紧凑：artifact ID、revision、words、warnings、problems 计数、`submissionAttempts`，不含正文；
- reviewer 的 `REVIEW_SCHEMA`/`outputSchema` 不再传给子代理，避免 `structured_output` 在提交前截断。

### 5. 子代理展示

- 子代理最终回答只报“已提交”；
- 正文在 `story_submit` 的工具调用参数中传输；DSH Web 会展示工具调用参数，`presentCall` 是 Host-local，不能保证 Web 隐藏；
- 验收只保证“最终回答无正文”，不承诺“子代理会话完全看不到正文”；
- 展示层可以折叠/标注“内容已提交”，但不截断或加密 payload。

### 6. 角色技能与组合同步

同一变更内更新：

- `skills/write/storycraft-write-craft`：保留正文标准，增加“委派时调用 story_submit；手动 subagent 时仍用首尾标记”的双模式说明；
- `skills/review/storycraft-review`：items 字段与父代理映射一致；委派时提交，手动时仍返回 JSON；
- `skills/revise/storycraft-revise-craft`：委派时提交 body，手动时仍返回首尾标记；mode/resolved 由父代理处理；
- `storycraft-studio-orchestration` 的角色输出契约；
- `cordis.patch.yml` persona 区分委派/手动：委派只调用 `story_submit` 不落盘；手动 subagent 仍按文本契约返回；
- README 动作数从 29 改为 30，`tests/tools.test.mjs` 的 action 列表与数量同步。

### 7. 失败与清理

| 情况 | 错误码 | 处理 |
| --- | --- | --- |
| 父代理调用 submit | `submit-parent-denied` | 拒绝 |
| delegationId 不存在/过期 | `submit-unknown-delegation` | 拒绝 |
| 已提交过 | `submit-already-consumed` | 拒绝 |
| payload 超长 | `submit-too-large` | 拒绝 |
| payload 缺字段/超限 | `submit-invalid` | 拒绝 |
| 字数越界 | `submit-word-range` | 可重试，不消费 |
| mode 超幅 | `submit-mode-violation` | 可重试，不消费 |
| 提交尝试超过 3 次 | `submit-attempts-exhausted` | 子代理终止；父代理报 `delegation-no-submission`（attempts=3） |
| 子代理没有提交 | `delegation-no-submission` | 父代理失败，不回退解析文本 |
| 父代理超时/中断 | — | 删除 entry |

### 8. 兼容与迁移

- 现有 `story_delegate` 调用方不变；回执字段保持；
- 旧会话的历史文本不迁移；新会话走新通道；
- 手动 `story_write` / `story_review` / `story_revise` 不变；
- 子代理仍不能直接落盘，`subagent-cannot-land` 保留；
- DSH subagent 保留，不改 runtime。

## 备选方案

- **替换成宿主内 worker**：更接近参考，但放弃 DSH subagent；否决。
- **继续解析最终文本**：提示词无法保证格式，子代理会话仍全文；否决。
- **让子代理直接调用 `story_write`/`story_revise`**：会绕过父代理校验与 `subagent-cannot-land`；否决。
- **把正文写临时文件再读**：引入文件路径与清理问题，回到 #22 要消除的路径通道；否决。

## 验收条件

1. 子代理只通过 `story_submit` 交结果，**最终回答**不含正文；每次调用计一次，最多 3 次尝试；
2. 父代理不解析最终文本，只从 SubmissionStore 取结构化结果；
3. 错误/过期 delegationId、payload schema 不符、超长、重复提交、字数越界、mode 超幅、3 次上限被拒绝；entry 绑定关系有测试；
4. 父会话回执不含正文；
5. 子代理仍不能直接落盘；writer/reviser 的 min/max 在提交时硬校验，8 字 rewrite 不再成功；手动路径行为保持现状（没有新增字数校验）；
6. SubmissionStore 单次消费、TTL、失败清理有测试；
7. 单元测试与 E2E 全过；`story_submit` 注册为第 30 个动作；
8. 真实单章链路中父会话无正文，子代理**最终回答**无正文；工具调用参数展示不算失败。

## 风险

- DSH Web 仍可能展示工具调用参数中的正文；验收只约束最终回答，不承诺 UI 完全隐藏；
- 子代理可能忘记调用 `story_submit`；用 `delegation-no-submission` 失败测试约束，不静默回退；
- 内存 SubmissionStore 在宿主崩溃时丢失；父代理必须报失败，不自动重跑整章；
- 角色 payload schema 会随审稿/修订能力变化；变更需同步 #22 与 parity matrix。








