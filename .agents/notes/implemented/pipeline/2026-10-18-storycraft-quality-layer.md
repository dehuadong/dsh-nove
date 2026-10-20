---
title: 故事工坊：质量层（字数口径、质检指标、修订模式）的技术设计
status: implemented
created: 2026-10-18
updated: 2026-10-20
verification: critique.test.mjs 23 项（指标确定性、字数边界与范围判定、设定/清空/非法拒绝、四档模式）全过；八套断言与三条页面 spec 全过；真实会话验收：字数范围生效、质检指标显示、polish 提交成功、patch 无条目被拒、deslop 零命中被拒后改为允许（7d82816）。证据见工作项 dehuadong/dsh-nove#8；2026-10-20 delegate 字数门（writer min/max、reviser max）测试通过。
---

# Agent Note：故事工坊：质量层（字数口径、质检指标、修订模式）的技术设计

## 问题

现在审稿完全靠模型自由发挥：没有字数口径（作者可能写 2500 字的短章，也可能写 8000 字的长章），没有可复现的指标看重复与 AI 腔，修订只有一条路径（按条目改）。结果是：同一章两次审稿提的问题不同，作者也无法判断「改了多少才算重写」。

产品行为与验收由工作项拥有，不在这里。

## 决定

### 字数口径

`manifest.json` 增加 `wordRange: { min, max }`，由 `story_init` 的可选参数写入（建档时与作者商量）。写入走既有的 manifest 提交路径，不改版本号。

`story_brief` 的 `wordPolicy` 段：有 `wordRange` 时写「单章 X–Y 字」；没有时写「未设定（按作者习惯）」。`story_delegate` 的 writer 硬校验 `[min,max]`、reviser 只硬校验 `max`（低于 min 警告）；超界返回 `delegation-word-range`；手动 `story_write` / `story_revise` 仍不硬判定。这是对“指标只观察”的部分替代，见 `proposed/pipeline/2026-10-20-storycraft-host-delegation.md`。

### 质检（纯函数）

新模块 `critique.js`，导出 `critique(text, wordRange)`，不读写文件：

- 句子切分：按 `。！？…；` 与换行切，去掉空白；空句丢弃。
- `sentences`：数量、平均长度（字符）、最长句长度。
- `repeated`：把句子去掉标点与空白后，长度 ≥ 12 且出现 ≥ 2 次的句子；返回 `{ text, count }`，按出现次数降序、文本升序稳定排序。
- `aiPhrases`：内置词表（约 20 条，如「不禁」「仿佛」「空气仿佛凝固」「心中五味杂陈」「如同一场梦」「在这个瞬间」「与此同时」「无声地诉说着」…），统计出现次数并给样例；匹配不区分大小写（中文无大小写，但含英文词条时统一小写）。
- `dialogueRatio`：含 `「」『』“”"` 的行 / 非空行。
- `withinRange`：有范围时布尔，无范围时 `undefined`；另给 `shortBy`/`longBy` 差值。

动作 `story_critique(work, chapter)`：读当前版本正文，返回上述指标 + `wordRange`，只读。

### 修订模式

`story_revise` 增加 `mode`（缺省 `patch`），在既有校验之后加模式校验：

| 模式 | 校验 |
| --- | --- |
| `patch` | `|new - old| <= 0.2 * old` |
| `polish` | `|new - old| <= 0.4 * old` |
| `rewrite` | 只要求正文不同（既有校验） |
| `deslop` | `critique(new).aiPhrases.count < critique(old).aiPhrases.count` |

模式写入章节条目的 `lastReviseMode`；失败码 `revise-mode-violation`，消息给出实测幅度与上限。

### 工作台

- 章节详情「质检」按钮 → `story_critique`，把指标显示在审稿清单上方（只读）。
- 修订按钮旁的选择框：补丁 / 润色 / 重写 / 去 AI 味，投递指令时带上模式。

## 备选方案

- **用模型打分做质检**：不可复现、每次不同、要花额度；指标类问题恰恰不需要模型。放弃。
- **指标不达标就阻断结算**：会把「字数偏短」变成硬错误，作者可能故意写短章；与参考的「打分只观察」也不一致。放弃。后续 `story_delegate` 的 writer/reviser 门是例外（见 proposed 设计），手动路径仍不阻断。
- **修订模式靠提示词约束**：模型可以无视；动作层校验才能保证。放弃。
- **词表用大而全的 AI 检测模型**：本地不可控、成本高；先内置小词表，靠审稿条目补充语义层的问题。

## 验证

- 指标：构造重复句、AI 腔词、长短句混合的正文，断言计数与排序稳定；两次调用逐字段一致。
- 字数：有范围/无范围两种；边界值（恰好 min、max）。
- 修订模式：四档各一条通过、各一条拒绝。
- 回归：七套断言与三条页面 spec。

## 后果

- 词表会误伤正常表达（「仿佛」本身不坏）；所以指标只作为审稿提示，不做硬判定。
- `dialogueRatio` 是粗估（引号风格不同），只用于趋势，不参与任何校验。
- 20% / 40% 的幅度阈值是经验值；写进错误消息，作者看到实测值再决定是否换模式。
