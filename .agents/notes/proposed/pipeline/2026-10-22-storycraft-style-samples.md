---
title: 故事工坊：从既有正文抽取文风样例
status: proposed
created: 2026-10-22
updated: 2026-10-22
---

# Agent Note：故事工坊：从既有正文抽取文风样例

## 问题

`bible/style` 只有作者手写或导入的文风描述，写前装配看不到“这本书实际怎么写”。A8 需要从已写正文抽可复现的样例与指标，补进文风真值，而不是让 LLM 再写一段形容。

## 提案

### 1. 纯函数 `styleProfile(bodies)`

输入 `[{number, body}]`（只含当前 revision），输出：

- 句数、平均/中位句长、句长标准差（code point，1 位小数）；
- 段落数、对话段占比（段落含 `“`、`"`、`「」`、`『』`）；
- 常用标点计数（`。，、；：！？…`）；
- 最多 3 段样例，每段 **120–240 code point**；
- 同一输入结果稳定。

句切分与 A4 一致：`/[。！？…；
]+/u`；段落按空行切。偶数中位数取中间两值平均；标准差用总体标准差。

### 2. 样例窗口

单段正文常短于 120 字（真实章节段落 4–124），因此样例由**连续段落合并**：

1. 从段落 `i` 起，向后累加，直到长度 ≥120；
2. 长度在 120–240 内成为候选；超过 240 则跳过该窗口（不截断句子），起点 `i` 前进 1 段继续找；
3. 采用不重叠窗口；最后不足 120 的尾巴并入前一个候选（若仍 ≤240）；
4. 去重完全相同文本；按 `|长度 - 候选窗口中位长度|`、章节号、段落索引排序；
5. 优先不同章各取 1 段，不足 3 段再从剩余候选补；
6. 无候选时 `samples: []`，指标仍返回。

### 3. 受管区块

`extractStyleSamples(root, work)`（bible.js，确定性、无 LLM）：

1. `readManifest` + `listBodies` 一次取全部版本，按 `current_revision` 过滤当前正文；无正文 → `style-no-source`；
2. `styleProfile`；
3. `stripBlock` 删除所有受管区块，再 `mergeBlock` 追加一个区块到末尾：

```text
<!-- storycraft:style-samples:start -->
## 文风样例（自动抽取）
指标：句数 42 · 平均句长 18.3 · 中位 17 · 标准差 4.2 · 对话段 35%
### 样例 1（第 2 章）
...
<!-- storycraft:style-samples:end -->
```

4. 用现有 `writeBible` 写入；版本是内容哈希：内容不变则版本不变，重复抽取字节一致；内容变化才变版本；
- 区块替换：删除所有 start..end 块；start 无 end 删到 EOF；重复块全部删除；统一 LF；新块总在末尾；作者块外文字保留；
5. 返回 `{metrics, sampleCount, sampleChars, chapters, version}`，不返回样例全文（面板只提示数量；全文在 style 里）。

区块规则：

- 标记常量在 `style.js`；`stripBlock` 删除所有 start..end 区块；start 无 end 时删到 EOF；作者正文里出现保留标记视为受管标记（文档说明）；
- 统一 LF；`mergeBlock` 保证只有一个区块且总在末尾；
- 作者原有段落保留，不覆盖；`readBible→writeBible` 为最后写入者胜（单写者面板）；
- 区块使 style 不再是“只有标题的草稿”（`isDraft`），这是有意的：已有样例。

### 4. API/面板

- `POST /api/dsh-storycraft/style/extract` `{root,sessionId,workId}`；当前作品校验，32KB body；
- 面板作品 header「抽取文风」；`sessionId` 缺失时禁用；成功提示“已抽取 N 段 / 指标”，失败显示错误；
- 不注册 `story_*` 动作，不产生 composer 消息。

### 5. Brief/边界

- `story_brief` 的 style 段仍读 `bible/style`，自动包含区块；8KB 裁剪规则不变；style 可能被裁，AC 只要求“未被裁时包含”；
- 只用当前 revision；不选历史版本；
- 不改正文/摘要/审稿/导出 schema；
- style 缺失：`readBible` 不存在则 `bible-missing`（初始化总会建，正常不触发）；无正文优先 `style-no-source`；
- `styleProfile`/`stripBlock`/`mergeBlock` 在 `style.js`，`extractStyleSamples` 在 `bible.js`；`style.js` 进 package files。

## 与既有记录

- **补充 A8** #4：文风样例抽取；文风基准读写沿用 A7。
- **补充 A7** [bible-and-brief](../../implemented/pipeline/2026-10-17-storycraft-bible-and-brief.md)：style 段可含受管样例区块。
- 更新 README/API/#4 A8；`package.json.files` 加入 `style.js`。

## 备选方案

- **LLM 生成文风描述**：不可复现、增加成本；否决。
- **独立 style-sample 真值文件**：扩真值五件、brief/导出/版本都变；否决，用受管区块。
- **覆盖作者 style**：丢作者原意；否决，只替换受管区块。
- **取全部段落**：重复且超预算；否决，最多 3 段。

## 验收条件

1. `styleProfile` 指标确定；样例窗口 120–240、最多 3 段、不同章优先、去重、稳定排序。
2. 受管区块替换幂等：重复抽取内容不变、版本不变；内容变化才变版本；作者原文保留；start 无 end/重复块被清理。
3. 无正文 `style-no-source` 且不改 style；style 缺失 `bible-missing`。
4. `story_brief` 的 style 段未被裁时包含样例；被裁时 `dropped`/`bytes` 可观察。
5. API 当前作品校验；面板按钮/提示；无 composer 消息。
6. 测试：纯 profile/merge、`style.test`、E2E 按钮、真实验证在临时克隆的整个 `.storycraft` 工作区做（段落窗口 2–3 段），不触碰作者库。
7. README/API/#4 A8 同步；`style.js` 进 package files。

## 风险

- 段落窗口可能跨场景合并；作者可重新抽取/编辑 style。
- 真实短章可能只有 1 段样例；指标仍写入。
- 区块进入导出/brief；作者可编辑 style。
- 受管标记写入作者正文时会被当区块清理；文档说明保留标记。
