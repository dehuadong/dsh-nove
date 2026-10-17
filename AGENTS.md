# AGENTS.md — 工作区执行约定
> **范围**：本文件所在的工作区；`{工作区}` 指本文件所在目录，`{项目}` 指当前作品目录。
> **职责**：这里只规定授权、项目定位、文件安全与交付。小说和短剧的创作方法由各自技能规定；单部作品的口径与进度由项目文件规定。

> inkos-master项目是参考复刻对象，不得修改、引用其文件、也不要在新项目中标注引用至inkos-master项目。新项目代码和内容及解释不得关联、保持独立性。

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

文档和仓库治理工作可以绕过该工程工作流，除非它改变了重要的产品、技术、架构或其他工程契约。
## 文档与约定

仓库管理根是本文件所在目录，下文路径都从该根解析。

- 文档类型、属主与写作标准：[docs/AGENTS.md](docs/AGENTS.md)。
- 工作项（Proposal / Issue）的位置、状态、评审与批准证据：GitHub Issues `dehuadong/dsh-nove`，约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- 分诊角色到标签字符串的映射：[docs/agents/triage-labels.md](docs/agents/triage-labels.md)。
- 领域文档：单上下文，根目录 `GLOSSARY.md`；读取规则见 [docs/agents/domain.md](docs/agents/domain.md)。
- 长期技术提案与决定的记录范围、生命周期和格式：`.agents/notes/`；管理与检查见 [.agents/notes/README.md](.agents/notes/README.md)，本地阅读与维护指引见 [.agents/notes/AGENTS.md](.agents/notes/AGENTS.md)。