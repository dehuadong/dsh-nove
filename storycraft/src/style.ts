/**
 * Deterministic style sampling from current chapter bodies.
 * Pure: no database, no model, no clock.
 */

export const STYLE_START = '<!-- storycraft:style-samples:start -->'
export const STYLE_END = '<!-- storycraft:style-samples:end -->'

import { SENTENCE_BREAK } from './critique.js'

const DIALOGUE = /[“”"「」『』]/u
const PUNCTUATION = /[。，、；：！？…]/gu
const MIN_SAMPLE = 120
const MAX_SAMPLE = 240

function normalize(body: unknown): string {
  return String(body ?? '').replace(/\r\n?/gu, '\n')
}

function chaptersOf(bodies: any): any {
  return bodies.map((item: any) => ({
    number: Number(item.number),
    paragraphs: normalize(item.body).split(/\n\s*\n/u).map((part: any) => part.trim()).filter((part: any) => part !== ''),
    text: normalize(item.body),
  }))
}

function median(values: any): any {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left: any, right: any) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

function round1(value: any): any {
  return Math.round(value * 10) / 10
}

/** Consecutive-paragraph windows of 120–240 code points, never crossing a chapter. */
function windowsOf(chapter: any): any {
  const paragraphs = chapter.paragraphs
  const windows: any[] = []
  let index = 0
  let previousEnd = -1
  while (index < paragraphs.length) {
    let end = index
    let text = paragraphs[index]
    while ([...text].length < MIN_SAMPLE && end + 1 < paragraphs.length) {
      end += 1
      text += `\n\n${paragraphs[end]}`
    }
    const length = [...text].length
    if (length >= MIN_SAMPLE && length <= MAX_SAMPLE) {
      windows.push({ chapter: chapter.number, index, text, length })
      previousEnd = end
      index = end + 1
    } else if (length > MAX_SAMPLE) {
      previousEnd = -1
      index += 1
    } else {
      const joined = windows.length === 0 ? Infinity : windows.at(-1)!.length + 2 + length
      if (previousEnd === index - 1 && joined <= MAX_SAMPLE) {
        windows.at(-1)!.text += `\n\n${text}`
        windows.at(-1)!.length = joined
      }
      break
    }
  }
  return windows
}

/** Metrics and up to three stable samples from current chapter bodies. */
export interface StyleSample { chapter: number, text: string }
export interface StyleMetrics { sentences: number, paragraphs: number, avgSentence: number, medianSentence: number, stdSentence: number, dialogueRatio: number, punctuation: Record<string, number> }
export interface StyleProfile { metrics: StyleMetrics, samples: StyleSample[], sampleChars: number }

export function styleProfile(bodies: Array<{ number: number, body: string }>): StyleProfile {
  const chapters = chaptersOf(bodies)
  const text = chapters.map((chapter: any) => chapter.text).join('\n\n')
  const sentences = text.split(SENTENCE_BREAK).map((sentence: string) => sentence.replace(/\s+/gu, ' ').trim()).filter((sentence: string) => sentence !== '')
  const lengths = sentences.map((sentence: string) => [...sentence].length)
  const average = lengths.length === 0 ? 0 : lengths.reduce((sum: number, value: number) => sum + value, 0) / lengths.length
  const standard = lengths.length === 0
    ? 0
    : Math.sqrt(lengths.reduce((sum: number, value: number) => sum + ((value - average) ** 2), 0) / lengths.length)
  const paragraphs = chapters.flatMap((chapter: any) => chapter.paragraphs)
  const dialogue = paragraphs.filter((paragraph: string) => DIALOGUE.test(paragraph)).length
  const punctuation: Record<string, number> = {}
  for (const mark of text.match(PUNCTUATION) ?? []) punctuation[mark] = (punctuation[mark] ?? 0) + 1

  const candidates = chapters.flatMap(windowsOf)
  const middle = median(candidates.map((item: any) => item.length))
  const ranked = candidates
    .filter((item: any, index: number, all: any[]) => all.findIndex((other: any) => other.text === item.text) === index)
    .sort((left: any, right: any) => Math.abs(left.length - middle) - Math.abs(right.length - middle)
      || left.chapter - right.chapter || left.index - right.index)
  const chosen = []
  const usedChapters = new Set()
  for (const item of ranked) {
    if (chosen.length >= 3) break
    if (usedChapters.has(item.chapter)) continue
    chosen.push(item)
    usedChapters.add(item.chapter)
  }
  for (const item of ranked) {
    if (chosen.length >= 3) break
    if (!chosen.includes(item)) chosen.push(item)
  }
  const samples = chosen.slice(0, 3).map((item: any) => ({ chapter: item.chapter, text: item.text }))

  return {
    metrics: {
      sentences: sentences.length,
      avgSentence: round1(average),
      medianSentence: round1(median(lengths)),
      stdSentence: round1(standard),
      paragraphs: paragraphs.length,
      dialogueRatio: paragraphs.length === 0 ? 0 : Math.round((dialogue / paragraphs.length) * 100) / 100,
      punctuation,
    },
    samples,
    sampleChars: samples.reduce((sum, sample) => sum + [...sample.text].length, 0),
  }
}

/** Remove every managed block, including an unclosed start marker. */
export function stripBlock(content: string): string {
  let value = normalize(content)
  value = value.replace(new RegExp(`${escape(STYLE_START)}[\\s\\S]*?${escape(STYLE_END)}`, 'gu'), '')
  value = value.replace(new RegExp(`${escape(STYLE_START)}[\\s\\S]*$`, 'u'), '')
  value = value.replaceAll(STYLE_END, '')
  return value.replace(/\n{3,}/gu, '\n\n').trimEnd()
}

function escape(value: any): any {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** The managed block text for one profile. */
export function styleBlock(metrics: StyleMetrics, samples: StyleSample[]): string {
  const lines = [
    STYLE_START,
    '## 文风样例（自动抽取）',
    `指标：句数 ${metrics.sentences} · 平均句长 ${metrics.avgSentence} · 中位 ${metrics.medianSentence} · 标准差 ${metrics.stdSentence} · 对话段 ${Math.round(metrics.dialogueRatio * 100)}%`,
  ]
  samples.forEach((sample: any, index: number) => {
    lines.push(`### 样例 ${index + 1}（第 ${sample.chapter} 章）`, sample.text)
  })
  lines.push(STYLE_END)
  return lines.join('\n')
}

/** Replace any old managed block and append exactly one block at the end. */
export function mergeBlock(content: string, block: string): string {
  const base = stripBlock(content)
  return base === '' ? `${block}\n` : `${base}\n\n${block}\n`
}
