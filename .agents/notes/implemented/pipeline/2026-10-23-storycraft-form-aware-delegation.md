---
title: 故事工坊：委派形态路由（长篇/短篇/剧本）
status: implemented
created: 2026-10-23
updated: 2026-10-23
verification: 33 单测全过；delegate 覆盖长篇/短篇/剧本 writer 与短篇 reviewer/reviser；skills 覆盖已挂载目录
---

# Agent Note：故事工坊：委派形态路由（长篇/短篇/剧本）

## 问题

`delegate.js` 的 writer 只加载 `storycraft-write-craft`，子代理提示固定写「长篇小说」。短篇、剧本走同一个 `story_delegate`，但子代理拿不到 `storycraft-short-story` / `storycraft-short-drama`；形态是作品数据，委派层却没有读它。

## 决定

### 1. 形态元数据

放在 `domain.js` 已有 `WORK_FORMS` / `formOf` / `unitOf` 旁边，不再造第四套形态注册表：

```js
export const FORM_META = {
  longform: { label: '长篇小说', skill: 'storycraft-write-craft' },
  short: { label: '短篇小说', skill: 'storycraft-short-story' },
  script: { label: '剧本', skill: 'storycraft-short-drama' },
}
```

- `formOf(manifest)` 已把未知/缺失形态回落到 `longform`，委派层直接用它，不重复判断；
- `unitOf(form)` 给单位：章 / 篇 / 集；
- 提示头用 `FORM_META[form].label` 与 `unitOf(form)`，不再写死「长篇小说」「第 N 章」。

### 2. 技能列表

`writerSkills(form)` 返回 Set 去重后的数组：

- longform：`['storycraft-write-craft']`（故意不再叠加 `storycraft-longform-chapter`，后者是流程技能，不是写法技能）；
- short：`['storycraft-write-craft', 'storycraft-short-story']`；
- script：`['storycraft-write-craft', 'storycraft-short-drama']`。

reviewer / reviser / summarizer 只加载现有角色技能，不追加形态技能；提示头仍按作品形态显示标签与单位。

### 3. 提示

```text
你是{长篇小说|短篇小说|剧本}《标题》（id）的{写手|审稿|修订|摘要}子代理，负责第 N {章|篇|集}。
开工前先调用 skill 工具加载 `通用写法` 与 `形态技能`（两份都列名字）。
```

- 只有 writer 有形态技能；reviewer/reviser 仍只列角色技能；
- 只同步 `storycraft-studio-orchestration` 的 writer 路由表；不改任务段、上下文段、`story_submit` 输出契约；
- 不改委托回执、预检、落盘。

### 4. 测试

- 用 `skills.test.mjs` 的 `mount('all')` 拿已挂载技能名，断言 `ROLE_META` + `FORM_META` 的每个名字都在其中。
- 长篇 writer：提示头是「长篇小说」，负责「第 1 章」，技能只有 `storycraft-write-craft`（恰好一次）。
- 短篇 writer：提示头是「短篇小说」，负责「第 1 篇」，技能含 `storycraft-write-craft` + `storycraft-short-story`。
- 剧本 writer：提示头是「剧本」，负责「第 1 集」，技能含 `storycraft-write-craft` + `storycraft-short-drama`。
- 短篇 reviewer/reviser：只含角色技能，提示头仍是「短篇小说」，不出现 writer 形态技能。
- 现有 `delegate.test.mjs` 全过；33 单测全过。

## 与既有记录

- 补充 #39；路线图 R6b 只做路由，`R6b-fix` 单独处理 short-story 输出契约；对拍矩阵「形态→技能」缺口同步更新。
- 不改变 #19 的委派合同与 #12 的输入契约。

## 备选方案

- **在宿主按 form 拼 skill 名称**：与 `ROLE_META` 重复；否决。
- **把短篇/剧本技能合并进 `storycraft-write-craft`**：技能会变成长篇+短篇+剧本大杂烩，Token 与职责都变差；否决。
- **委派前让主编手工点名技能**：依赖模型记忆，容易漏；否决。

## 后果

1. 三种形态的 writer 提示加载通用写法 + 正确形态技能，标签与单位正确。
2. 短篇/剧本提示不再出现「长篇小说」。
3. 技能名均在 `mount('all')` 的已挂载目录中；reviewer/reviser 不加载形态技能。
4. 现有委派测试与 33 单测通过；E2E 受登录弹窗阻塞时如实记录；对拍矩阵同步。

## 验证

- `node storycraft/scripts/ci.mjs --no-e2e`：33 个单测文件全过。
- delegate.test.mjs：长篇/短篇/剧本 writer 的提示头、单位与技能；短篇 reviewer/reviser 不加形态技能。
- skills.test.mjs：ROLE_META + FORM_META 的每个技能都在 mount('all') 目录中；writerSkills 去重正确。
- E2E 未跑：本机 Playwright 环境/登录弹窗阻塞。

## 风险

- 形态技能正文可能还写 `stories/*.md`（短篇），路由正确但输出契约仍可能误导；另开 R6b-fix。
- 新增 form 时需要同步 `FORM_META` 与已挂载技能目录测试。
