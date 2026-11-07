# AGENTS.md — 工作区执行约定
> **范围**：本文件所在的工作区；`{工作区}` 指本文件所在目录，`{项目}` 指当前作品目录。
> **职责**：这里只规定授权、项目定位、文件安全与交付。小说和短剧的创作方法由各自技能规定；单部作品的口径与进度由项目文件规定。

> `inkos-master/` 是源工程，本仓库是在 DSH 上的高保真复刻；具体见 &保真原则。

## 项目铁律

1. **一个 PR 只做一个纵向能力**：对应 `capabilities.yaml` 的 `id`，同时包含源工程证据 → 复刻落点 → 实现 → 消费者 → 契约测试；缺一项 CI 拒绝。禁止只拆文件／只改文档／只改存储的 PR。
2. **状态只来自证据**：`capabilities.yaml` 的 `status` 只能由 `check-capabilities` 依据测试与真实运行证据生成；人工只能写 `missing`。不建第二套状态表、交付盘点、进度看板、“已实现／已验收”清单。
3. **只用 DSH 运行时**：
   - Provider → DSH `llm`；
   - Agent 循环 → DSH agent loop + `subagents`；
   - CLI → DSH command / headless；
   - 存储 → DSH storage/session 或既有 SQLite（不新建独立存储服务）；
   - 调度 → DSH jobs/schedule；
   - 技能 → DSH `skills` 服务 + 文件系统；
   - 上下文注入 → DSH `systemPrompt.context()`，不自定义 prompt 拼装层重复方法正文。
4. **状态只有两种**：`missing` 与 `verified`；不设待重验、旧口径等中间状态。能力状态只由第 2 条的证据生成。

## 保真原则

- `inkos-master/`（下称 `inkos/`）是源工程；本仓库是在 DSH 上对它的高保真复刻。不存在“参考实现”与“我们的实现”两个对等方案，只有“源工程的行为”与“复刻到什么程度”。
- **行为等价优先于“能跑”**：同输入、同状态下的产物、事件、顺序、错误与拒绝行为应一致；能跑通但行为不同，不算完成。
- **偏差只有两种合法来源**：
  1. DSH 机制无法等价实现；
  2. 源行为不可观测（读不到、跑不起、无证据）。
- 任何偏差必须登记：**源工程做法 → 复刻做法 → 原因 → 验证**。原因必须落在上述两类，不能写“成本高”“没排期”“先这样”。
- **缺字段、缺产物、缺消费者、放宽校验一律算保真债**；不能因为“已登记”就视为合理。保真债必须能指出偿还路径或阻塞证据。
- 判断顺序：先读源工程行为，再决定复刻做法；不得先改提示词或凭直觉自创。

## 文档与约定

仓库管理根是本文件所在目录，下文路径都从该根解析。

- 产品范围与非目标：[docs/scope.md](docs/scope.md)；
- InkOS 机制 → DSH 复刻的映射与偏差：[docs/dsh-mapping.md](docs/dsh-mapping.md)；
- 全量能力账本：[capabilities.yaml](capabilities.yaml)；校验入口 `npm run check-capabilities`；
- 文档类型、属主与写作标准：[docs/AGENTS.md](docs/AGENTS.md)。
- 长期技术提案与决定的记录范围、生命周期和格式：`.agents/notes/`；规则由 `write-agent-notes` Skill 拥有，根范围与校验入口见 [.agents/notes/AGENTS.md](.agents/notes/AGENTS.md)。
- 重要改动必须留笔记 见 &Agent Notes 
- 工作区开发临时目录 `.artifacts`

## 文件安全

工作区指本文件所在目录。下面四条是硬约束，不因任务紧急、验收需要或“只是测试”而放宽：

- **工作区外不删除、不移动、不覆盖**。`%USERPROFILE%`、`%APPDATA%`、`%LOCALAPPDATA%`、`%ProgramData%`、`C:\Windows` 与盘符根视为禁区；确需改动其中某个单文件时，一次一个、写出绝对路径、当次取得作者授权。
- **需要干净的 DSH 状态时，只用临时 `DSH_HOME`**（`storycraft/.tmp-e2e/`、`storycraft/.tmp-smoke/`）。禁止清理真实的 `~/.dsh`，禁止删改 `~/.ssh`、`~/.gitconfig` 等用户级配置；用户级目录不是测试夹具。
- **删除只走 `node scripts/trash.mjs`**：目标移到 `.trash/` 并保留原路径，`--restore <id>` 可还原。禁止用 `Remove-Item -Recurse`、`rm -rf` 直接抹除。
- **`danger-full-access` 仅限单文件、单操作、路径已核对**；禁止目录递归、通配符和复合命令。

派发前的强制拦截由 Host 插件 `@dsh-nove/shell-guard`（源码 `tools/shell-guard/`）执行：分类器命中“删除/移动/复制/创建/写入动词 + 工作区外目标 / 通配符 / 无法解析的变量”时直接拒绝该次工具调用，并在回执里给出 `trash.mjs` 替代路径与 `.artifacts/` 提示。只读命令不拦截；子进程内部写入仍依赖 sandbox。规则写在文档里是给人看的，这一层由运行时强制执行。

边界说明：守卫装在当前 profile，只覆盖经由本 Harness 工具发起的命令；作者自己终端里的操作不在其内。因此删除一律走 `trash.mjs`，不要因为“有守卫”就放宽命令行。

代码写入另由 Host 插件 `@dsh-nove/implement-gate`（源码 `tools/implement-gate/`）在 `tools/pre-execute` 强制执行。它从会话工作区向上找最近的 `.agents/implement-gate.json`：找到就按该配置启用，子目录会话继承上级项目策略；找不到的项目完全 pass-through，工具面也不出现 `implement_gate`。配置定义 `codeExtensions`、`codePaths`（默认空，按需声明）、`protected` 与 `commands`；缺配置时完全 pass-through，配置非法时 `misconfigured`，除 `implement_gate status` 外的所有工具调用被拒绝。新项目由作者在项目根会话执行 `/implement-gate init` 生成默认配置；祖先已有 marker 或祖先存在 `.git` 的工作区不是项目根，命令会拒绝，避免在子目录生成嵌套 marker；不手写 marker。状态按 `(marker 目录, agent.id)`（即 SessionId）存放在 marker 同级的 `.agents/state/implement-gate/<session-hash>.json`，并行会话互不影响，插件重载后从文件恢复。

状态机：`discuss`（默认；代码与文档都拒绝）→ planning 命令 → `planning`（允许文档与 propose Note，代码仍拒绝）→ `implement_gate({action:'end-planning'})` → `discuss`；docs 命令 → `docs`（允许文档/notes，代码拒绝）→ `implement_gate({action:'end-docs'})` → `discuss`；implement 命令/审批 → `implement`（允许代码与文档）→ `complete`（代码与文档拒绝）。

文档、普通 JSON/YAML、`git status/add/commit/push` 不进入代码门禁，但文档写入需要 `批准，执行文档治理 {范围}` 或 planning/implement 授权；`git checkout/reset/clean` 仍视为代码写。`.agents/notes/proposed/**` 按文档处理；`.agents/implement-gate.json`、`.agents/state/implement-gate/**` 始终例外。implement 工作项必须是同 topic 的 proposed Note 或 `mechanical:<说明>`；实现中范围外问题用 `return-to-discuss` 回到 discuss。授权来自 owner 用户整条消息中的规范 planning/implement/docs 命令，或 `implement_gate({action:'authorize'})` 的任务级审批。合同变化时调用 `implement_gate({action:'block',reason})`，Verify 后调用 `complete`。

## 工程工作流 

工程任务从 Discuss 开始。

### Discuss


使用 Discuss 理解问题，结合现有代码、文档、历史决策、已接受的 ADR/RFC 和项目约束形成解决方案，并消除足够的歧义，以判断下一阶段。

讨论不是被动访谈。优先自行分析已有项目上下文，而不是把可判断的问题交给用户。

讨论过程中：

- 明确实际问题、约束和相关既有决策
- 提出有实质差异的可行方案，并在依据充分时给出推荐
- 说明关键权衡、风险和影响
- 发现假设与现有事实或决策冲突时，明确指出
- 仅在缺少必要信息，或涉及未决的产品、业务、范围、兼容性、成本、风险及其他价值判断时，请求用户裁决

不要要求用户重复已有信息，也不要求在 Discuss 中确定所有实现细节。

在以下情况下继续停留在 Discuss：

- 工作仍处于探索阶段
- 仍在比较重要的备选方案
- 用户当前只是寻求理解，而不是准备推进
- 目标或选定范围尚不足以形成实施合同

不要仅因为正在讨论产品、技术或架构决策，就创建规划产物。

若可以判断讨论已经足够成熟，并说明已解决事项、剩余未决事项和建议的下一阶段，但不能仅凭自身判断离开 Discuss。

何时从 Discuss 进入 Planning 或 Implementation Gate，由用户决定。若用户此前的请求已经明确授权推进，则复用该授权。

讨论后推进、直接收到阶段请求或恢复工程工作时，读取并按 `docs/agents/GATES.md` 的 Steps、授权与返回规则执行；具体工作方法由对应技能负责。

任务汇报之后，提示用户输入下一步门禁指令（以 `docs/agents/GATES.md` 为准）：


- 收到 `批准，使用技能 planning 执行规划 {工作项}` 时加载 `planning`，完成规划及必要评审后回到 Discuss。
- 收到 `批准，使用技能 implement 执行实现 {工作项}` 时加载 `implement`。若关键合同仍未解决，指出 blocker 并建议先 `planning`，不自行进入规划。

执行授权仅适用于**当前工单已确认范围的实施工作**，并覆盖该工作内部连续发生的：

- 实施
- Implementation Review
- 范围内修正
- 声称 `PASS`、完成或交付之前 → `verify`

这些阶段之间不需要重复请求执行授权。

每次阶段转换完成（planning/docs/implement 结束、return-to-discuss、block、complete）后，调用 `implement_gate({action:'status'})`，并在回复中输出状态块：

```text
状态：{phase}
工作项：{task}
work：{active|blocked}
blockReason：{无|原因}
```

状态块只描述当前事实，不包含固定门禁命令；下一步由模型语义判断，写在状态块之后的正文里。

文档和仓库治理工作可以绕过 planning/implement，但需要通过 `批准，执行文档治理 {范围}` 取得 Gate 授权；涉及重要产品、技术、架构或其他工程合同变化时，仍遵守 GATES 门控规则。

## 测试与验收

- 验收单位是 `capabilities.yaml` 的一行：`implementation` 与 `consumer` 路径存在、消费者测试通过、`artifacts/real-runs/<id>.json` 含日期、session id、`tests.passed: true` 与非空 `receipts`，四者同时成立才是 `verified`。
- 一个变更只做一个能力；不做只拆文件、只改文档或只改存储的交付。
- 开发测试由代理执行，fixture 用最小合成数据；不要求作者写测试小说、补数据或手工跑开发测试。
- 测试验证流程与契约，不验证故事情节、文笔或具体人名设定。
- 真实模型只用于最终真实运行；不把人工实测当作开发中的反复回归。

### 浏览器验证

1. 有 UI 能力时用该包自己的 Playwright 配置起临时实例；命令写进该能力的消费者测试路径。
2. 新能力带一条能复现它的 spec，只覆盖浏览器里才观测得到的那层。
3. 红先稳定复现（红），读 trace、失败截图与 ARIA 快照，再改代码，重跑同一条命令。
4. 选择器用 `getByRole` / `getByLabel`；缺稳定锚点就在组件上补 `data-*`，不用脆弱的 CSS 层级。
5. 不写 UI 单元测试（按钮渲染、className、快照）；业务逻辑、纯函数、接口契约由单元测试覆盖。
6. 不借用其它项目的 `node_modules`；临时实例用独立 `DSH_HOME`，按端口定位回收进程，不按进程名批量杀。


### 保真工作法
- 源工程证据：`docs/report/inkos/readme.md` 是索引；全量保真核对见 `docs/report/inkos/2026-10-23-full-project-parity-audit.md`，产物专项见 `docs/report/inkos/2026-10-23-artifact-and-resource-parity-audit.md`。报告只提供证据，不拥有排期。
- 只使用本 Harness 的 Skill、Preset、Plugin、Subagent、文件与 Session 状态；不引入 LLM Provider、独立 Harness/SDK、资源管理服务或额外子 Agent 运行时。
- **源工程行为是规格**：`inkos-master/` 的产品结构、产物、顺序、错误与拒绝行为按原样复刻；结构差异必须写进 `docs/dsh-mapping.md` 的偏差行并裁决，未登记的偏差视为越界。其运行时机制（Provider、Agent 循环、CLI、存储、调度）逐项整改为 DSH 的运行机制，用 Skill/Preset/Plugin/Subagent/文件状态等价实现；不 import、不运行 inkos 的代码，也不引入它自带的运行时。DSH 缺少的机制不得删能力，必须给出等价实现并登记验证。
- **不得自创产品限制**：数量上限、白名单、格式限制等，源工程没有、作者也未裁决的，不得写进合同或校验；工程预算问题只能在消费层（选择、截断）解决。
- 本项目代码、内容与注释不标注来源、不建立关联：不在代码、注释、prompt 或正文里写"这段来自 inkos 的某文件/某段"这类归属说明；源工程证据的位置只写在 `capabilities.yaml` 的 `reference` 字段、`docs/dsh-mapping.md` 与工作项。该条**不限制**复用源工程的 prompt 文案、方法正文、结构或数据形状；复用时按独立项目口径命名与放置，不在实现里标注来源。
- 保真的记忆不靠对话：规则记在本文件，机制对照与偏差记在 `docs/dsh-mapping.md`，能力映射记在 `capabilities.yaml`，决定记在工作项/Note，验证记在 tests/CI；当前状态只以 CI 与真实会话证据为准。
- 遇到实现、流程、节点或验收问题时，**先查源工程如何实现**：读它的源码、文档、CI、技能、角色资源与测试，再决定复刻做法；不得先改提示词或凭直觉自创。
- **提案必须带源工程证据**：工作项或设计 Note 必须有“源工程证据”段，写清 `inkos-master` 的证据位置（文件、类型、流程或测试）及其行为；再写复刻做法与裁决（行为等价 / 机制等价 / 不可观测）。没有可对照行为时，写“源行为不可观测”、检索范围和理由。不得只用“超出范围/成本高”作为不采用理由。改变结构时，还必须给出偏差行（源工程做法 / 复刻做法 / 原因 / 验证）；没有偏差行的结构变化不得进入实现。
- 每次保真先提取可验证的不变量；再写“源工程证据 / 复刻落点 / 偏差原因 / 验证命令”。偏差原因只能是 DSH 机制无法等价或源行为不可观测；其余差异登记为保真债。
- 缺字段、缺产物、缺消费者、放宽校验不是“偏差”，是保真债；必须指出偿还路径或阻塞证据，不能因为已登记就视为完成。
- 新发现先更新 `docs/dsh-mapping.md` 或对应能力行，再决定是否立工作项；不要把聊天里的分析当成已完成的保真证据，也不新建手写状态表。

### 执行、测试与约定
- 不能把任务工作量“成本高”而作为裁剪、简单实现的理由，应该去规划分阶段排期。
- **没有旧作品，不存在数据迁移/兼容**：本项目的测试作品一律删除重建。提案、设计 Note、实现与验收不得包含旧作品迁移、兼容层、双读、旧行回退、legacy 分支、旧文件导入，或“旧作品显示为空/需重填”一类设计；旧 schema 直接 `schema-version-mismatch`，旧表/旧列直接删除或不再读写。保真里的“能力迁移”不等于数据迁移，不能用来保留兼容层。
- 本项目具体功能性实现先读源工程 InkOS 的相同或类似功能及其实现方法，见 &保真工作法。
- 开发测试由代理执行，不交给用户手工跑：项目门禁是 `npm run verify`（notes + 能力账本）；触及 `storycraft/` 包时另跑 `node storycraft/scripts/ci.mjs`。能力交付必须自带消费者测试；只有文件存在或单测通过不算完成。
- 源工程的 CI 是 `.github/workflows/ci.yml` 里的 `pnpm install --frozen-lockfile && pnpm build && pnpm test`；保真时先读源工程的 CI、技能、角色资源和测试，再决定复刻实现，不凭印象造替代方案。差异必须写清原因、约束和为什么不能完全等价，必要时先取得用户许可。
- 用户只在最后做一次真实使用验收；需要新会话做真实链路时，用户提供 `sessionID`，代理自己在该会话跑，不要求用户写测试小说、补 fixture 或手工跑开发测试。**跨会话投递用工具 `session_prompt`**（源码 `tools/session-driver/`，走宿主 `sessionController.prompt`，与 GUI 发消息同一条路径）：`dsh --profile headless --session-id` 会拒绝带 agent preset 的会话（`assertAdoptable` 抛错），不能用来接管 GUI 会话；面板确认、导出打开仍归作者。
- 跨会话驱动的证据：投递后用 `node` 解 `session.v4.jsonl.zstd`（按 zstd 帧切分）读 `tool/call`、`tool/result` 与 `assistant/message`；不要凭 GUI 截图判断。
- 推进任一设计前，先扫所有关联 Note 的 owner、partial replacement、旧 AC、动作数与重试规则；有冲突先改文档并互相链接，再继续，避免做了后面的就忘掉前面的。

## DSH 插件与预设

在开发deepseek-harness 插件时遇到问题可参阅deepseek-harness官方源码工程包 `E:\workspace\DSH\deepseek-harness\packages`
DSH UI设计判断参考`deepseek-harness/docs/ui-design-review-cases.zh.md`
Web UI 样式参考`deepseek-harness/docs/web-styling.zh.md`
DSH  UI统一圆角规范`deepseek-harness/docs/ui-radius.zh.md`


## Agent Notes 

1. 非平凡改动（改了行为、架构、跨文件契约、流程与工具链、测试策略、落盘/网络/配置格式）前，遵循 `write-agent-notes` SKILL 写或更新笔记；机械性小改（样式、格式化、打标、不改行为的补丁）直接提交。
2. 写之前先检索 .agents/notes/ 里的同主题旧笔记：有归属就地更新；新想法先放 proposed/，落地随同代码改动转 implemented/；新方案彻底取代旧决策时，同批归档旧篇并标明被谁取代。
3. 被放弃的方案先写它最强的理由，再解释为什么不用。
4. 提交前跑 npm run verify-notes，红了先修再交。
5. **工作项入口**：能力以 `capabilities.yaml` 的 `id` 为工作项；一次只做一个纵向能力，同时交付源工程证据、复刻落点、实现、消费者与契约测试。不新建 Issue，不建排期文档，不把路线写进 Note。
6. **状态与证据**：当前状态的唯一证据是当前代码的自动测试/CI 与真实链路会话证据；Note 的 lifecycle 与 `## Testing` 只表示记录是否落地、当时跑过什么，不表示能力当前可用。禁止新建/维护 `delivery-status-*`、`parity-matrix` 式手写完成状态表；工作项验收必须包含消费者与真实链路证据。
