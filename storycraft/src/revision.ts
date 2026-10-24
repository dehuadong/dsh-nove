/**
 * Shared revision constraints used by both the landing path and the delegated
 * submission path. Keeping the mode checks here prevents `story_submit` from
 * drifting away from `reviseChapter`.
 */

import { StoryError, countWords } from './domain.js'
import { critique } from './critique.js'

/**
 * Validate one revision against its mode.
 */
export interface RevisionInput { mode: string, chapter: number, oldBody: string, body: string }
export interface RevisionDelta { oldWords: number, newWords: number, delta: number }

export function assertRevisionMode(input: RevisionInput): RevisionDelta {
  const mode = String(input.mode)
  const body = String(input.body ?? '')
  if (!['patch', 'polish', 'rewrite', 'deslop'].includes(mode)) {
    throw new StoryError('revise-mode-violation', `未知修订模式：${mode}`)
  }
  const oldWords = countWords(String(input.oldBody ?? ''))
  const newWords = countWords(body)
  const delta = oldWords === 0 ? 1 : Math.abs(newWords - oldWords) / oldWords
  if (mode === 'patch' && delta > 0.2) {
    throw new StoryError('revise-mode-violation',
      `局部修补的字数变化 ${(delta * 100).toFixed(0)}% 超过 20%：改用 polish 或 rewrite`)
  }
  if (mode === 'polish' && delta > 0.4) {
    throw new StoryError('revise-mode-violation',
      `润色的字数变化 ${(delta * 100).toFixed(0)}% 超过 40%：改用 rewrite`)
  }
  if (mode === 'deslop') {
    const before = critique(String(input.oldBody ?? '')).aiPhrases.count
    const after = critique(body).aiPhrases.count
    if (before > 0 && after >= before) {
      throw new StoryError('revise-mode-violation',
        `去 AI 味修订没有减少命中的腔调词（${before} → ${after}）`)
    }
  }
  return { oldWords, newWords, delta }
}
