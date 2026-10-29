# Agent Note: 故事工坊：EPUB 导出

Status: implemented

## 问题

D1 只差 EPUB。现有导出有 md/json 与 #32 的 `book.txt`，但没有阅读器可打开的单文件电子书。EPUB 需要 ZIP 容器、OPF、nav 与 XHTML；本项用纯 Node 实现，不引入第三方依赖。

## 决定

### 1. 模块与文件结构

新建纯模块 `epub.js`：`buildEpub({title, identifier, chapters}) -> Buffer`，不碰 fs/SQLite；`exportWork` 只组装章节快照。`package.json.files` 加入 `epub.js`。

`book.epub` 结构：

```text
mimetype                         (stored, 第一个 entry，无 extra field)
META-INF/container.xml
OEBPS/content.opf
OEBPS/nav.xhtml
OEBPS/style.css
OEBPS/title.xhtml                (固定标题页)
OEBPS/ch-0001.xhtml
...
```

- `mimetype` 内容严格 `application/epub+zip`，无 BOM/换行，**stored**；
- container 的 rootfile `media-type="application/oebps-package+xml"` 指向 OPF；
- OPF：`package unique-identifier="bookid"`、`dc:identifier id="bookid"`、`dc:title`、`dc:language` `zh-CN`、`meta property="dcterms:modified"` 固定 `2000-01-01T00:00:00Z`；
- identifier 用 `urn:storycraft:<workId 的 UTF-8 hex>`，避免 CJK 非法 NSS；
- nav：`<nav epub:type="toc">`、manifest `properties="nav"`、`xmlns:epub`；nav 至少包含 title 页条目，0 章时 toc 不为空；
- XHTML 有 `xmlns`、`head`、`body`；
- spine：`title.xhtml` + 各章，按章号；0 已写章也有标题页，spine 非空。

### 2. XHTML 正文

- `title.xhtml`：书名；
- 章节标题 `<h1>第 N 章 标题</h1>`；空白标题只写 `第 N 章`；
- 正文按空行分段 `<p>`，段内换行 `<br/>`；
- HTML/XML 转义 `& < > " '`；`dc:title`、nav 文本、`<h1>` 都用 `oneLine`（与 `book.txt` 一致）；
- 不解析 Markdown；标题/正文 CRLF→LF。

### 3. ZIP 写入

- 纯 Node：CRC32 表 + `deflateRawSync(..., {level: 6})`；
- local header、central directory、EOCD；文件名 UTF-8；
- ZIP 时间固定 1980-01-01 00:00:00；
- `mimetype` stored（method 0，无 extra field），其余 deflate；
- entry 顺序固定，同输入两次字节一致。

### 4. 一次章节快照

`exportWork` 只查一次当前章节：
`current_revision > 0 ORDER BY number`，每章用 `currentVersion` 取 `{number,title,body}`；`book.txt` 与 `book.epub` 共用该快照，避免两次查询不一致。缺当前版本 → `export-failed`。

### 5. manifest 与计数

- `EXPORT_SCHEMA_VERSION` 5→6；
- 增加 `epub:{file:'book.epub',format:'epub'}`；`book`（txt）保留；
- `book.epub` 计入 `files`，mtime 用 `EXPORT_MTIME`；
- `put` 支持 `string | Buffer`，Buffer 不传 encoding；
- 旧 v5 导出不自动补 epub；重新导出生成 v6；
- 原子导出不变；`story_export` 回执仍是 `{directory, files}`（不含路径）。

### 6. D1 边界

- D1 的“可打开”没有真实阅读器验证前**保持部分**；本项只声明“EPUB 结构合法（ZIP/OPF/nav/spine 自解析）”。
- 不含封面/插图/NCX/Markdown 渲染；EPUB 2 兼容后续。
- 对拍：InkOS `export-artifact.ts` 使用 `epub-gen-memory`；我们选择纯 Node 避免新依赖，差异记录在本文与 #4。

## 与既有记录

- **补充 #32/D1** [txt-export](2026-10-22-storycraft-txt-export.md)：manifest 升 v6，新增 `epub`；TXT 不变。
- **补充 #27/D1** [panel-export](2026-10-21-storycraft-panel-export.md)：原子替换不变。
- **补充 #18** [sqlite-store](../architecture/2026-10-19-storycraft-sqlite-store.md)：导出 manifest v6，README v6；D1 仍部分。
- 更新 E2E `schemaVersion` 与 `book.epub` 断言，不新增 spec。

## 备选方案

- **第三方 EPUB/ZIP 库**：引入依赖；否决，纯 Node 可控。
- **0 章时省略 book.epub**：manifest/计数/测试分支更复杂；否决，用固定标题页保持有效 EPUB。
- **只导出 HTML**：不是 EPUB；否决。
- **把 md 直接塞进 XHTML**：Markdown 标记会显示；否决。
- **人工阅读器验收**：代理无法保证环境；结构测试 + 用户自选阅读器；D1 保持部分。

## 后果

产品验收在 #33；本 Note 检查技术性质：

1. ZIP 可解析；`mimetype` 第一、stored、无 extra field、内容正确。
2. container `media-type` 指向 OPF；OPF XML 可解析，`unique-identifier`/`dc:identifier id`/title/language/modified/nav/spine 正确。
3. 0 章有 title 页，spine 非空；有章时 title + 章序 1..N；未写章不出现。
4. XHTML 转义/分段/标题正确；dc:title/nav/h1 用 oneLine；缺当前版本 `export-failed`。
5. manifest v6 + `epub`；`files` 含 epub；固定 mtime；同输入 Buffer 字节一致。
6. 原子导出失败保留旧目录；旧 v5 目录不自动补 epub。
7. 测试：export-backup 用测试内 ZIP reader/OPF XML 解析；export-atomic 计数/manifest；E2E 更新 v6/book.epub；真实 `雪线邮路` 4 章 + title 页，ZIP 可解析。

## 风险

- 纯 Node ZIP 需自保证 CRC/central directory；测试解析每个 entry。
- 不渲染 Markdown；可后续。
- 固定 ZIP 时间可复现；阅读器兼容性需真实抽查，D1 仍部分。

## 验证

- `node storycraft/scripts/ci.mjs`：29 个单测文件 + 13 条 E2E 全过。
- `export-backup`：ZIP CRC/尺寸、mimetype 第一/stored/无 extra、XML 平衡、章序/空白标题/转义、空作品 title 页、Buffer 确定性。
- `export-atomic`：manifest v6/epub、book.epub、files 计数、缺失版本 `export-failed`。
- 真实 `雪线邮路`：`book.epub` 4 章 + title 页，Python `zipfile.testzip()` 干净，OPF XML 可解析，spine 5 项，`files` 34。
- 大书一次性内存构建；本项接受。

- 交付证据：29 单测 + 13 E2E；真实雪线邮路 book.epub 4 章 + title 页、ZIP/OPF 可解析、files 34
