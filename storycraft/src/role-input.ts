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

/** Roles this loader accepts. */
type Role = 'writer' | 'planner' | 'reviewer' | 'reviser' | 'summarizer'

/** Role input as `story_context` and `story_delegate` pass it in. */
interface RoleInput {
  /** work identity. */
  work: string
  /** role. */
  role: Role
  /** chapter number; optional for work-scoped planning. */
  chapter?: number | string
  /** author instruction. */
  instruction?: string
  /** revision mode. */
  mode?: string
  /** optional token budget for this assembly. */
  budget?: number
}

/** One chapter entry from the manifest. */
interface RoleManifestChapter {
  number: number
}

/** Manifest fields this module reads; the manifest itself comes from the store. */
interface RoleManifest {
  chapters: RoleManifestChapter[]
  wordRange?: { min: number, max: number }
  planApproval?: string
}

/** One unresolved review observation, as the context task lists it. */
interface ReviewItem {
  id: string
  problem: string
}

/** Latest review fields this module reads. */
interface LatestReview {
  round: number
  revision: number
  observations: Array<{ id: string, assessment: string, summary: string }>
}

/** The review summary handed to the context, undefined for non-review roles. */
interface RoleReview {
  round?: number
  revision?: number
  open: ReviewItem[]
}

/** The loaded inputs one role dispatch needs. */
interface LoadedRoleInput {
  manifest: RoleManifest
  entry: RoleManifestChapter | undefined
  body: string
  latest: LatestReview | undefined
  review: RoleReview | undefined
  context: Awaited<ReturnType<typeof assembleRoleContext>>
}

/**
 * Load the inputs one role needs.
 */
export async function loadRoleInput(root: string, input: RoleInput): Promise<LoadedRoleInput> {
  const role = input.role
  const number = input.chapter === undefined ? undefined : chapterNumber(input.chapter)
  if (role !== 'planner' && number === undefined) {
    throw new StoryError('chapter-required', `${role} 必须给出章号：只有作品级规划可以省略 chapter`)
  }
  const instruction = typeof input.instruction === 'string' ? input.instruction : ''
  const mode = typeof input.mode === 'string' ? input.mode : 'patch'
  const manifest: RoleManifest = readManifest(root, input.work)
  const entry = number === undefined ? undefined : manifest.chapters.find(item => item.number === number)

  // The action reads the chapter, its plan and its latest review itself; callers
  // never paste a body or a list into the prompt.
  let body = ''
  let latest: LatestReview | undefined
  let review: RoleReview | undefined
  if (role === 'reviewer' || role === 'reviser' || role === 'summarizer') {
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章：先写章纲再派活`)
    try {
      // The guard above guarantees a chapter for every non-planner role.
      body = readChapter(root, { work: input.work, chapter: number! }).content
    } catch (error) {
      // A thrown store error is a dynamic boundary: only its stable `code` is read.
      const code = (error as { code?: unknown } | null | undefined)?.code
      if (code === 'body-not-found') {
        throw new StoryError('chapter-not-written', `第 ${number} 章还没有正文：先写正文，再审稿、修订或写摘要`)
      }
      throw error
    }
    if (role !== 'summarizer') {
      latest = latestReview(root, manifest, entry)
      const observations = latest?.observations ?? []
      const open: ReviewItem[] = observations
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
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(review === undefined ? {} : { review }),
  })
  return { manifest, entry, body, latest, review, context }
}
