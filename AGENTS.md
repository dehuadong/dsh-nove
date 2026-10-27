# AGENTS.md — 工作区执行约定
> **范围**：本文件所在的工作区；`{工作区}` 指本文件所在目录，`{项目}` 指当前作品目录。
> **职责**：这里只规定授权、项目定位、文件安全与交付。小说和短剧的创作方法由各自技能规定；单部作品的口径与进度由项目文件规定。

> inkos-master项目是参考复刻对象。具体见 &对拍工作法

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
- Verify

这些阶段之间不需要重复请求执行授权。

文档和仓库治理工作可以绕过该工程工作流；涉及重要产品、技术、架构或其他工程合同变化时，仍遵守 GATES 门控规则。

## 测试与验收

- 测试没有独立的用户门禁：批准覆盖开发测试。
- 开发测试验证**流程与契约**，不验证故事情节、文笔或具体作品的人名/设定。
- 测试 fixture 使用最小合成数据，不要求用户写测试小说、补数据或手工跑开发测试。
- 单元测试用临时 SQLite 与假 subagents；面板用 Playwright E2E；只有最终真实使用验收由用户执行一次。
- 通过测试、审查或静态检查不等于最终验收；真实模型只用于最终实测，不把人工实测当作开发中的反复测试步骤。

测试范围固定为：

1. 阶段机：长篇阶段机（计划 → 章纲 → 正文 → 审稿 → 修订/清稿 → 摘要 → 定稿）；短篇、剧本按各自流水线单独测，不套长篇阶段机；
2. 作者闸门：计划/章纲确认是否生效，确认后是否还自动发消息；
3. 工具契约：`story_next` 的 `action/missing/delegate`、`story_status` 的 `outline`、`story_delegate` 的回执；
4. 数据边界：虚拟路径、作品作用域、当前作品、SQLite 事务、不串作品；
5. 一致性策略：未登记人名只 warning、不阻断；清稿允许空清单；不再靠全局词表；
6. 失败策略：服务缺失、超时、格式坏、字数超界、模式违规，是否按错误码停/重试；
7. 面板行为：确认按钮、动作按钮、刷新、不自动发送；
8. token 预算：主会话工具参数+结果字符数；
9. 产物结构与消费者：字段合同、生命周期、旧 schema 拒绝、brief/context/state/review/export 至少一个真实消费者；只测写入成功不算通过。

不测：文笔好坏、情节是否好看、具体小说的人名/角色词是否“正确”、某部作品该写什么。

### E2E 测试规则

1. 浏览器级验证一律走 `node storycraft/e2e/run.mjs`（它起临时实例再跑 `playwright.spec.cjs`）；只跑一个文件用 `node storycraft/e2e/run.mjs e2e/load.spec.cjs`，只看清单用 `--list`。
2. 新功能或 bugfix 要带一条能复现它的 spec（`storycraft/e2e/*.spec.cjs`），和业务代码一起提交；spec 只覆盖浏览器里才观测得到的那层。
3. 红的处理顺序：先让 spec 稳定复现（红）→ 读产物（`trace`、失败截图、`test-results/*/error-context.md` 的 ARIA 快照）→ 改代码 → 重跑同一条命令。
4. 选择器用 `getByRole` / `getByLabel`；缺稳定锚点就在组件上补 `data-*`，不用脆弱的 CSS 层级。
5. 不写 UI 单元测试（按钮渲染、className、快照）；业务逻辑、纯函数、接口契约仍由 `storycraft/tests` 覆盖。
6. Playwright 是本包 devDependency（`storycraft/package.json`），浏览器装在机器级缓存。
7. E2E 起的是临时实例：独立 `DSH_HOME`（`storycraft/.tmp-e2e/`）、临时端口、随 spec 结束退出。需要手工回收时按端口定位（`Get-NetTCPConnection -LocalPort <port>`），不许按进程名批量杀。
8. 装出来的形态用 `node storycraft/scripts/ci.mjs --smoke` 验证（tarball → `dsh plugin add` → 冷启动）；它自己开实例、自己收尾，失败也必须杀干净，不能留下占着管道的子进程。


### 对拍工作法
- InkOS 仓库分析研究文档 `docs\report\inkos\readme.md`；全量对拍证据见 `docs/report/inkos/2026-10-23-full-project-parity-audit.md`，产物专项见 `docs/report/inkos/2026-10-23-artifact-and-resource-parity-audit.md`；三形态执行计划归 `.agents/notes/proposed/workspace/2026-10-19-storycraft-roadmap.md`，报告不拥有排期。
- 只使用本 Harness 的 Skill、Preset、Plugin、Subagent 与文件状态；不引入 LLM Provider、独立 Harness/SDK、资源管理服务或额外子 Agent 运行时。
- 本项目代码、内容与注释不标注来源、不建立关联，以独立项目口径命名与改写。
- 对拍的记忆不靠对话：规则记在本文件，能力对照与差距记在 `.agents/notes/proposed/pipeline/2026-10-18-storycraft-parity-matrix.md`，决定记在对应 Issue/Note，验证记在 tests/CI。
- 遇到实现、流程、节点或验收问题时，**先查对拍项目如何实现**：读它的源码、文档、CI、技能、角色资源与测试，再决定我们的做法；不得先改提示词或凭直觉自创。
- **提案必须带对拍证据**：任何提案/设计 Note 必须有“对拍参考”段，写清参考工程 `inkos-master` 的证据位置（文件、类型、流程或测试）及其实现方式；有参考实现时，再写我们的实现方式与裁决（采纳/等价适配/不采用及原因）。没有可对照实现时，写“无参考实现”、检索范围和理由。不得只用“超出范围/成本高”作为不采用理由。
- 每次对拍先提取可验证的不变量；再写“参考证据 / 我们落点 / 差异原因 / 验证命令”。查不到或不能照做时，记录约束与原因，必要时先取得用户许可。
- 不直接复制参考代码；优先吸收采纳其中好的方面，按我们的领域语言和职责边界改写，不把参考文件当成项目源文件。
- 新发现先更新对照表，再决定是否立工单；不要把聊天里的分析当成已完成的对拍。
- **四层对拍**：每次同时核对 Agent/角色（输入、输出、失败）、Skill/资源（方法正文、references、加载方式）、产物/数据（字段、权威、消费者、生命周期、旧 schema 拒绝）、宿主/编排（阶段、闸门、确认、证据）。只对流程/编排不算完成。
- **结构优先**：参考实现的产物、角色、技能或数据模型更完整时，按原结构采纳或等价适配；不得为了少改现有代码把多份产物压进一个文件、把结构化字段降为文本、把独立流水线塞进现有阶段机。
- **能力迁移不是否决**：参考实现的能力迁移成本是工作量与排序，不是不采用理由；不得静默裁掉字段、消费者或阶段。这条不适用于作品数据迁移——本项目没有旧作品，不做数据迁移/兼容（见下条）。
- **方法共享，角色薄契约**：长篇/短篇/剧本的创作方法各归一份共享技能 + references，由相关角色共同加载；角色技能只写提交内容、闸门与失败回退，不复制或改写方法正文。审稿/修订等角色专属标准可以独立。
- **三形态独立**：长篇、短篇、剧本各有独立产物与流水线（短篇 outline/batch draft/review/revision/package；剧本 spec/script/场次集）；共享底层存储与合同，不共享阶段机。
- **范围删除需裁决**：参考能力若不属于当前产品，先在 Issue/Note 写明并由作者裁决；实现不得以“当前没排期/成本高”自行裁剪。
- **宿主差异要等价**：DSH 没有的 capability/profile/confirmation 等机制，用本 Harness 的等价行为实现并记录约束；不复制参考代码，也不静默省略。
- **消费者与证据**：产物对拍同时看 brief/context、检索、审稿/结算、UI、导出/备份、旧 schema 拒绝；只验证“能写入/能读回”不算对拍。参考实现自身有弱点时，记录弱点与我们补强，结构采纳不等于复制缺陷。
- 对拍整改先立产物合同，再按形态推进；合同未定前不按旧格式实现新角色/生成链。当前顺序：A0 全量产物合同 → L 长篇 → S 短篇 → D 剧本。

### 执行、测试与约定
- 不能把任务工作量“成本高”而作为裁剪、简单实现的理由，应该去规划分阶段排期。
- **没有旧作品，不存在数据迁移/兼容**：本项目的测试作品一律删除重建。提案、设计 Note、实现与验收不得包含旧作品迁移、兼容层、双读、旧行回退、legacy 分支、旧文件导入，或“旧作品显示为空/需重填”一类设计；旧 schema 直接 `schema-version-mismatch`，旧表/旧列直接删除或不再读写。对拍里的“能力迁移”不等于数据迁移，不能用来保留兼容层。
- 本项目具体功能性实现先参考对拍项目InkOS，是否是相同或类似功能，以及其实现方法，见&对拍工作法.
- 开发测试由代理执行，不交给用户手工跑：项目 CI 命令是 `node storycraft/scripts/ci.mjs`（类型检查 + 打包清单检查 + 全部单元契约文件，当前 55 个 + Playwright E2E）；Playwright 是本包 devDependency，首次用 `cd storycraft && npm install && npx playwright install chromium`，不借用其它项目的安装。
- 参考工程的 CI 是 `.github/workflows/ci.yml` 里的 `pnpm install --frozen-lockfile && pnpm build && pnpm test`；对拍时先读参考的 CI、技能、角色资源和测试，再决定我们的实现，不凭印象造替代方案。差异必须写清原因、约束和为什么不能完全照做，必要时先取得用户许可。
- #19/#21 的教训是：整章正文与装配上下文多次穿过主会话，单靠节点单测和“让用户实测”发现不了 token、路径、角色输入的问题。验证必须覆盖主会话路径、工具回执与 token 预算；不能只用“单元测试通过”代替。
- 用户只在最后做一次真实使用验收；需要新会话做真实链路时，用户提供 `sessionID`，代理自己在该会话跑，不要求用户写测试小说、补 fixture 或手工跑开发测试。
- `story_read` / artifact ID / 阶段上下文是 #22 的契约；真实链路验收要检查模型没有拿到 `works/` 路径、没有跨章读取、没有把上下文重复灌回主会话。
- 推进任一设计前，先扫所有关联 Note 的 owner、partial replacement、旧 AC、动作数与重试规则；有冲突先改文档并互相链接，再继续，避免做了后面的就忘掉前面的。

## DSH 插件与预设

DeepSeek Harness 包工作区：packages文档地址 `E:\dsh-nove\deepseek-harness\packages`

改插件或预设前，按顺序读：包内流程技能 → 目标包 README → 源码。不要凭记忆写 Loader 行或 Config 字段。

- 流程技能（随 `@deepseek-ai/dsh-agent-preset` 出货，会话中也可用 `skill` 工具直接加载）：
  - [cordis-plugin-development](deepseek-harness/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md) — 新增或修改 Host、Client、MCP、UI 插件的流程；`references/` 是按需读的细节与可复制模板。
  - [editing-cordis-compositions](deepseek-harness/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md) — 预设的声明、覆盖、旧格式迁移与验证；写 `cordis.patch.yml` 前先读它。
  - [cordis-composition-reference](deepseek-harness/packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md) — Loader patch 方言（`insert`、按 id 覆盖、`group`、`isolate`、`!!js`）与 `references/packages.md` 的可安装插件包清单。
- 包契约：[agent-preset](deepseek-harness/packages/preset/agent-preset/README.zh.md)、[agent-preset-registry](deepseek-harness/packages/preset/agent-preset-registry/README.zh.md)、[persona](deepseek-harness/packages/preset/persona/README.zh.md)、[subagent](deepseek-harness/packages/subagent/subagent/README.zh.md)、[tool-subagent](deepseek-harness/packages/subagent/tool-subagent/README.zh.md)；标准预设蓝本 [standard.patch.yml](deepseek-harness/packages/bundle/web-app/presets/standard.patch.yml)。
- 子系统与生成目录：[core.zh.md](deepseek-harness/docs/subsystems/core.zh.md)（`agentPresets`）、[subagent.zh.md](deepseek-harness/docs/subsystems/subagent.zh.md)、[system-prompt.zh.md](deepseek-harness/docs/subsystems/system-prompt.zh.md)、[scope.zh.md](deepseek-harness/docs/subsystems/scope.zh.md)；[config-catalog.zh.md](deepseek-harness/docs/config-catalog.zh.md)、[tool-catalog.zh.md](deepseek-harness/docs/tool-catalog.zh.md)。
- 版本变更：`deepseek-harness/docs/upgrade-guide/`；涉及子代理与预设先看 [subagent-preset-composition](deepseek-harness/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.zh.md)。

约定：

- 源码以 `deepseek-harness/`（指向 DSH checkout 的符号链接）为准；安装版在 `app.asar` 内，shell 读不到。两处版本不一致时，以实际运行版本的 README 与 Config schema 为准。
- 实时契约用 `cordis_inspect_list` / `cordis_inspect_query` 读 Service、Event、Config、Tool、Slots；不要猜插件名、字段或默认值。
- 安装或修改插件与预设走 `plugin_manager`（`install_bundle`、`set_bundle`），不手改 profile 文件。
- 外部参考工程只作功能性参考，先核对其声明的 DSH 版本；

## 文档与约定

仓库管理根是本文件所在目录，下文路径都从该根解析。

- 文档类型、属主与写作标准：[docs/AGENTS.md](docs/AGENTS.md)。
- 工作项（Proposal / Issue）的位置、状态、评审与批准证据：GitHub Issues `dehuadong/dsh-nove`，约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- 分诊角色到标签字符串的映射：[docs/agents/triage-labels.md](docs/agents/triage-labels.md)。
- 领域文档：单上下文，根目录 `GLOSSARY.md`；读取规则见 [docs/agents/domain.md](docs/agents/domain.md)。
- 长期技术提案与决定的记录范围、生命周期和格式：`.agents/notes/`；管理与检查见 [.agents/notes/README.md](.agents/notes/README.md)，本地阅读与维护指引见 [.agents/notes/AGENTS.md](.agents/notes/AGENTS.md)。
