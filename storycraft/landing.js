/**
 * Landing-time validation shared by the action layer and host-side delegation.
 *
 * This module owns the IO needed by `checkDraft` (the fact whitelist) so
 * `consistency.js` can stay a pure comparator. It does not write anything.
 */

import { StoryError, countWords } from './domain.js'
import { deriveWhitelist } from './facts.js'
import { checkConsistency } from './consistency.js'

/**
 * Validate a draft against the work's landed whitelist.
 *
 * Names, places and measurements only warn, so a false positive
 * cannot reject good prose.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number, body: string}} draft - the body about to land.
 * @returns {Promise<{warnings: string[]}>} warnings that do not block.
 */
export async function checkDraft(root, draft) {
  const whitelist = await deriveWhitelist(root, { work: draft.work, chapter: draft.chapter })
  const consistency = checkConsistency({ body: draft.body, whitelist })
  const warnings = [...consistency.warnings]
  if (consistency.unknownNames.length > 0) {
    warnings.push(`正文出现未登记人名：${consistency.unknownNames.join('、')}；确认是否补人物卡（不阻断落盘）`)
  }
  return { warnings }
}

/**
 * Check one delegated body against the work's word range.
 *
 * The manual write path keeps word count advisory; only host-side delegation
 * blocks out-of-range drafts. Both writer and reviser check min and max; the
 * delegated reviser cannot change the mode bound in its submission entry.
 * @param {{role: 'writer'|'reviser', mode?: string, body: string, chapter: number, wordRange?: {min: number, max: number}}} input - range input.
 * @returns {{warnings: string[]}} non-blocking warnings.
 */
export function checkWordRange(input) {
  const range = input.wordRange
  if (range === undefined) return { warnings: [] }
  const words = countWords(String(input.body ?? ''))
  const chapter = Number(input.chapter)
  if (input.role === 'reviser') {
    if (words > range.max) {
      const action = input.mode === 'deslop'
        ? 'deslop 仍超限：修正到范围内，不要改 mode'
        : '修正到范围内，不要改 mode'
      throw new StoryError('delegation-word-range',
        `第 ${chapter} 章修订稿 ${words} 字，超过上限 ${range.max} 字：${action}`)
    }
    if (words < range.min) {
      throw new StoryError('delegation-word-range',
        `第 ${chapter} 章修订稿 ${words} 字，低于下限 ${range.min} 字：必须完整成章后再提交`)
    }
    return { warnings: [] }
  }
  if (words < range.min || words > range.max) {
    throw new StoryError('delegation-word-range',
      `第 ${chapter} 章正文 ${words} 字，不在 ${range.min}–${range.max} 字范围：先调整章纲或目标再委派`)
  }
  return { warnings: [] }
}
