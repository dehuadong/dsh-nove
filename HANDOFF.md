# 交接文档：故事工坊 #23 / #19 已完成，下一步 #21 清稿与 token 治理

> 更新时间：2026-10-21  
> 交接范围：`dehuadong/dsh-nove` 的故事工坊（`storycraft/`）；#23 与 #19 已完成真实单章复验并关闭。

## 1. 当前结论

### 已完成并关闭

- **#23 角色结果结构化提交**：两章共 6 个子代理（writer / reviewer / reviser）全部只调用 `story_submit`，最终回答均为「已提交」（3 字符）；父回执含 `submissionAttempts` / `lastMode` / `wordRange`，不含正文。
- **#19 真实链路**：
  - 无手动 `subagent` / `story_write` / `story_revise`，无正文回退；
  - writer 第 1 章两次 `submit-word-range`（1,042 / 1,165 < 1,200）后被拒，第 3 次提交 1,247 字成功，同轮重提；
  - AC6 clean 窗口：第 2 章 **2,107**、第 1 章补完 bible 后 **1,758**，均 ≤4,000；
  - 首次建档 `bible-missing` episode **6,290** 单独记录（≤10,000，不并入 clean 值）。
- **#22 回归**：主会话无 `works/` 或 `.dsh/` 路径；只按 `artifactId` 读取当前章，无跨章读正文。
- **#21 warning-only**：只返回 `warnings`，未阻断落盘（有「交叉两」「看见山」「用袖口」等误报）。

### 未完成

- **#21 清稿路径**：两章审稿都各有 6 条问题，空清单清稿仍未真实触发；该链路仍归 #21。
- **token 治理**：摘要前 `story_read` 把整章读回主会话（第 1 章 2,224；第 2 章同类）。#19 AC3 把 summary/state 排除在 AC6 之外，所以这不是 AC6 失败，但整体成本仍高；建议单列工单：新增摘要委派或宿主侧摘要。
- **P2 测试补强**：SubmissionStore TTL/过期清理、`SUBMIT_OUTPUT` 失败 envelope 的 DSH 级校验、真实链路 token 预算。

## 2. 证据

- 会话：`session-91e3c83e-05b6-4781-b319-a3f539b74ef8`
- 作品：《雪线邮路》，longform，单章 1200–1800 字；第 1 章 `settled` `r2` 1,485 字，第 2 章 `settled` `r2` 1,703 字，`openProblems 0`
- 报告：`.agents/notes/proposed/pipeline/2026-10-20-storycraft-live-test-report.md`（commit `b54c802`）
- Issue：
  - #23 验收评论：https://github.com/dehuadong/dsh-nove/issues/23#issuecomment-6306480229
  - #19 复验评论：https://github.com/dehuadong/dsh-nove/issues/19#issuecomment-6306484556
  - #21 回归评论：https://github.com/dehuadong/dsh-nove/issues/21#issuecomment-6306491670
  - #22 回归评论：https://github.com/dehuadong/dsh-nove/issues/22#issuecomment-6306491995

### 量化

| 指标 | 2026-10-20 | 2026-10-21 |
| --- | --- | --- |
| 主会话工具参数 + 结果（第 1 章整轮） | 26,538 | 18,909（-29%） |
| #19 AC6 clean 窗口 | 未测 | 2,107（第 2 章）/ 1,758（第 1 章 setup 后） |
| 首次建档 setup episode | — | 6,290 |
| 总 token（第 1 章） | 1,459,887 | 865,521 |
| 手动正文回退 | 3 次 | 0 |
| 子代理最终回答正文 | 有 | 无 |

## 3. 代码落点

- `storycraft/submission.js`：SubmissionStore、提交校验、3 次上限、单次消费。
- `storycraft/revision.js`：`assertRevisionMode`，与 `reviseChapter` 共用。
- `storycraft/tools.js`：`story_submit` 动作与 `SUBMIT_OUTPUT`。
- `storycraft/delegate.js`：注入 `delegationId`、消费提交、宿主落盘。
- `storycraft/landing.js`：委派 writer/reviser 的 min/max 硬校验。

## 4. 下一步

### P1：#21 空审稿清稿

- 真实触发一次 reviewer 返回空清单的章节，确认清稿允许空清单、阶段能继续；
- 若真实链路再次暴露新问题，先按 `AGENTS.md` 查参考实现，再决定是否立工单。

### P2：token 治理

- 摘要通道：让摘要不经过主会话全文读取（摘要委派或宿主侧生成）；
- 保留并补充 SubmissionStore TTL、`SUBMIT_OUTPUT` 失败 envelope、主会话 token 预算测试。

## 5. 已知风险/边界

- 工具调用参数仍可能显示正文；验收只约束子代理**最终回答**无正文，不承诺 UI 完全隐藏。
- `story_submit` 不写作品库；父代理是唯一落盘者。
- 旧会话里已经打开/加载的旧工具不会热替换；必须新会话或重载插件。
- E2E 依赖 Playwright；本机命令使用：
  `DSH_E2E_PLAYWRIGHT_ROOT=C:\Users\MyPC\AppData\Local\npm-cache\_npx\420ff84f11983ee5`
  路径因机器而异，按 `storycraft/e2e/run.mjs` 提示调整。
- 本轮曾误建一个空的 storycraft 会话 `session-65e62e3e-3281-4eb9-b8a6-5f01d7b5aabd`，未使用，可忽略。

## 6. 建议技能

- `implement`：继续 #21 清稿与 token 治理的实施修正；
- `code-review`：对 `d01a79f..7ca6a33` 做 Standards/Spec 复审；
- `verify`：下一轮真实清稿链路通过后做最终验收；
- `diagnosing-bugs`：若出现 `delegation-no-submission`、字数/mode 异常；
- `handoff`：下一次会话结束再交接。

## 7. 不要做

- 不要把“22 个单元 + E2E 通过”代替真实单章验收；
- 不要把 `story_submit` 失败改成主编重试或手动正文搬运；
- 不要恢复 `patch→polish→rewrite` 自动阶梯；
- 不要让子代理直接落盘；
- 不要删除 #19 的历史证据，它仍是验证依据。
