# Agent Note: 故事工坊：B1 epub/pdf 素材入库

Status: implemented

工作项：当前任务 B1（不新建 GitHub issue）。产品范围与验收归本 Note；依赖现有素材库与检索。用户已批准按 epub/pdf 收口，不做 URL 抓取或 OCR。

## Problem

素材库目前只接受 `.txt` / `.md`：

- 作者的外部长篇参考、设定集、PDF 资料无法入库；
- 仅支持 UTF-8 文本，二进制文件被 `material-format-unsupported` 拒绝；
- 即使手工转成 txt，也丢失原始格式、来源与页/章结构。

B1 要求“支持 txt/md/epub/pdf 入库并保留来源；验收：入库后可被检索命中”。

> 2026-10-31 作者确认：spine ≤500、单条解压 ≤8MB、抽取 ≤2,000,000 字符是**安全上限**，不是产品功能限制；超限拒绝。本文部分取代 [2026-10-21 素材库 Note](../../implemented/feature/2026-10-21-storycraft-material-ingest.md) 的格式/大小/错误表。

## 对拍参考

- `inkos-master/packages/core/src/materials/ingest.ts:3,156-168`：用 `unpdf` 的 `getDocumentProxy` + `extractText({mergePages:true})` 抽 PDF 文本；空文本报“扫描版需 OCR”，不静默入库；`MAX_SOURCE_BYTES = 18 * 1024 * 1024`。
- `inkos-master/packages/core/src/translation/epub.ts:15-46`：用 `jszip` 读 EPUB，`META-INF/container.xml` → OPF → 按 spine 顺序抽章节，去 HTML；无章节报错。
- 参考素材入库本身只有 text/pdf/webpage，没有 EPUB；EPUB 解析来自 translation 模块，本项按同一解析方式接入素材库。
- 参考把抽取正文写 Markdown 资产；本项目素材表只存抽取文本 + 原文件受管副本，检索用抽取文本。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| unpdf 抽 PDF | 同用 unpdf，空文本拒绝 | 扫描版无文本层 | 采纳 | PDF fixture |
| JSZip + OPF/spine 抽 EPUB | 同用 JSZip，去 HTML | 保持章节顺序 | 采纳 | EPUB fixture |
| 18MB 源文件上限 | 文本 512KB、epub/pdf 18MB | 不改变既有文本合同 | 等价适配 | 大小测试 |
| 抽正文写 Markdown | 抽取文本存 `content`，原文件保留受管副本 | 现有素材表只有文本列 | 偏差 | 检索/导出 |
| 不导出原二进制 | 导出复制受管原文件 | 避免把文本写成 .epub/.pdf | 补强 | 导出测试 |

## Decision

### 依赖与打包

- 新增 `unpdf@^1.6.2`、`jszip@3.10.1`（与参考一致）到 **devDependencies**，由 tsdown **内联进 `lib/`**；不 external、不依赖运行时 node_modules；
- 实现前先做 spike：`npm install` → build → 检查 `lib/index.js` 不含裸 `unpdf`/`jszip` import → 默认 `node scripts/ci.mjs`（E2E host 只复制 package files，无 node_modules）→ `--smoke`；
- bundle 或默认 E2E 失败则停回 planning，不改成 external。

### 解析

新增 `src/material-extract.ts`：

- `extractEpub(buffer)`：JSZip 读 `META-INF/container.xml`、OPF、manifest/spine；`encryption.xml` 只拒绝**加密的 spine 文档**（按 CipherReference URI 匹配），字体混淆等非正文条目继续；按 spine 去 HTML，保留章节标题分隔；空结果报 `material-extract-empty`；限制 spine 数量与解压后正文（`material-extract-too-large`），不 `extractAllTo`，不做文件系统解压；
- `extractPdf(buffer)`：`unpdf` `getDocumentProxy` + `extractText`；空文本报 `material-extract-empty` 并提示扫描版需 OCR；
- 解析错误统一 `material-parse-failed`，不透传底层堆栈；
- 抽取文本上限 **2,000,000 字符**；超过报 `material-extract-too-large`，不静默截断；源文件仍保留；
- EPUB 解压前限制：spine 条目 **≤500**；单条压缩前占用超过 **8MB** 或未知时拒绝；不超过再解压，解压后用 2M 字符兜底，防止 zip bomb；
- 不改 schema，不存页图/OCR；内联 `unpdf`（含 pdfjs）时加 `THIRD_PARTY_NOTICES.md`，随包发布。

### 导入

- `safeMaterialName` 接受 `txt/md/epub/pdf`，扩展名决定格式；文件内容做魔数校验（`%PDF-`、ZIP `PK`），扩展名与内容不符报 `material-format-invalid`；
- `prepareMaterial` 改为 async：文本仍走 UTF-8 校验与 512KB；epub/pdf 跳过 UTF-8/NUL 检查，源文件上限 18MB，保留原始 buffer 计算 hash/bytes；
- 上传路由 `maxBytes` 从 1MB 提到 **28MB**（18MB base64 ≈ 24MB + JSON 余量），文本仍受 prepare 的 512KB 约束；边界测试覆盖刚超过 18MB；
- `importMaterial` 改为 async，解析在打开 SQLite 前完成；SELECT/写入仍同事务；
- `format` 存 `txt/md/epub/pdf`，`content` 存抽取文本，`origin` 存受管副本相对路径，`bytes/hash` 针对原文件；
- 检索索引用抽取文本，验收“导入后可被检索命中”；重复 hash 命中时若受管副本缺失，用本次 buffer 重建副本再返回 duplicate，避免永久缺原文件；
- 错误码：`material-format-invalid`（扩展名/魔数不符）、`material-encrypted`（加密 spine）、`material-parse-failed`（损坏）、`material-extract-empty`（无文本层）、`material-extract-too-large`（大小/安全上限）、`material-origin-missing`/`material-origin-corrupt`（导出原文件）。

### 导出消费者

- materials 循环在 **`exportWork`**（`exportWorkAtomic` 也委托到它）：txt/md 仍写 `content`；epub/pdf 从 `origin` 解析到 `.storycraft/materials` 下复制原文件到 `materials/<id>.<format>`，不把抽取文本写成伪 epub/pdf；
- 复制前校验 hash；受管副本缺失报 `material-origin-missing`，不生成坏文件；导出仍原子替换，文件清单包含二进制副本；
- 备份目前只包含作品库、不含 `.storycraft/materials`；B1 不扩展备份格式，README/Note 明示“备份不携带原二进制，恢复后可检索抽取文本但导出原文件会报缺失”，后续另立附件备份工作项。

### 面板

- 文件选择器 `accept=".txt,.md,.epub,.pdf"`；
- `MaterialMetadata` 增加 `sourceName`（`origin` 的文件名部分），素材行显示原格式与来源名；不改 DB schema；
- 失败时展示错误消息；不上传 URL，不做拖拽之外的额外交互。

## Alternatives considered

**A. 自写 PDF 解析。** 最强理由是不加依赖。否决原因：PDF 字体/压缩/交叉引用复杂，参考已用 unpdf；自写会引入不可控质量风险。

**B. 只把 PDF 转成纯文本文件，不保留原文件。** 最强理由是简单。否决原因：B1 要求保留来源；导出应能取回原 PDF/EPUB。

**C. 支持 OCR。** 最强理由是扫描版 PDF。否决原因：需要图像/OCR 运行时与额度，超出 B1；明确报错，不静默空入库。

**D. 用 EPUB 只抽全文、不分章。** 最强理由是简单。否决原因：spine 顺序与章节标题是 EPUB 的可用结构；参考已按 spine 抽。

## Testing

- `tests/material-formats.test.mjs`：PDF/EPUB 入库、EPUB 检索命中、字体混淆允许、加密 spine/魔数/空文本/损坏拒绝、18MB/2M/spine501 安全上限、重复修复、导出原文件与缺失错误。
- `e2e/material-formats.spec.cjs`：面板上传 PDF/EPUB、格式与来源显示、清理。
- `tests/material.test.mjs`：文本素材 512KB/UTF-8/hash/重复/导出回归。
- `node scripts/ci.mjs --smoke`：tarball 安装加载含 pdfjs chunk 的 build。
- 完整 CI：91 单元 + 45 E2E。

## Consequences

- `unpdf`/`jszip` 内联会增大 `lib/`；spike 先验证默认 E2E，不通过就停；
- PDF 文本顺序/换行受原文件影响；只保证可检索，不承诺排版；
- 扫描版/加密 spine 被拒绝，不做 OCR；字体混淆的 EPUB 不应被误拒；
- EPUB HTML 结构差异大；以 spine 文本为准，不保留 CSS/图片；
- 18MB 源文件与 2M 抽取字符均在内存解析；超限明确拒绝；
- 备份不含 `.storycraft/materials` 原文件；恢复后检索仍可用，但导出会报 `material-origin-missing`，附件备份另立工作项。
