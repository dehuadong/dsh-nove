/**
 * Material upload preparation.
 *
 * The browser sends bytes, not a workspace path. This module owns the file
 * policy (name, size, encoding, title, hash) and deliberately does not touch
 * SQLite or write the managed copy; the store owns the transaction.
 */

import { createHash } from 'node:crypto'
import { StoryError } from './domain.js'

/** Maximum accepted material size, in bytes. */
export const MATERIAL_MAX_BYTES = 512 * 1024

/** Maximum title length, in code points. */
export const MATERIAL_TITLE_MAX = 200

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu
const UNSAFE_NAME = /[\u0000-\u001f<>:"/\\|?*]/u

/** Count code points. */
function codePointLength(text) {
  return [...String(text)].length
}

/**
 * Take the last path segment of a browser-supplied name and make it safe.
 * @param {string} name - original file name.
 * @returns {string} safe file name including extension.
 */
export function safeMaterialName(name) {
  const raw = String(name ?? '')
  if (raw.includes('/') || raw.includes('\\')) {
    throw new StoryError('material-name-invalid', '素材文件名不能包含路径')
  }
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    throw new StoryError('material-name-invalid', '素材文件名无效')
  }
  if (UNSAFE_NAME.test(trimmed) || /[. ]$/u.test(trimmed) || WINDOWS_RESERVED.test(trimmed)) {
    throw new StoryError('material-name-invalid', `素材文件名不安全：${trimmed}`)
  }
  if (codePointLength(trimmed) > 120) {
    throw new StoryError('material-name-invalid', '素材文件名过长')
  }
  const ext = /\.([^.]+)$/u.exec(trimmed)?.[1]?.toLowerCase()
  if (ext !== 'txt' && ext !== 'md') {
    throw new StoryError('material-format-unsupported', '素材只支持 .txt / .md')
  }
  return trimmed
}

/**
 * Validate uploaded bytes and build the metadata used by the store.
 * @param {object} input - upload.
 * @param {string} input.name - browser file name.
 * @param {string} input.contentBase64 - base64 of the uploaded bytes.
 * @param {string} [input.title] - optional display title.
 * @returns {{content: string, buffer: Buffer, hash: string, bytes: number, format: string, title: string, fileName: string}} prepared data.
 */
export function prepareMaterial(input) {
  const fileName = safeMaterialName(input?.name)
  const encoded = String(input?.contentBase64 ?? '').replace(/\s+/gu, '')
  if (encoded === '') throw new StoryError('material-empty', '素材内容为空')
  if (encoded.startsWith('data:') || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
    throw new StoryError('material-encoding-invalid', '素材内容不是合法的 base64')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length === 0) throw new StoryError('material-empty', '素材内容为空')
  if (buffer.length > MATERIAL_MAX_BYTES) {
    throw new StoryError('material-too-large', `素材超过 ${MATERIAL_MAX_BYTES} 字节`)
  }
  if (buffer.includes(0)) throw new StoryError('material-encoding-invalid', '素材包含 NUL 字节')
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    throw new StoryError('material-encoding-invalid', '素材不能是 UTF-16')
  }
  let content
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    throw new StoryError('material-encoding-invalid', '素材必须是 UTF-8 文本')
  }
  if (content.trim() === '') throw new StoryError('material-empty', '素材内容为空')
  const hash = createHash('sha256').update(buffer).digest('hex')
  const format = fileName.toLowerCase().endsWith('.md') ? 'md' : 'txt'
  const defaultTitle = fileName.slice(0, -(format.length + 1))
  const title = String(input?.title ?? '').trim() || defaultTitle
  if (codePointLength(title) > MATERIAL_TITLE_MAX) {
    throw new StoryError('material-title-too-long', `素材标题不能超过 ${MATERIAL_TITLE_MAX} 字`)
  }
  return {
    content,
    buffer,
    hash,
    bytes: buffer.length,
    format,
    title,
    fileName,
  }
}

/**
 * Metadata shown to the panel/model boundary. Never includes content or origin.
 * @param {object} row - materials row.
 * @returns {object} public metadata.
 */
export function materialMetadata(row) {
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    bytes: row.bytes,
    hashPrefix: String(row.hash).slice(0, 12),
    createdAt: row.created_at,
  }
}
