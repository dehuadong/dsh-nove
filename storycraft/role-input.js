/**
 * Shared role input loader for `story_context` and host-side delegation.
 *
 * Both the manual dispatch path and `story_delegate` need the same chapter body,
 * latest review and assembled role context. Keeping that read here avoids two
 * implementations drifting apart; it is the only place that maps a missing
 * chapter body to the established `chapter-not-written` business code.
 */

import { StoryError, chapterNumber } from './domain.js'
import { latestReview, readChapter, readManifest } from './storage.js'
import { assembleRoleContext } from './context.js'

/**
 * Load the inputs one role needs.
 * @param {string} root - workspace directory.
 * @param {object} input - role input.
 * @param {string} input.work - work identity.
 * @param {'writer'|'planner'|'reviewer'|'reviser'|'summarizer'} input.role - role.
 * @param {number|string} [input.chapter] - chapter number; optional for work-scoped planning.
 * @param {string} [input.instruction] - author instruction.
 * @param {string} [input.mode] - revision mode.
 * @returns {Promise<{manifest: object, entry: object|undefined, body: string, latest: object|undefined, review: object|undefined, context: object}>} loaded inputs.
 */
export async function loadRoleInput(root, input) {
  const role = input.role
  const number = input.chapter === undefined ? undefined : chapterNumber(input.chapter)
  if (role !== 'planner' && number === undefined) {
    throw new StoryError('chapter-required', `${role} 必须给出章号：只有作品级规划可以省略 chapter`)
  }
  const instruction = typeof input.instruction === 'string' ? input.instruction : ''
  const mode = typeof input.mode === 'string' ? input.mode : 'patch'
  const manifest = readManifest(root, input.work)
  const entry = number === undefined ? undefined : manifest.chapters.find(item => item.number === number)

  // The action reads the chapter, its plan and its latest review itself; callers
  // never paste a body or a list into the prompt.
  let body = ''
  let latest
  let review
  if (role === 'reviewer' || role === 'reviser' || role === 'summarizer') {
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章：先写章纲再派活`)
    try {
      body = readChapter(root, { work: input.work, chapter: number }).content
    } catch (error) {
      if (error?.code === 'body-not-found') {
        throw new StoryError('chapter-not-written', `第 ${number} 章还没有正文：先写正文，再审稿、修订或写摘要`)
      }
      throw error
    }
    if (role !== 'summarizer') {
      latest = latestReview(root, manifest, entry)
      const observations = latest?.observations ?? []
      const open = observations
        .filter(observation => observation.assessment === 'issue')
        .map(observation => ({ id: observation.id, problem: observation.summary }))
      if (role === 'reviser' && open.length === 0) {
        throw new StoryError('review-required', `第 ${number} 章没有未处理的审稿条目：先 story_review，再修订`)
      }
      review = {
        round: latest?.round,
        revision: latest?.revision,
        open,
      }
    }
  }

  const context = await assembleRoleContext({
    root,
    work: input.work,
    ...(number === undefined ? {} : { chapter: number }),
    role,
    ...(role === 'planner' ? { scope: number === undefined ? 'work' : 'chapter' } : {}),
    ...(role === 'planner' ? {
      task: number === undefined
        ? '为这部作品出全书计划：主线、卷划分、结局方向。'
        : `为第 ${number} 章出章纲：五项齐全且互相咬合。`,
    } : {}),
    instruction,
    ...(role === 'reviser' ? { mode } : {}),
    ...(body === '' ? {} : { body }),
    ...(review === undefined ? {} : { review }),
  })
  return { manifest, entry, body, latest, review, context }
}
