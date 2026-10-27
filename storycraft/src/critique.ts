/**
 * Deterministic prose metrics: length, sentences, repetition, AI-flavoured
 * phrases, dialogue share.
 *
 * Pure and time-free: the same text always scores the same, so the numbers can be
 * compared across revisions. Nothing here edits prose.
 */

import { countWords } from './domain.ts'
import { MACHINE_PHRASES } from './phrases.ts'

export const SENTENCE_BREAK = /[。！？…；\n]+/u
const DIALOGUE_MARKS = /[「」『』“”"]/u

/** Characters used for equality in repetition checks (letters and digits only). */
function normalizeSentence(sentence: string): string {
  return sentence.replace(/[^\p{L}\p{N}]/gu, '')
}

export interface CritiqueMetrics {
  words: number
  chars: number
  sentences: { count: number, averageLength: number, longest: number }
  repeated: Array<{ text: string, count: number }>
  aiPhrases: { count: number, hits: Array<{ phrase: string, count: number }> }
  dialogueRatio: number
  wordRange?: { min: number, max: number }
  withinRange?: boolean
  shortBy?: number
  longBy?: number
}

export type FindingSeverity = 'blocking' | 'major' | 'minor'

export type FindingCode = 'word-range' | 'repeated-sentence' | 'ai-phrase' | 'person-consistency' | 'dialogue-ratio'

export interface Finding {
  readonly code: FindingCode
  readonly severity: FindingSeverity
  readonly detail: string
  /** Exact excerpts this finding points at; empty when it points at the whole chapter. */
  readonly refs: string[]
  readonly quote?: string
}

/**
 * Turn the metrics into findings a program can defend.
 *
 * Stable codes let the review prompt skip what the machine already reported.
 */
function finding(code: FindingCode, severity: FindingSeverity, detail: string, quote?: string): Finding {
  return { code, severity, detail, refs: quote === undefined ? [] : [quote], ...(quote === undefined ? {} : { quote }) }
}

export function findingsOf(text: string, metrics: CritiqueMetrics, perspective?: string): Finding[] {
  const findings: Finding[] = []
  if (metrics.withinRange === false && (metrics.shortBy ?? 0) > 0) {
    findings.push(finding('word-range', 'major', `${metrics.words} 字，比下限少 ${metrics.shortBy} 字`))
  }
  if (metrics.withinRange === false && (metrics.longBy ?? 0) > 0) {
    findings.push(finding('word-range', 'major', `${metrics.words} 字，比上限多 ${metrics.longBy} 字`))
  }
  for (const entry of metrics.repeated) {
    findings.push(finding('repeated-sentence', 'minor', `同一句出现 ${entry.count} 次`, entry.text))
  }
  for (const hit of metrics.aiPhrases.hits) {
    findings.push(finding('ai-phrase', 'minor', `套话命中 ${hit.count} 次`, hit.phrase))
  }
  const person = perspective?.trim() ?? ''
  if (person !== '' && !text.includes(person)) {
    findings.push(finding('person-consistency', 'major', `章纲视角人物「${person}」在正文里没有出现`))
  }
  if (metrics.words > 0 && (metrics.dialogueRatio < 0.05 || metrics.dialogueRatio > 0.7)) {
    findings.push(finding('dialogue-ratio', 'minor', `对话占比 ${Math.round(metrics.dialogueRatio * 100)}%`))
  }
  return findings
}

/**
 * Score one body of text.
 */
export function critique(text: unknown, wordRange?: { min?: number, max?: number }): CritiqueMetrics {
  const body = String(text ?? '')
  // One counting rule for the whole plugin: the same number story_write records.
  const words = countWords(body)
  const chars = [...body.replace(/\s/gu, '')].length

  const sentences = body
    .split(SENTENCE_BREAK)
    .map(sentence => sentence.replace(/\s+/gu, ' ').trim())
    .filter(sentence => sentence !== '')
  const lengths = sentences.map(sentence => [...sentence].length)
  const average = lengths.length === 0 ? 0 : Math.round((lengths.reduce((sum, value) => sum + value, 0) / lengths.length) * 10) / 10

  const seen = new Map()
  for (const sentence of sentences) {
    const key = normalizeSentence(sentence)
    if ([...key].length < 12) continue
    const entry = seen.get(key) ?? { text: sentence, count: 0 }
    entry.count += 1
    seen.set(key, entry)
  }
  const repeated = [...seen.values()]
    .filter(entry => entry.count >= 2)
    .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text))

  const lowered = body.toLowerCase()
  const aiPhrases: { count: number, hits: Array<{ phrase: string, count: number }> } = { count: 0, hits: [] }
  for (const phrase of MACHINE_PHRASES) {
    let index = lowered.indexOf(phrase)
    let count = 0
    while (index !== -1) {
      count += 1
      index = lowered.indexOf(phrase, index + phrase.length)
    }
    if (count === 0) continue
    aiPhrases.count += count
    aiPhrases.hits.push({ phrase, count })
  }
  aiPhrases.hits.sort((left, right) => right.count - left.count || left.phrase.localeCompare(right.phrase))

  const lines = body.split(/\r?\n/).filter(line => line.trim() !== '')
  const dialogueLines = lines.filter(line => DIALOGUE_MARKS.test(line)).length
  const dialogueRatio = lines.length === 0 ? 0 : Math.round((dialogueLines / lines.length) * 100) / 100

  const min = wordRange?.min
  const max = wordRange?.max
  const hasRange = Number.isInteger(min) && Number.isInteger(max)
  const minValue = min as number
  const maxValue = max as number
  return {
    words,
    chars,
    sentences: {
      count: sentences.length,
      averageLength: average,
      longest: lengths.length === 0 ? 0 : Math.max(...lengths),
    },
    repeated,
    aiPhrases,
    dialogueRatio,
    ...(hasRange ? {
      wordRange: { min: minValue, max: maxValue },
      withinRange: words >= minValue && words <= maxValue,
      ...(words < minValue ? { shortBy: minValue - words } : {}),
      ...(words > maxValue ? { longBy: words - maxValue } : {}),
    } : {}),
  }
}
