---
name: storycraft-short-drama
description: 剧本形态契约：立项、spec/分集/场次提交与自检入口；方法正文读 storycraft-script-spec / storycraft-script-scene。只出方法与提交内容，不直接改文件。 触发：用户要求写短剧剧本、把一个故事改成竖屏短剧、或要求检查分集节奏与单集钩子时。
---
# 剧本契约

形态：`story_init` 的 `form: "script"`。章节单位是「集」；一集一场次稿，动作与长篇相同，只是文本按场次与台词组织。

## 先读方法

加载 `storycraft-script-scene` 读 `references/episode-scene-craft.md`；spec 与分集读 `storycraft-script-spec` 的 `references/spec.md`。本技能只写形态契约，不复制方法正文。

## 先讨论，后立项

作者用自然语言提想法时，**先讨论**：前提、主要人物、核心冲突、想写的体验，优先复用作者已经说过的内容。讨论阶段不写任何文件，也不调用 `story_init`。

方向成熟后，用 `story_propose` 落一份建项方案（标题、形态、一句话前提、主要人物、冲突、约定），把方案讲给作者看，**等作者明确同意**后再 `story_init`（带 `proposal`）。立项完停下，等作者决定要不要写第一集。

## 输出契约

- 正文通过 `story_write` 落库；委派时通过 `story_submit {title,body}` 提交。
- 不要再写 `stories/*.md` 或 `stories/*.notes.md`：作品只存在作品库，文件路径不会进库。
- 卖点、集数/时长、人物动机表、钩子链写在提案 brief 或作者对话里；需要时用 `story_plan` 落集纲。
- `story_submit` 返回 `ok:false` 时按 `error.retryable` 修正后重提，最多 3 次。

## 脚本

`scripts/episode-metrics.mjs` 统计集数、场次数、台词句数与估算时长，用来判断单集体量是否超重或过轻。

```bash
node <技能目录>/scripts/episode-metrics.mjs <剧本文件或目录>
```
