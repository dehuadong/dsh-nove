# 交接文档：故事工坊 #23 / #19 实现与下一步

> 更新时间：2026-10-20  
> 交接范围：`dehuadong/dsh-nove` 的故事工坊（`storycraft/`）；#23 已实现，真实链路尚未验收。

## 1. 当前结论

### 已完成

- #23 角色结果结构化提交已实现：
  - 第 30 个动作 `story_submit`；
  - `SubmissionStore` 绑定 `role/work/chapter/mode/wordRange`；
  - 最多 3 次提交；失败返回 `retryable/actual/limit`，不消费 entry；
  - 成功后才允许父代理消费；父代理负责落盘。
- #19 的 reviser 校验已并入同一通道：
  - writer/reviser min/max 都硬校验；
  - reviser `patch`/`polish`/`rewrite`/`deslop` 使用共享 `revisionChecks`；
  - 8 字 rewrite 被 `submit-word-range` 拒绝；
  - 手动 `story_write` / `story_revise` 不新增字数校验。
- `story_delegate` 不再解析子代理最终文本，不再给 reviewer 传 `outputSchema`；
- 已删除主编侧的 `patch→polish→rewrite` / `delegation-word-range` 重试阶梯；
- 角色技能与 persona 已改为委派走 `story_submit`，手动路径仍用文本契约。

### 验证状态

```text
node storycraft/scripts/ci.mjs
[ci] PASS: 22 unit files + E2E
```

E2E：9 passed。

这仍**不是**最终真实使用验收，不能据此关闭 #19/#23。

## 2. 提交与 Issue

- `2b2171d` — #23 角色结构化提交与 reviser 校验
- `7ca6a33` — 评审修正（失败 envelope、consume 单次、技能契约、非完成错误码）
- Issue：
  - #23 实现评论：https://github.com/dehuadong/dsh-nove/issues/23#issuecomment-6288724821
  - #19 验证评论：https://github.com/dehuadong/dsh-nove/issues/19#issuecomment-6288725465

设计/证据：

- `.agents/notes/proposed/pipeline/2026-10-20-storycraft-role-submission.md`
- `.agents/notes/proposed/pipeline/2026-10-20-storycraft-reviser-recovery.md`
- `.agents/notes/proposed/pipeline/2026-10-20-storycraft-live-test-report.md`

不要再复制这些文档的完整内容；需要改合同直接改对应 Note/Issue。

## 3. 代码落点

- `storycraft/submission.js`：SubmissionStore、提交校验、3 次上限、单次消费。
- `storycraft/revision.js`：`assertRevisionMode`，与 `reviseChapter` 共用。
- `storycraft/tools.js`：`story_submit` 动作与 `SUBMIT_OUTPUT`。
- `storycraft/delegate.js`：注入 `delegationId`、消费提交、宿主落盘。
- `storycraft/landing.js`：委派 writer/reviser 的 min/max 硬校验。
- `storycraft/package.json`：新增文件已加入 `files`，否则 E2E 装载会找不到模块。
- `storycraft/promptFor`：要求子代理调用 `story_submit`，不再要求 TITLE/CHAPTER/JSON。

## 4. 下一步工作

### P0：真实单章验证

当前 GUI 运行的是旧插件代码。先重新加载/重启故事工坊插件，再用**新会话**跑真实单章；用户提供 `sessionID` 后代理自己跑，不要求用户手工测试。

必须记录：

1. 主会话工具参数 + 结果总字符数，目标 ≤4,000；
2. 是否出现主编手动 `subagent` + `story_write`/`story_revise` 正文回退；
3. 子代理最终回答是否不含正文；
4. reviser 是否还有 8 字成功或 mode 违规被接受；
5. `story_submit` 失败时子代理是否在同一次运行内修正并重提。

通过后：

- 关闭 #23；
- 用同一会话证据完成 #19 的真实链路验证；
- 更新 `2026-10-20-storycraft-live-test-report.md` 的数值与结论，不沿用旧数。

### P1：回归 #22 / #21

- #22：确认模型只拿 artifact ID，不出现 `works/` 路径、不跨章读取；
- #21：验证 clean review 路径，以及未登记人名只 warning、不阻断；
- 若真实链路再次暴露新问题，先按 `AGENTS.md` 查参考实现，再决定是否立工单。

### P2：测试补强

剩余但非阻塞：

- SubmissionStore 的 TTL/过期清理测试（当前只测 unknown/重复/超长/角色绑定/单次消费）；
- `SUBMIT_OUTPUT` 失败 envelope 的 DSH 级校验测试（当前是 schema 字段检查 + 单元返回）；
- 真实链路主会话 token 预算。

## 5. 已知风险/边界

- 工具调用参数仍可能显示正文；验收只约束子代理**最终回答**无正文，不承诺 UI 完全隐藏。
- `story_submit` 不写作品库；父代理是唯一落盘者。
- 旧会话里已经打开/加载的旧工具不会热替换；必须新会话或重载插件。
- E2E 依赖 Playwright；本机命令使用：
  `DSH_E2E_PLAYWRIGHT_ROOT=C:\Users\MyPC\AppData\Local\npm-cache\_npx\420ff84f11983ee5`
  路径因机器而异，按 `storycraft/e2e/run.mjs` 提示调整。

## 6. 建议技能

- `implement`：继续 #23/#19 范围内的实施修正；
- `code-review`：对 `d01a79f..7ca6a33` 做 Standards/Spec 复审；
- `verify`：真实会话通过后做最终验收与结论；
- `diagnosing-bugs`：若真实链路仍出现 `delegation-no-submission`、字数/mode 异常；
- `writing-for-agents`：若需再改 `AGENTS.md` 或技能契约；
- `handoff`：下一次会话结束再交接。

## 7. 新会话开场建议

```text
先读 E:\dsh-nove\HANDOFF.md、AGENTS.md、#23/#19，再继续。
不要重跑已过的开发测试；先确认插件已重载，然后用真实 sessionID 验证 #23/#19。
```

## 8. 不要做

- 不要用“22 个单元 + E2E 通过”代替真实单章验收；
- 不要把 `story_submit` 失败改成主编重试或手动正文搬运；
- 不要恢复 `patch→polish→rewrite` 自动阶梯；
- 不要让子代理直接落盘；
- 不要删除 #19 的历史证据，它仍是验证依据。
