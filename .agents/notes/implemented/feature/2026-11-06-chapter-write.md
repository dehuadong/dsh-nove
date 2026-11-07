# Agent Note: 故事工坊：chapter.write 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `chapter.write`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

审计把章节正文登记为保真债：字数统计未剥离 Markdown，未按语言 counting mode，`wordRange` 未作为硬边界。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/agents/writer.ts:100-160` | writer 写正文并按 lengthSpec 统计 | 复刻 writer landing 写 chapter revision |
| `utils/length-metrics.ts:15-65` | 先剥离 Markdown；zh_chars 数非空白字符；显式 min/max 硬校验 | 复刻 `stripMarkdownMetadata`/`countChapterLength` 与 `chapter-length-out-of-range` |
| `models/length-governance.ts:3-13` | countingMode 由作品语言决定 | 当前作品无 language，en_words 未实现，登记后续债 |

## Decision

- `domain/chapters.ts` 增加 Markdown 剥离与 `countChapterLength`（zh_chars）；
- `writeChapter` 用统一长度函数；`wordRange` min/max 越界抛 `chapter-length-out-of-range`；
- writer landing 把 `manifest.wordRange` 传给 `writeChapter`；
- critique 与 write 共用同一长度函数；
- `en_words`/language 与 state settlement 留后续/其他能力。

## Alternatives considered

- **只改 countWords 不加范围校验。** 最强理由是避免 writer 返工；源显式 min/max 是硬校验，故不采用。
- **把 target 当硬范围。** 最强理由是简单；源明确 target 不硬卡，故不采用。
- **本行同时引入 language。** 最强理由是完整；会扩 work schema 与所有作品配置，故登记后续债。

## Consequences

- **收益**：Markdown 元数据不计入字数；显式范围硬校验；critique 与 write 同数。
- **代价**：现有正文 fixture 的 words 统计按新规则；en_words 尚未支持。
- **边界**：state settlement 归 `chapter.settle`。

## Verification

```text
node storycraft/tests/chapter-length.test.mjs        # ALL CHECKS PASSED
node storycraft/tests/acceptance-multichapter.test.mjs # PASS
node storycraft/scripts/ci.mjs --no-e2e              # PASS: 103 unit files
npm run verify                                       # 17 verified / 23 missing
```

真实 fixture `示例短篇` 第 1 章：revision 2，words 675，settled。

回执：`artifacts/real-runs/chapter.write.json`。
