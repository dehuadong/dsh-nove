/**
 * Shared role input loader for `story_context` and host-side delegation.
 *
 * Both the manual dispatch path and `story_delegate` need the same chapter body,
 * latest review and assembled role context. The loader owns the shared reads and
 * the context call; each role contract decides what it needs and which gates
 * apply (`chapter-not-written`, `polish-noop`, `review-required`).
 */

import { StoryError, chapterNumber } from '../domain.ts'
import { readManifest } from '../storage.ts'
import { assembleRoleContext } from '../context.ts'
import { ROLES } from '../roles/registry.ts'
import type { RoleInputDeps, RoleInputState } from './role-input-kit.ts'

/** Roles this loader accepts. */
type Role = string

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

/** The loaded inputs one role dispatch needs. */
interface LoadedRoleInput {
  manifest: RoleManifest
  entry: RoleManifestChapter | undefined
  body: string
  latest: any
  review: RoleInputState['review'] | undefined
  context: Awaited<ReturnType<typeof assembleRoleContext>>
}

/**
 * Load the inputs one role needs.
 */
export async function loadRoleInput(root: string, input: RoleInput): Promise<LoadedRoleInput> {
  const role = input.role
  const number = input.chapter === undefined ? undefined : chapterNumber(input.chapter)
  const manifest: RoleManifest = readManifest(root, input.work)
  const entry = number === undefined ? undefined : manifest.chapters.find(item => item.number === number)
  const contract = ROLES[role]?.contract
  if (number === undefined && (contract?.requiresChapter ?? true)) {
    throw new StoryError('chapter-required', `${role} 必须给出章号：只有作品级规划可以省略 chapter`)
  }
  const instruction = typeof input.instruction === 'string' ? input.instruction : ''
  const mode = typeof input.mode === 'string' ? input.mode : 'patch'
  const deps: RoleInputDeps = { root, work: input.work, role, chapter: number, mode, manifest, entry }
  const state: RoleInputState = contract?.loadInput?.(deps) ?? {}

  const context = await assembleRoleContext({
    root,
    work: input.work,
    ...(number === undefined ? {} : { chapter: number }),
    role: role as any,
    ...(state.scope === undefined ? {} : { scope: state.scope }),
    ...(state.task === undefined ? {} : { task: state.task }),
    instruction,
    ...(contract?.usesMode === true ? { mode } : {}),
    ...(state.body === undefined || state.body === '' ? {} : { body: state.body }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(state.review === undefined ? {} : { review: state.review }),
  })
  return { manifest, entry, body: state.body ?? '', latest: state.latest, review: state.review, context }
}
