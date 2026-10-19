/**
 * Deterministic prose metrics: length, sentences, repetition, AI-flavoured
 * phrases, dialogue share.
 *
 * Pure and time-free: the same text always scores the same, so the numbers can be
 * compared across revisions. Nothing here edits prose.
 */

/** Phrases that tend to mark machine-written Chinese prose. */
const AI_PHRASES = [
  '不禁',
  '仿佛',
  '空气仿佛凝固',
  '心中五味杂陈',
  '如同一场梦',
  '在这个瞬间',
  '与此同时',
  '无声地诉说',
  '不易察觉',
  '缓缓地',
  '微微',
  '轻轻地',
  '深深地',
  '不由自主',
  '若有所思',
  '意味深长',
  '难以言喻',
  '不知为何',
  '毫无疑问',
  '一时间',
]

const SENTENCE_BREAK = /[。！？…；\n]+/u
const DIALOGUE_MARKS = /[「」『』“”"]/u

/** Characters used for equality in repetition checks (letters and digits only). */
function normalizeSentence(sentence) {
  return sentence.replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Score one body of text.
 * @param {string} text - chapter body.
 * @param {{min?: number, max?: number}|undefined} wordRange - the work's own range, if any.
 * @returns {object} metrics.
 */
import { countWords } from './storage.js'

export function critique(text, wordRange) {
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
  const aiPhrases = { count: 0, hits: [] }
  for (const phrase of AI_PHRASES) {
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
      wordRange: { min, max },
      withinRange: words >= min && words <= max,
      ...(words < min ? { shortBy: min - words } : {}),
      ...(words > max ? { longBy: words - max } : {}),
    } : {}),
  }
}
