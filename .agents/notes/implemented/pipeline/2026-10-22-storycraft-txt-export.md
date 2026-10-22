---
title: 故事工坊：TXT 单文件导出
status: implemented
created: 2026-10-22
updated: 2026-10-22
verification: 29 单测 + 13 E2E；真实雪线邮路 book.txt 4 章、manifest v5、33 文件
---

# Agent Note：故事工坊：TXT 单文件导出

## 问题

D1 的目录导出已有逐章 md/json，但没有可直接阅读、转发的单文件。TXT 是无依赖的最小补充；EPUB 需要打包与 XHTML，另行规划。

## 决定

### 1. 文件内容

`exportWork` 在导出目录写 `book.txt`：

```text
书名

第 1 章 标题

正文……

第 2 章

正文……
```

- UTF-8、LF；
- 首行 `manifest.title`（换行/CR 压成空格，trim；空白标题写 `未命名`）；
- 章按 `chapters.number` 升序，只取 `current_revision > 0`；
- 章节标题 CR/LF 压成空格、trim；空/纯空白标题写 `第 N 章`；
- 正文取该章**当前 revision**（复用 `currentVersion`，`chapters.current_revision` 权威；缺版本行返回 `export-failed`），不是全部历史；正文 CRLF/CR 统一为 LF，去掉尾部换行；
- 字节模板：`title\n\nheading\n\nbody\n\nheading…body\n`；即标题与每章之间、章与章之间各一个空行，EOF 一个换行；空作品（0 个已写章，含只有计划）只有 `title\n`，仍写 `book.txt` 并计数。

### 2. manifest

- `EXPORT_SCHEMA_VERSION` 4→5（独立于作品库 `user_version:5`）；
- 增加 `book: {file:'book.txt', format:'txt'}`（不用 `formats`，避免与 json/素材文件混淆）；
- 其余字段不变；
- `book.txt` 进入 `files` 计数，mtime 仍用 `EXPORT_MTIME`；
- 旧 v4 导出不自动补 txt；重新导出生成 v5。

### 3. 边界

- 面板 `exportWorkAtomic`（临时目录→备份→替换）不变；`book.txt` 与 md 同批写入 staging，失败整批回滚；`story_export` 的 `exportWork()` 默认路径行为不变（先删目标、无回滚）；
- 备份/恢复不变；导出不打开文件管理器；导出 `schemaVersion:5` 与作品库 `user_version:5` 是两套版本，互不绑定；
- 不生成目录页/TOC、不做排版、不引入 EPUB/zip；
- `story_export` 模型回执只报文件数，不含路径。

## 与既有记录

- **补充 #27/D1** [panel-export](../../implemented/pipeline/2026-10-21-storycraft-panel-export.md)：manifest 升 v5，新增 `book`；原子替换不变。
- 同步 README 的 manifest v4→v5、E2E `schemaVersion` 断言、#4 D1 仍为部分（epub 未做）。
- #18 [sqlite-store](../../implemented/pipeline/2026-10-19-storycraft-sqlite-store.md) 的 manifest 版本文案补 v5。

## 备选方案

- **EPUB 与 TXT 一起做**：需要 ZIP/XHTML 与阅读器验证，范围过大；否决。
- **只把 md 改名为 book.txt**：保留 Markdown 标记，不是可读纯文本；否决。
- **每个历史版本都拼进 txt**：作者拿到重复正文；否决。
- **manifest 不升版本**：新增格式属于导出契约变化；否决。

## 后果

产品验收在 #32；本 Note 检查技术性质：

1. `book.txt` 章序、标题、当前正文正确；未写章不出现。
2. manifest v5、`book:{file:'book.txt',format:'txt'}`；文件计数含 txt。
3. 旧 v4 导出不变；重新导出 v5。
4. 原子导出失败保留旧目录，无半成品 txt。
5. 测试：export-backup（内容/顺序/多行标题/空白标题/只有计划/v4→v5，`files` 等于递归计数）；export-atomic（计数/manifest）；更新 E2E 的 v4 断言为 v5，不新增 spec。
6. 真实 `雪线邮路` 导出 4 章文本；对比当前 revision 的 md（r2/r2/r1/r4），去掉 md 尾换行后逐章一致。

## 风险

- 纯文本没有章节跳转/排版；作者需要阅读器/转发时接受。
- 大书 `book.txt` 可能很大；导出仍一次性内存拼接，本项接受，后续可流式。
- 书名/章节标题可能含换行，需要规范为单行。
- v5 改变外部消费者；按版本号显式升级。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- `export-backup`：字节模板、章序、空白/多行标题、只有计划、旧 v4 目录、`files` 计数。
- `export-atomic`：manifest `book`、book.txt、递归文件计数、缺失当前版本 `export-failed`。
- 真实 `雪线邮路`：`book.txt` 4 章、当前 revision、manifest v5、`files` 33（原 32+book）。
