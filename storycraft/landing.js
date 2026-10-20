/**
 * Landing-time validation shared by the action layer and host-side delegation.
 *
 * This module owns the IO needed by `checkDraft` (the fact whitelist) so
 * `consistency.js` can stay a pure comparator. It does not write anything.
 */

import { StoryError } from './domain.js'
import { deriveWhitelist } from './facts.js'
import { checkConsistency } from './consistency.js'

/**
 * Validate a draft against the work's landed whitelist.
 *
 * Names block a write; places and measurements only warn, so a false positive
 * cannot reject good prose.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number, body: string}} draft - the body about to land.
 * @returns {Promise<{warnings: string[]}>} warnings that do not block.
 */
export async function checkDraft(root, draft) {
  const whitelist = await deriveWhitelist(root, { work: draft.work, chapter: draft.chapter })
  const consistency = checkConsistency({ body: draft.body, whitelist })
  if (consistency.unknownNames.length > 0) {
    throw new StoryError('consistency-violation',
      `正文出现上下文里没有的人名：${consistency.unknownNames.join('、')}。改写后再落盘`)
  }
  return { warnings: consistency.warnings }
}
