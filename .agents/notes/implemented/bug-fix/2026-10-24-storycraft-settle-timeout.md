# Agent Note: 故事工坊：修复 story_settle 长时间不返回

Status: implemented

## 问题

真实链路验收（`#50`，session-e839e67a，作品「灰旗」）中，第 1 章清稿审稿、摘要已完成，`story_settle` 调用后 **10 分钟以上不返回**，作品停在 `reviewed`，状态事件为 0；会话子代理计数持续增长到 24。

截图证据显示 settle 子代理：

1. 加载 `storycraft-state-check` 后去找 `long-writing` 的 `references/state-projection.md`；
2. 无 path 的 glob 被 scope guard 拒绝（设计行为）；
3. 用错误路径 `storycraft/skills/writing/storycraft-long-writing` 搜索，rg 报 `IO error`（实际是 `skills/longform/...`）；
4. 再读正确文件后才继续。

这不是宿主 `for attempt <= 2` 死循环；是 **child 探索 + 每 child 3 分钟 + 两轮 settler/validator 叠加**，总时长可到 10 分钟以上，且超时被当成普通失败继续重试，没有总截止时间。

## 对拍参考

- `inkos-master/packages/core/src/agents/settler-tool.ts` 与 `harness/builtin-profiles.ts`：settler 以正文为证据、validator 只出建议；参考实现不会让子代理去搜索插件源文件。
- 本项目 `../../implemented/architecture/2026-10-20-storycraft-host-delegation.md` 的超时/重试边界：child 有单次 timeout，语义失败才重试；**传输超时不等于语义拒绝**。
- 裁决：**采纳**“单次 child 超时 + 语义重试”，但必须补上 **settle 总截止时间** 与“超时不重试”；技能正文不再引导子代理用 glob 找参考文件。

## 与既有记录

- 状态投影与 v2 操作合同归 [`../../implemented/architecture/2026-10-24-storycraft-state-migration.md`](../architecture/2026-10-24-storycraft-state-migration.md) 与 artifact 合同；本项不改字段/转移。
- 委派超时与提交重试归 [`2026-10-20-storycraft-host-delegation.md`](../architecture/2026-10-20-storycraft-host-delegation.md)；本项只加 settle 层的总预算与超时分类。
- 验收证据归 `#50`，本项是它发现的阻塞（`#61`）。

## 决定

### 1. 总截止时间

`settleChapterState` 用一个总 deadline（默认 **8 分钟**，`settleTimeoutMs` 可注入）包住整个流程：

- 每次 child 的 timeout = `min(单次上限, 剩余总预算)`；
- 总预算耗尽立即取消当前 child，返回 `settled:false`、`reason:'state-settle-timeout'`，不写任何事件；
- 超时**不进入第二次 settler**；只有语义拒绝（preview 非法 / validator major）才重试一次。

### 2. 超时分类

- child `stopReason` 超时 / abort → `state-settle-timeout`；
- 服务缺失、无提交、提交尝试用尽 → 现有错误码；
- 语义拒绝 → 现有 `state-reconcile-required` / `state-invalid`；
- 回执统一带 `attempts:{settler,validator}` 与 `trace:{durationMs, perAttempt:[{stage,ms,error?}], lastError?}`。

### 3. 技能与提示

- `storycraft-state-check` / `storycraft-state-settler` 删除“读某路径的 references 文件”指令，改为“加载 `storycraft-long-writing` 技能，按其方法正文判断”，不再引导 glob/grep 插件源文件。
- settle/validator 的 host prompt 增加：“不要用 glob/grep 搜索技能或插件源码；方法以加载到的技能正文为准。”
- 不在运行时把工作区外的插件源码路径交给子代理。

### 4. 可观测

- `settleChapterState` 每次 child 运行记录阶段、耗时、错误码；测试可注入短 timeout。
- `story_settle` 工具回执保留 `settled/attempts/trace`，超时也返回结构化原因，而不是长时间无响应。

### 5. 边界

- 不改 state 投影、fact/hook 合同、settler/validator 输出 schema；
- 不改阶段机与作者闸门；
- 不迁移作品；没有旧作品兼容；
- 不把 settle 改成“跳过 validator”。

## 备选方案

- **只调大单次 timeout**：只会让卡住更久；否决。
- **超时后继续重试**：把传输故障当语义失败，放大延迟；否决。
- **取消 validator**：会丢掉状态对账；否决。
- **让子代理自己搜索技能文件**：路径不稳定且触发 scope/rg 噪音；否决，改由技能正文提供方法。

## 后果

- settle 不再无限等待；超时在 8 分钟内返回结构化回执，作者能看到卡在哪一轮 child。
- 用户取消与超时分开：取消仍按失败抛出，不伪装成 `state-settle-timeout`。
- 状态技能不再引导子代理搜索插件源码，减少无效 glob/rg 与 scope 拒绝。

## 验收结果

1. `settleChapterState` 有总 deadline，默认 8 分钟；超时返回 `settled:false`、`reason:'state-settle-timeout'`、`attempts` 与 `trace`，不写事件；
2. 超时不再触发第二次 settler；语义拒绝仍只重试一次；
3. 回执 `trace` 含每次 child 的阶段、耗时、最后错误；
4. 两个状态技能不再包含文件路径式 references 搜索，host prompt 明确禁止 glob/grep 技能源码；
5. 测试：注入永不返回的 fake service + 短 timeout，断言超时回执、无事件、无第二次 settler；语义拒绝测试仍通过；
6. `node storycraft/scripts/ci.mjs --no-e2e` 通过；真实链路只需重试一次 `story_settle` 验证不再超过 8 分钟。

## 风险

- 8 分钟仍可能不够慢模型；默认值可配置，超时回执让作者看见原因，而不是无限等待。
- 缩短 child timeout 可能把本可完成的结算截断；需在 trace 里显示剩余预算与阶段。
- 技能去掉路径提示后，子代理可能仍自行搜索；host prompt 的禁止与 scope guard 兜底，测试用真实技能文本断言。

## 验证

- `node storycraft/tests/state-settle.test.mjs`：超时回执、不重试、无事件、总预算为 0、trace 字段、语义重试仍通过。
- `node storycraft/scripts/ci.mjs --no-e2e`：50 个单元契约文件 PASS。
- 真实会话 `session-e839e67a`：重启 DSH 后 `story_settle` 353 秒返回 `state-settle-timeout`，`trace.perAttempt` 为 settler 30.4s → validator 100.8s → settler 41.8s → validator 180s 超时，`lastError` 已记录，未写库。

- 交付证据：单测：settler 超时回执（不重试、无事件）、总预算为 0、trace 字段；`ci --no-e2e` 50 文件 PASS。真实会话（重启 DSH 后）`story_settle` 353 秒返回 `state-settle-timeout`，`trace.perAttempt` 显示 4 次 child 耗时与最后错误，未写库。证据见工作项 dehuadong/dsh-nove#61。
