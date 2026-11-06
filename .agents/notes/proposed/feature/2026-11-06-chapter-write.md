# Agent Note: 故事工坊：chapter.write 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `chapter.write`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

审计已把 `chapter.write` 登记为保真债：

- 源 writer 按 `LengthSpec` 的 `countingMode` 统计，先剥离 Markdown 元数据；
- 当前 `countWords` 直接数 CJK + 拉丁词，不剥离 Markdown；
- `lengthSpec` 没有进入 writer 落盘校验；
- 当前作品没有 `language` 字段，无法在 `zh_chars` / `en_words` 间选择。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/writer.ts:100-160` | writer 用 lengthSpec 统计字数并返回 wordCount；正文写成一版 | 复刻 writer landing 用统一长度函数，写 chapter revision |
| `utils/length-metrics.ts:15-47` | 先 stripMarkdownMetadata；zh_chars 数非空白字符，en_words 数英文词 | 复刻 `countWords` 剥离 Markdown；`zh_chars` 本行实现 |
| `utils/length-metrics.ts:52-65` | 显式 min/max 是硬校验；只给 target 不硬卡 | 复刻 `wordRange` min/max 作为硬范围，超界拒绝落盘 |
| `models/length-governance.ts:3-13` | countingMode 由作品语言决定 | 当前作品无 language；en_words 登记为后续债 |

## Proposal

### 范围

- `domain/chapters.ts`：
  - `countWords` 先剥离 Markdown 元数据（标题标记、代码围栏、链接语法等），再按 `zh_chars` 统计非空白字符；
- `writeChapter` / writer landing：
  - 用统一字数函数；
  - `wordRange` min/max 作为硬范围：低于 min 或高于 max 抛 `chapter-length-out-of-range`；
  - 只给目标、不给 min/max 时不硬卡（与源 `chapterLengthDelivery` 一致）；
- 消费者测试：
  - Markdown 标记不计入字数；
  - 低于 min/高于 max 拒绝；
  - 只给 target 不拒绝；
  - revision/正文落盘仍正确。

### 非目标 / 保真债

- **language + en_words 未实现**：当前作品没有 language 字段，`en_words` 无法选择。偿还路径：后续 work language 能力；本行只实现 `zh_chars`，审计表保持“后续行”债。
- state settlement 不在本行；归 `chapter.settle`。

### 失败行为

- 字数低于 min 或高于 max → `chapter-length-out-of-range`；
- 空正文 → 既有 `empty-body`；
- 未确认章纲 → 既有 `plan-not-approved`。

## Alternatives considered

**只改 countWords，不加范围校验。** 最强理由是避免 writer 返工；源显式 min/max 是硬校验，故不采用。

**把 target 当硬范围。** 最强理由是简单；源明确 target 不硬卡，故不采用。

**本行同时引入 language。** 最强理由是完整；会扩 work schema 与所有作品配置，超出正文写入，故登记后续债。

## Acceptance criteria

1. Markdown 标记不计入字数；
2. `wordRange` min/max 硬校验，越界拒绝；
3. 只给 target 不拒绝；
4. 正文/revision 落盘与现有测试一致；
5. `en_words`/language 债在审计表有后续归属；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先补长度函数与硬边界，不扩 work schema；en_words 登记债。
- Spec：Markdown、min/max、target、正文落盘都可观察。
- Architecture：writer 落盘仍走 `writeChapter`；长度函数属于 domain。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有测试正文含 Markdown/短文本，硬范围可能误伤 fixture，需只对显式 min/max 生效；
- `countWords` 改动影响 critique/revision 字数，需全量测试；
- 真实回执需要真实正文写入，不能只用 fixture。
