# AGENTS.md — 工作区执行约定
> **范围**：本文件所在的工作区；`{工作区}` 指本文件所在目录，`{项目}` 指当前作品目录。
> **职责**：这里只规定授权、项目定位、文件安全与交付。小说和短剧的创作方法由各自技能规定；单部作品的口径与进度由项目文件规定。

> inkos-master项目是参考复刻对象。不得在我们的项目代码直接引用其源文件或标注说来自inkos、新项目代码和内容及解释不得关联、保持独立性。不要误解成不参考功能，自己可以随便造。

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

提示用户输入下一步门禁指令（以 `docs/agents/GATES.md` 为准）：

- 收到 `/planning` 时加载 `planning`，完成规划及必要评审后回到 Discuss。
- 收到 `批准，执行实现` 时加载 `implement`。若关键合同仍未解决，指出 blocker 并建议先 `/planning`，不自行进入规划。
- 实施完成后由 `implement` 继续到 Verify，不再另设 Verify 门禁。

文档和仓库治理工作可以绕过该工程工作流；涉及重要产品、技术、架构或其他工程合同变化时，仍遵守 GATES 门控规则。

## 测试与验收

- 测试没有独立的用户门禁：`批准，执行实现` 覆盖开发测试；最终实测属于 Verify，不单独请求授权。
- 开发测试验证**流程与契约**，不验证故事情节、文笔或具体作品的人名/设定。
- 测试 fixture 使用最小合成数据，不要求用户写测试小说、补数据或手工跑开发测试。
- 单元测试用临时 SQLite 与假 subagents；面板用 Playwright E2E；只有最终真实使用验收由用户执行一次。
- 通过测试、审查或静态检查不等于最终验收；真实模型只用于最终实测，不把人工实测当作开发中的反复测试步骤。

测试范围固定为：

1. 阶段机：计划 → 章纲 → 正文 → 审稿 → 修订/清稿 → 摘要 → 定稿；
2. 作者闸门：计划/章纲确认是否生效，确认后是否还自动发消息；
3. 工具契约：`story_next` 的 `action/missing/delegate`、`story_status` 的 `outline`、`story_delegate` 的回执；
4. 数据边界：虚拟路径、作品作用域、当前作品、SQLite 事务、不串作品；
5. 一致性策略：未登记人名只 warning、不阻断；清稿允许空清单；不再靠全局词表；
6. 失败策略：服务缺失、超时、格式坏、字数超界、模式违规，是否按错误码停/重试；
7. 面板行为：确认按钮、动作按钮、刷新、不自动发送；
8. token 预算：主会话工具参数+结果字符数。

不测：文笔好坏、情节是否好看、具体小说的人名/角色词是否“正确”、某部作品该写什么。


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