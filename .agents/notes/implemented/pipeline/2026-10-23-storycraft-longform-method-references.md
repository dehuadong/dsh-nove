---
title: 故事工坊：长篇方法资源与阅读触发
status: implemented
created: 2026-10-23
updated: 2026-10-23
verification: 35 单测全过（含 skill-references）；all 挂载 9 个技能、longform 2 个；docs check 通过
---

# Agent Note：故事工坊：长篇方法资源与阅读触发

## 问题

现有三份角色技能（规划、写作、审稿）各自只有一份薄正文：规划能划卷、定章纲五项，写作能转场景、控节奏，审稿能列问题，但没有共享的长篇判断依据。结果是同一章在三个角色眼里标准不一致：规划不知道卷末必须留下不可逆变化，写作不知道开篇承诺要靠后续事件持续供给，审稿无法判断「提到伏笔」与「推进伏笔」的差别。

参考实现把这些方法放在长篇写作技能的四份 references 里，由 architect / planner / writer / auditor / reviser 共同使用；我们按角色拆了技能，却没有给跨角色方法一个共同的家。产品范围与验收由工作项拥有，不在这里。

## 决定

### 1. 一份共享方法技能

新增 `storycraft-longform-method`，放在 `storycraft/skills/longform/`，与单章流程技能并列：

```text
storycraft/skills/longform/storycraft-longform-method/
  SKILL.md
  references/foundation-design.md
  references/reader-contract-and-progression.md
  references/state-projection.md
```

`SKILL.md` 只做索引与阅读触发：说明三份参考各自回答什么问题、什么时候读，并明确它不产出 JSON、不改阶段、不替代角色技能的输出契约。references 是判断依据，不是可复制模板。

### 2. 三份参考的内容边界

| 文件 | 回答什么 | 不写什么 |
| --- | --- | --- |
| foundation-design.md | 叙事引擎、世界硬规则、卷末不可逆变化、人物弧代价、初始伏笔 | `story_outline` 的字段说明、JSON 示例、卷区间操作 |
| reader-contract-and-progression.md | 开篇承诺、多轴推进、余波、章纲自检、因果归属、线占比 | 审稿输出格式、评分、具体作品判断 |
| state-projection.md | factOps、hook 三态生命周期、投影边界、数值与在场 | 不存在的状态或档位字段、语义对账、自动抽取 |

三份都按本实现的契约改写，不复述参考实现的对象与字段：

- 伏笔只有 `opened` / `used` / `resolved` 三态；
- 伏笔身份是 `text` 的精确文本，后文续写同一承诺要沿用原句，否则会被当成新伏笔；
- 事实重复按精确文本报 `duplicate-fact`，只警告不拦；factOps 映射为 `entities[].facts[]`；
- 投影入口是主编在摘要后调用的 `story_state`，不是自动抽取；
- 语义对账归 R9b，不在本项。

### 3. 阅读触发

只改技能正文，不改 `delegate.js`、不改动作：

| 技能 | 触发 | 读 |
| --- | --- | --- |
| `storycraft-plan-craft` | 出全书计划 / 划卷 / 种初始伏笔 | `references/foundation-design.md` |
| `storycraft-plan-craft` | 写章纲 / 判断一章是否成立 | `references/reader-contract-and-progression.md` |
| `storycraft-write-craft` | 长篇章的开篇、推进、余波与因果 | `references/reader-contract-and-progression.md` |
| `storycraft-review` | 长篇推进、重复、余波、因果归属 | `references/reader-contract-and-progression.md` |
| `storycraft-review` | 正文事实与伏笔账本是否对得上 | `references/state-projection.md` |
| `storycraft-studio-orchestration` | 定稿前写 `story_state` | `references/state-projection.md` |

角色技能仍是唯一的输出契约；方法技能被点名后由角色自己用 `skill` 工具加载，再读对应 reference。短篇、剧本不读这份方法技能。章纲的伏笔答案写进现有五项，不新增字段。

### 4. 静态验证

`tests/skill-references.test.mjs` 校验：

- 三份 reference 存在、有标题与正文，方法技能点名全部，references 目录没有孤儿文件；
- 方法技能不超过 60 行，不含 `story_submit` / `payload` / 代码块；
- 四个角色技能以「加载方法技能 + 读它的 `references/...`」的完整路径点名触发；
- 短篇、剧本不被要求读长篇方法；
- 伏笔状态从 `state-validation.js` 的 `HOOK_STATES` 读取并与参考对照，参考不得引入参考实现独有的状态或时间字段。

## 备选方案

- **把三份参考放进 `storycraft-write-craft/references/`**：写作能读，规划与审稿要么加载写作技能，要么按相对路径跨目录读；两者都会把写作方法带进别的角色。否决。
- **每个角色技能各放一份副本**：没有单一家，改一处要同步三处，必然漂移；违反「一个事实一个家」。否决。
- **并入 `storycraft-longform-chapter`**：那是主编的完整单章流程技能，含动作顺序与落盘约束；子代理加载会把流程指令带进来。否决。
- **把方法内容直接塞进三份角色技能正文**：角色技能会重新变成长文，且三份各写一遍；无法按需读。否决。
- **照搬参考实现的 `superseded`、`lastAdvancedChapter`、兑现档位**：本实现没有这些字段，写进去会让模型调用不存在的状态并被 `invalid-hook-state` 拒绝。否决。

## 后果

1. 规划、写作、审稿与定稿前的主编按需读取三份 reference；方法技能本身不构成输出契约。
2. `all` 模式挂载 9 个技能，`longform` 目录挂载流程与方法 2 个技能。
3. 没有动作、schema、委派、阶段机、落盘或 UI 变化；短篇、剧本与修订者不受影响。
4. 按需加载依赖角色技能里的触发句，静态测试只能证明点名，不能证明运行时一定加载。
5. 角色目录（`write` / `review` / `plan`）单独挂载时不含方法技能；当前预设只用 `all`，若日后拆角色目录，需要把方法技能加入对应目录。
6. 参考内容与 `story_state` / 章纲五项是两套表述；代码契约变化时要同步改参考。

## 验证

- `node storycraft/scripts/ci.mjs --no-e2e`：35 个单测文件全过，新增 `skill-references.test.mjs`，既有 34 个不回归。
- `skill-references.test.mjs`：三份 reference 存在且被点名；四个角色触发完整；短篇/剧本不点名方法；`HOOK_STATES` 与参考一致，参考不含 `superseded` / `lastAdvancedChapter` / `兑现区间` / `兑现档位`。
- `skills.test.mjs`：`all` 9 个、`longform` 2 个，方法技能被挂载。
- `node scripts/decisions/check.mjs` 通过。
- `git diff` 未触及 `delegate.js`、`tools.js`、动作 schema、阶段机与 UI。
- E2E 未跑：本机 Playwright/DSH 登录弹窗仍阻塞，不能声称 E2E 通过。
