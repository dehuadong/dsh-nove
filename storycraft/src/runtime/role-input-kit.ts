/**
 * Helpers the per-role input contracts compose.
 *
 * This module is a leaf: it reads the store but never imports the role registry,
 * so `registry → role contract → this kit` stays acyclic.
 */

import { StoryError } from '../domain.ts'
import { applyPolishRules } from '../polish-rules.ts'
import { latestReview, readChapter } from '../storage.ts'

/** What the generic loader reads before asking a role contract. */
export interface RoleInputDeps {
  root: string
  work: string
  role: string
  chapter: number | undefined
  mode: string
  manifest: any
  entry: any
}

/** One open review observation as the context task lists it. */
export interface OpenObservation {
  id: string
  problem: string
}

/** What a role contract contributes to the assembled input. */
export interface RoleInputState {
  body?: string
  latest?: any
  review?: {
    round?: number
    revision?: number
    open: OpenObservation[]
  }
  scope?: 'work' | 'chapter'
  task?: string
}

/** Refuse a role that needs a chapter when the loader has none or no row. */
export function requireEntry(deps: RoleInputDeps): void {
  if (deps.entry === undefined) {
    throw new StoryError('chapter-not-found', `没有第 ${deps.chapter} 章：先写章纲再派活`)
  }
}

/** Read the chapter body, mapping a missing body to the established code. */
export function readBody(deps: RoleInputDeps): string {
  requireEntry(deps)
  try {
    return readChapter(deps.root, { work: deps.work, chapter: deps.chapter! }).content
  } catch (error) {
    // A thrown store error is a dynamic boundary: only its stable `code` is read.
    const code = (error as { code?: unknown } | null | undefined)?.code
    if (code === 'body-not-found') {
      throw new StoryError('chapter-not-written', `第 ${deps.chapter} 章还没有正文：先写正文，再审稿、修订或写摘要`)
    }
    throw error
  }
}

/** Apply the deterministic polish rules first; no change means no deslop work. */
export function polishFirst(deps: RoleInputDeps, body: string): string {
  const polished = applyPolishRules(body)
  if (polished.changes.length === 0) {
    throw new StoryError('polish-noop', `第 ${deps.chapter} 章没有可机械处理的腔调词`, '跳过修订，直接进入下一步（摘要或定稿）')
  }
  return polished.text
}

/** Latest non-stale review plus its open observations. */
export function readOpenReview(deps: RoleInputDeps): { latest: any, review: NonNullable<RoleInputState['review']> } {
  requireEntry(deps)
  const stored = latestReview(deps.root, deps.manifest, deps.entry)
  const latest = stored !== undefined && stored.stale === true ? undefined : stored
  const observations = latest?.observations ?? []
  const open: OpenObservation[] = observations
    .filter((observation: { assessment?: string }) => observation.assessment === 'issue')
    .map((observation: { id: string, summary: string }) => ({ id: observation.id, problem: observation.summary }))
  return {
    latest,
    review: {
      round: latest?.round,
      revision: latest?.revision,
      open,
    },
  }
}

/** A reviser with no open finding has nothing to revise. */
export function requireOpenReview(deps: RoleInputDeps, review: NonNullable<RoleInputState['review']>): void {
  if (review.open.length === 0) {
    throw new StoryError('review-required', `第 ${deps.chapter} 章没有未处理的审稿条目：先 story_review，再修订`, '先出审稿清单，或直接进入摘要')
  }
}
