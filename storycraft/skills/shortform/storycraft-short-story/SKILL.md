---
name: storycraft-short-story
description: 短篇形态契约：立项、篇纲、正文提交与自检入口；方法正文读 storycraft-short-writing。
whenToUse: 用户要求写一篇独立短篇、把一个想法写成短篇，或要求检查短篇的节奏与结构时。
---

# 短篇契约

形态：`story_init` 的 `form: "short"`。章节单位是「篇」；一个短篇可以是一篇或多章组成的完整故事，必须一次写完，不拆成上下部或连载。当前动作仍按单章正文提交；批量短篇产物在 S 阶段接入。

## 先读方法

加载 `storycraft-short-writing` 并读 `references/production-checklist.md`。本技能只写形态契约，不复制方法正文。

## 先讨论，后立项

作者用自然语言提想法时，**先讨论**：前提、主要人物、核心冲突、想写的体验，优先复用作者已经说过的内容。讨论阶段不写任何文件，也不调用 `story_init`。

方向成熟后，用 `story_propose` 落一份建项方案（标题、形态、一句话前提、主要人物、冲突、约定），把方案讲给作者看，**等作者明确同意**后再 `story_init`（带 `proposal`）。立项完停下，等作者决定要不要写第一篇。

## 输出契约

- 正文通过 `story_write` 落库；委派时通过 `story_submit {title,body}` 提交，一次交付完整短篇，不写上下部或连载。
- 不要再写 `stories/*.md` 或 `stories/*.notes.md`：作品只存在 `.storycraft/works/<workId>.db`，文件路径不会进库。
- 一句话故事、转折位置、结尾形状写在提案 brief 或作者对话里；需要时用 `story_plan` 落篇纲。
- 不写标题党式标题；标题从正文里的具体物件或动作里取。
- `story_submit` 返回 `ok:false` 时按 `error.retryable` 修正后重提，最多 3 次。

## 脚本

`scripts/story-metrics.mjs` 统计字数、段落数、对话占比与场景数，用来判断节奏是否失衡（对话过多、段落过长、场景过碎）。

这是**作者侧离线工具**：先从面板导出或复制正文到临时文件，再运行；委派子代理不写文件，正常流程用 `story_critique`。

```bash
node <技能目录>/scripts/story-metrics.mjs <正文文件>
```
