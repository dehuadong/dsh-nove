/** Extract readable text from uploaded EPUB and PDF buffers. */

import JSZip from 'jszip'
import { extractText, getDocumentProxy } from 'unpdf'
import { StoryError } from './domain.ts'

export const MATERIAL_EXTRACT_MAX_CHARS = 2_000_000
export const MATERIAL_EPUB_MAX_SPINE = 500
export const MATERIAL_EPUB_MAX_ENTRY_BYTES = 8 * 1024 * 1024

function normalizeText(text: string): string {
  return text.replace(/\u0000/gu, '').replace(/\r\n?/gu, '\n').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, number) => String.fromCodePoint(Number(number)))
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'iu').exec(attrs)?.[1]
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.?\//u, '')
}

function htmlText(html: string): string {
  return normalizeText(decodeXml(html
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article)>/giu, '\n')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')))
}

function tooLarge(what: string): never {
  throw new StoryError('material-extract-too-large', `${what}超过 ${MATERIAL_EXTRACT_MAX_CHARS} 字符：请拆分后再导入`)
}

/** Extract EPUB text in spine order. */
export async function extractEpub(buffer: Buffer): Promise<{ title?: string, text: string }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new StoryError('material-parse-failed', 'EPUB 不是可读的 ZIP 文件')
  }
  try {
    const container = await zip.file('META-INF/container.xml')?.async('string')
    if (container === undefined) throw new StoryError('material-parse-failed', 'EPUB 缺少 META-INF/container.xml')
    const opfPath = normalizePath(attr(/<rootfile\b([^>]+)>/iu.exec(container)?.[1] ?? '', 'full-path') ?? '')
    if (opfPath === '') throw new StoryError('material-parse-failed', 'EPUB container.xml 没有 OPF 路径')
    const opf = await zip.file(opfPath)?.async('string')
    if (opf === undefined) throw new StoryError('material-parse-failed', `EPUB 找不到 OPF：${opfPath}`)
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    const manifest = new Map<string, string>()
    for (const match of opf.matchAll(/<item\b([^>]+)>/giu)) {
      const id = attr(match[1] ?? '', 'id')
      const href = attr(match[1] ?? '', 'href')
      if (id !== undefined && href !== undefined) manifest.set(id, decodeXml(href))
    }
    const spineBlock = /<spine\b[\s\S]*?<\/spine>/iu.exec(opf)?.[0] ?? ''
    const spine = [...spineBlock.matchAll(/<itemref\b([^>]+)>/giu)]
      .map(match => attr(match[1] ?? '', 'idref'))
      .filter((id): id is string => id !== undefined)
    if (spine.length === 0) throw new StoryError('material-parse-failed', 'EPUB spine 没有可读章节')
    if (spine.length > MATERIAL_EPUB_MAX_SPINE) throw new StoryError('material-extract-too-large', `EPUB spine 超过 ${MATERIAL_EPUB_MAX_SPINE} 章`)
    const encrypted = new Set<string>()
    const encryption = await zip.file('META-INF/encryption.xml')?.async('string')
    for (const match of encryption?.matchAll(/<(?:[\w.-]+:)?CipherReference\b([^>]+)>/giu) ?? []) {
      const uri = attr(match[1] ?? '', 'URI')
      if (uri !== undefined) encrypted.add(normalizePath(decodeXml(uri)))
    }
    const parts: string[] = []
    let chars = 0
    for (const idref of spine) {
      const href = manifest.get(idref)
      if (href === undefined) continue
      const path = normalizePath(base + href)
      if (encrypted.has(path)) throw new StoryError('material-encrypted', `EPUB 章节已加密：${path}`)
      const entry = zip.file(path)
      if (entry === null || entry === undefined) continue
      const size = Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize)
      if (!Number.isFinite(size)) throw new StoryError('material-extract-too-large', `无法读取 EPUB 章节解压大小：${path}`)
      if (size > MATERIAL_EPUB_MAX_ENTRY_BYTES) {
        throw new StoryError('material-extract-too-large', `EPUB 章节解压后超过 ${MATERIAL_EPUB_MAX_ENTRY_BYTES} 字节：${path}`)
      }
      const text = htmlText(await entry.async('string'))
      if (text === '') continue
      chars += [...text].length
      if (chars > MATERIAL_EXTRACT_MAX_CHARS) tooLarge('EPUB 抽取文本')
      parts.push(text)
    }
    if (parts.length === 0) throw new StoryError('material-extract-empty', 'EPUB 没有可读文本')
    return {
      title: decodeXml(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/iu.exec(opf)?.[1] ?? '').trim() || undefined,
      text: normalizeText(parts.join('\n\n')),
    }
  } catch (error) {
    if (error instanceof StoryError) throw error
    throw new StoryError('material-parse-failed', `EPUB 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Extract the PDF text layer; scanned PDFs have no text and are rejected. */
export async function extractPdf(buffer: Buffer): Promise<{ text: string }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const extracted = await extractText(pdf, { mergePages: true })
    const text = normalizeText(String(extracted.text ?? ''))
    if (text === '') throw new StoryError('material-extract-empty', 'PDF 没有文本层；扫描版需要 OCR，当前不支持')
    if ([...text].length > MATERIAL_EXTRACT_MAX_CHARS) tooLarge('PDF 抽取文本')
    return { text }
  } catch (error) {
    if (error instanceof StoryError) throw error
    throw new StoryError('material-parse-failed', `PDF 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
