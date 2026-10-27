# 五类派发模板

| 角色 | 首选 | 手动兜底 | 技能 | 输出契约 |
| --- | --- | --- | --- | --- |
| 写手 | `story_delegate(role:'writer')` | `story_context` + `subagent` | 阶段技能（`storycraft-long-prose` 等）+ 形态契约（`storycraft-longform-chapter` / `storycraft-short-story` / `storycraft-short-drama`） | 委派：`story_submit {title,body}`；手动：`<<<TITLE … TITLE>>>` + `<<<CHAPTER … CHAPTER>>>` |
| 审稿 | `story_delegate(role:'reviewer')` | `story_context` + `subagent` | `storycraft-review` | 委派：`story_submit {items}`；手动：同一 JSON，最多 8 条 |
| 修订 | `story_delegate(role:'reviser', mode)` | `story_context` + `subagent` | `storycraft-revise-craft` | 委派：`story_submit {body}`；手动：整章正文（同一对首尾标记） |
| 摘要 | `story_delegate(role:'summarizer')` | —（仅作者显式要求时主编手动写） | — | 委派：`story_submit {rawText,title,characters,events,stateChanges,hookActivity,mood,chapterType}`；`rawText` ≤400 字、结构字段各 ≤120 字；手动：`story_summarize` |
| 规划 | `story_delegate(role:'planner')` | `story_context` + `subagent` | 形态 craft，按节点读 `references/chapter-plan.md`（长篇/短篇）或 `references/spec.md`（剧本） | 章纲 JSON（五项 + body + threadRefs）或全书计划 JSON（三段） |

任务段一律由宿主或 `story_context` 生成，作者要求写进 `instruction`，不要在任务里另写一套上下文。

## 章纲确认

用户说「写第 N 章」但该章还没有章纲时，先出章纲并用 `story_plan` 落成草稿，然后请作者在面板「章纲」里点「确认章纲」。写正文前先调 `story_next`，按回执继续。改章纲会清空确认，需要重新确认。作品设置 `planApproval` 可改为 `off`（不需要逐章确认），`required` 是默认。不要自己替作者确认，也不要自己代签。
