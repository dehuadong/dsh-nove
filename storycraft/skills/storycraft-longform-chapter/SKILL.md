---
name: storycraft-longform-chapter
description: 长篇小说单章流程与闸门：章纲到定稿的动作顺序、前置读取与回退；方法正文按阶段读 storycraft-long-plan / storycraft-long-prose / storycraft-long-settle，立项/卷/重开见 references。只出方法与提交内容，不直接改文件。 触发：用户要求写长篇的下一章、续写、改章节，或需要确认单章流程与闸门时。
---
# 长篇单章流程

形态：`story_init` 的 `form: "longform"`（省略即此值）。章节单位是「章」。

一个章节只追求一件事：让读者在读完后有明确的「接下来会怎样」的期待，同时不破坏已经建立的人物与事实。

## 先读方法

方法正文按阶段加载：写章纲读 `storycraft-long-plan` 的 `references/chapter-plan.md`；写正文读 `storycraft-long-prose` 的 `references/scene-dialogue-and-length-budget.md`；定稿读 `storycraft-long-settle` 的 `references/state-projection.md`。本技能只保留单章流程与闸门；立项、卷、重开与设置见 `references/flow-details.md`。

## 开工前必须先读

1. 先调 `story_brief`：它按预算装配好作者意图、本章章纲、涉及人物、未解伏笔、本卷摘要、最近 5 章摘要、上一章结尾、文风与字数口径。**不要自己通读前文**，也不要凭记忆推断设定。
2. 章纲缺失、真值缺文件、目标章不存在时，`story_brief` 会明确报错——按错误里的提示补，不要编造。
3. 需要更具体的设定时，用 `story_bible` 读五件真值（世界观、人物、文风、计划、意图），不要用文件工具去翻作品库；作品内容由动作返回 artifact ID 与内容。

## 写作流程

0. **先说清对象**：作品通常由面板进入时选定；新会话没有当前作品时，`story_init` 成功后会把新作品设为当前。立项时先确认会话没有当前作品；已有其他当前作品时请作者新建会话，否则 `story_init` 返回 `work-mismatch`。`story_current` 只读。动手前用一句话确认目标作品与章号（「对《书名》第 N 章…」）。
   - `story_current` 返回 `null` 时说明会话还没有进入任何作品：**不要自己找、不要列目录、不要切书**，请作者在面板里进入那部作品。
   - 模型不能任意切换当前作品；也不要用 `story_current` 去「看看有哪些作品」。
0. **先问下一步**：调 `story_next`，它给出该做的动作、章号、原因、缺什么，以及可委派时的 `delegate.role`。顺序固定为：章纲 → 正文 → 审稿 → 修订/清稿 → 摘要 → 定稿 → 下一章章纲。写正文/审稿/修订优先按 `delegate.role` 调 `story_delegate`；没有 delegate 时才用手动动作。动作被拒时，错误消息里的「先做什么」就是下一步。
1. **定章纲**：视角人物、本章目标、阻力、代价、结尾变化五项齐全，并写 `body`（章纲正文）与 `threadRefs`（伏笔数组，可为空）后用 `story_plan` 落盘。用户没给章纲时，先给章纲、用 `story_plan` 落草稿，再请用户在面板「章纲」里点「确认章纲」；确认前写正文会被 `plan-not-approved` 拒绝。
2. **取上下文**：交给 `story_delegate` 时由宿主装配；自己写前预览用 `story_brief`，按返回的分段写，不要引用被裁掉的段。
3. **写成稿**：二到四个场景，场景之间有时空或因果推进；有 `delegate.role: writer` 时用 `story_delegate` 落盘，否则用 `story_write`。首版 `ch-<四位序号>.md`，修订生成 `r2`、`r3` 新版本。
4. **质检**：用 `story_critique` 看可复现指标（字数是否在该作品范围内、平均句长、重复句、AI 腔命中、对话占比）。它只打分，不改正文。
5. **审稿**：有 `delegate.role: reviewer` 时用 `story_delegate`；否则把质检发现与自己的问题写成清单交给 `story_review`（只落盘清单，不动正文）。
6. **修订**：有 `delegate.role: reviser` 时用 `story_delegate`；否则用 `story_revise`。按条目标记为已处理并生成新版本；审稿清单为空（清稿）时跳过修订，直接写摘要。选模式：
   - `patch`（默认）只改点到的地方，字数变化 ≤ 20%；
   - `polish` 顺语气与节奏，≤ 40%；
   - `rewrite` 重写，不限幅度；
   - `deslop` 专治腔调词，必须减少命中（原文零命中时可用）。
   模式与幅度不符由 `story_submit` 拒绝，子代理最多修正 3 次；主编不重试、不换 mode、不手动搬运正文。
7. **摘要**：修订完成或清稿审稿后，先调 `story_next`；有 `delegate.role: summarizer` 时用 `story_delegate`，子代理通过 `story_submit` 提交摘要（上限 400 字，只写事实与状态变化）。没有 delegate（当前版本已有摘要或阶段不满足）时不读正文，报告并停手；摘要针对旧版本时 `story_next` 仍会给 summarizer，重写后自动绑定当前正文版本。只有作者显式要求时才用 `story_summarize` 手动写。下一章的滚动窗口靠它。
8. **定稿**：`story_next` 说可以定稿、且阶段是「已修订」或清稿审稿时，优先用 `story_settle` 自动抽取并校验；返回 `settled:false` 时把 proposed 与 findings 报给作者，按作者决定用 `story_state` 手动修正。`story_state` 只写变化，不重抄设定。

## 输出契约

- 正文、章纲、审稿清单、摘要、状态、卷一律由动作落盘，不要用文件工具直接写作品库：动作负责版本、进度与事务，直写会让进度与库不一致。
- 只读动作：`story_next`、`story_context`、`story_brief`、`story_bible`、`story_critique`、`story_status`、`story_volumes`、`story_read`。
- 写正文/审稿/修订优先用 `story_delegate`；delegate 不可用或需要手动控制时，才用 `story_context(work, chapter, role)` + `subagent`。自己写前预览仍可用 `story_brief`。
- 章节末尾不写「作者的话」，不写总结段落。
