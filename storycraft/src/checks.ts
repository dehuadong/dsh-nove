/**
 * Deterministic chapter checks: facts a program can judge, never taste.
 *
 * Each finding names a stable code so the review prompt can ask the model not to
 * repeat what the machine already found, and so receipts can be compared across
 * runs. Severity uses the same three levels as review items.
 */

export type CheckSeverity = 'blocking' | 'major' | 'minor'

export interface Finding {
  readonly code: ChapterCheckCode
  readonly severity: CheckSeverity
  readonly detail: string
  /** Exact excerpt the finding points at, when there is one. */
  readonly quote?: string
}

export type ChapterCheckCode =
  | 'word-range'
  | 'repeated-sentence'
  | 'ai-phrase'
  | 'person-consistency'
  | 'dialogue-ratio'

export interface CheckInput {
  readonly text: string
  readonly wordRange?: { readonly min?: number; readonly max?: number } | null
  readonly perspective?: string
}

const AI_PHRASES = ['值得注意的是', '综上所述', '不可否认', '不难看出', '空气仿佛凝固', '心中不禁']

/** Characters that count toward the length target: non-space only. */
function countChars(text: string): number {
  return text.replace(/\s/gu, '').length
}

/** Split into sentences on the punctuation this project writes. */
function sentences(text: string): string[] {
  return text
    .split(/[。！？\n]+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 8)
}

/**
 * Run every registered check.
 * @param input - chapter text plus the plan fields the checks need.
 * @returns findings in registration order; an empty array means nothing mechanical failed.
 */
export function checkChapter(input: CheckInput): Finding[] {
  const findings: Finding[] = []
  const text = input.text ?? ''

  const words = countChars(text)
  const min = input.wordRange?.min
  const max = input.wordRange?.max
  if (min !== undefined && words < min) {
    findings.push({ code: 'word-range', severity: 'major', detail: `${words} 字，低于下限 ${min}` })
  }
  if (max !== undefined && words > max) {
    findings.push({ code: 'word-range', severity: 'major', detail: `${words} 字，超过上限 ${max}` })
  }

  const seen = new Map<string, number>()
  for (const sentence of sentences(text)) {
    seen.set(sentence, (seen.get(sentence) ?? 0) + 1)
  }
  for (const [sentence, count] of seen) {
    if (count > 1) findings.push({ code: 'repeated-sentence', severity: 'minor', detail: `同一句出现 ${count} 次`, quote: sentence })
  }

  for (const phrase of AI_PHRASES) {
    if (text.includes(phrase)) findings.push({ code: 'ai-phrase', severity: 'minor', detail: `套话命中：${phrase}`, quote: phrase })
  }

  const perspective = input.perspective?.trim() ?? ''
  if (perspective !== '' && !text.includes(perspective)) {
    findings.push({ code: 'person-consistency', severity: 'major', detail: `章纲视角人物「${perspective}」在正文里没有出现` })
  }

  const quoted = [...text.matchAll(/[“"]([^”"]*)[”"]/gu)].reduce((sum, match) => sum + match[1].length, 0)
  if (words > 0) {
    const ratio = quoted / words
    if (ratio < 0.05 || ratio > 0.7) {
      findings.push({ code: 'dialogue-ratio', severity: 'minor', detail: `对话占比 ${Math.round(ratio * 100)}%` })
    }
  }

  return findings
}
