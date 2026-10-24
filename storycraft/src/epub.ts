/**
 * Minimal deterministic EPUB 3 builder.
 *
 * Pure: callers pass a chapter snapshot and get a ZIP buffer. The module owns
 * XML escaping, OPF/nav generation and a small stored/deflate ZIP writer; it
 * never touches the filesystem or SQLite.
 */

import { deflateRawSync } from 'node:zlib'

const UTF8_FLAG = 0x0800
const STORED = 0
const DEFLATED = 8
const MODIFIED = '2000-01-01T00:00:00Z'

type Chapter = { number: number, title: string, body: string }
type ZipEntry = { name: string, data: Buffer, method: number }

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[index] = value >>> 0
}

/** CRC32 of one buffer. */
function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Collapse a title to one trimmed line. */
function oneLine(value: unknown): string {
  return String(value ?? '').replace(/\r\n?|\n/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** XML/HTML escape one text value. */
function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Normalize a body to LF and strip trailing newlines. */
function normalizeBody(value: unknown): string {
  return String(value ?? '').replace(/\r\n?|\n/gu, '\n').replace(/\n+$/u, '')
}

/** One paragraph block as XHTML, preserving single line breaks. */
function paragraphBlock(text: string): string {
  const paragraph = text.split('\n').map(line => escapeXml(line)).join('<br/>')
  return `<p>${paragraph}</p>`
}

/** XHTML document shell. */
function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="UTF-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`
}

/** Build one chapter XHTML. */
function chapterXhtml(chapter: Chapter): string {
  const heading = oneLine(chapter.title)
  const label = `第 ${chapter.number} 章${heading === '' ? '' : ` ${heading}`}`
  const blocks = normalizeBody(chapter.body)
    .split(/\n\s*\n/gu)
    .map(block => block.trim())
    .filter(block => block !== '')
    .map(paragraphBlock)
    .join('\n')
  return xhtml(label, `<h1>${escapeXml(label)}</h1>\n${blocks}`)
}

/** Build the fixed title page. */
function titleXhtml(title: string): string {
  return xhtml(title, `<h1>${escapeXml(title)}</h1>`)
}

/** Build the EPUB3 navigation document. */
function navXhtml(title: string, chapters: Chapter[]): string {
  const items = [
    `<li><a href="title.xhtml">${escapeXml(title)}</a></li>`,
    ...chapters.map(chapter => {
      const heading = oneLine(chapter.title)
      const label = `第 ${chapter.number} 章${heading === '' ? '' : ` ${heading}`}`
      return `<li><a href="ch-${String(chapter.number).padStart(4, '0')}.xhtml">${escapeXml(label)}</a></li>`
    }),
  ].join('\n')
  return xhtml('目录', `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>\n${items}\n</ol></nav>`)
}

/** Build the OPF package document. */
function opf(title: string, identifier: string, chapters: Chapter[]): string {
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map(chapter => `<item id="ch${chapter.number}" href="ch-${String(chapter.number).padStart(4, '0')}.xhtml" media-type="application/xhtml+xml"/>`),
  ].join('\n    ')
  const spine = [
    '<itemref idref="title"/>',
    ...chapters.map(chapter => `<itemref idref="ch${chapter.number}"/>`),
  ].join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${MODIFIED}</meta>
  </metadata>
  <manifest>
    ${items}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>
`
}

/** Build the central directory and EOCD. */
function zipArchive(entries: ZipEntry[]): Buffer {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const body = entry.method === DEFLATED ? deflateRawSync(entry.data, { level: 6 }) : entry.data
    const checksum = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_FLAG, 6)
    local.writeUInt16LE(entry.method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    const localRecord = Buffer.concat([local, nameBytes, body])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8_FLAG, 8)
    central.writeUInt16LE(entry.method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(localRecord)
    centrals.push(Buffer.concat([central, nameBytes]))
    offset += localRecord.length
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

/**
 * Build one EPUB 3 file.
 */
export function buildEpub(input: { title: string, identifier: string, chapters: Chapter[] }): Buffer {
  const title = oneLine(input.title) || '未命名'
  const chapters = [...(input.chapters ?? [])].sort((left, right) => left.number - right.number)
  const entries = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8'), method: STORED },
    { name: 'META-INF/container.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`, 'utf8'), method: DEFLATED },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf(title, input.identifier, chapters), 'utf8'), method: DEFLATED },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(navXhtml(title, chapters), 'utf8'), method: DEFLATED },
    { name: 'OEBPS/style.css', data: Buffer.from('body{font-family:serif;line-height:1.7;margin:1.2em}h1{font-size:1.4em}p{margin:0 0 .9em}\n', 'utf8'), method: DEFLATED },
    { name: 'OEBPS/title.xhtml', data: Buffer.from(titleXhtml(title), 'utf8'), method: DEFLATED },
    ...chapters.map(chapter => ({
      name: `OEBPS/ch-${String(chapter.number).padStart(4, '0')}.xhtml`,
      data: Buffer.from(chapterXhtml(chapter), 'utf8'),
      method: DEFLATED,
    })),
  ]
  return zipArchive(entries)
}
