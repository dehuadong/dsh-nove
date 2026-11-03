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
