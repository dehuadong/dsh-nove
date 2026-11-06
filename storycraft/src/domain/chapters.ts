import { createHash } from 'node:crypto'

import {
  StoryError,
} from './core.ts'

export function contentVersion(text: unknown): string {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12)
}

export function chapterStem(number: number | string): string {
  return `ch-${String(number).padStart(4, '0')}`
}

export function sourceIdOf(workId: string, source: string): string {
  const prefix = `works/${workId}/`
  const trimmed = source.startsWith(prefix) ? source.slice(prefix.length) : source
  return trimmed.replace(/\/+$/u, '')
}

export function chapterNumber(value: unknown): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new StoryError('invalid-chapter', `章号必须是正整数，收到：${String(value)}`)
  }
  return number
}

export function countWords(text: unknown): number {
  const cjk = String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latin = String(text).match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0
  return cjk + latin
}

/** Remove Markdown metadata/fences/headings so a length count measures prose. */
export function stripMarkdownMetadata(text: unknown): string {
  const lines = String(text ?? '').replace(/\r\n/gu, '\n').replace(/^\uFEFF/u, '').split('\n')
  const prose: string[] = []
  let index = 0
  if (lines[index]?.trim() === '---') {
    index += 1
    while (index < lines.length && lines[index]?.trim() !== '---') index += 1
    if (index < lines.length) index += 1
  }
  let inFence = false
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (/^(```|~~~)/u.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s+/u.test(trimmed)) continue
    if (trimmed === '---' || trimmed === '...') continue
    prose.push(line)
  }
  return prose.join('\n')
}

/** Chapter length in the zh_chars mode: non-whitespace prose characters. */
export function countChapterLength(text: unknown): number {
  return stripMarkdownMetadata(text).replace(/\s+/gu, '').length
}
