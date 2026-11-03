import type { RoleInputDeps, RoleInputState } from '../../runtime/role-input-kit.ts'
import { readBody, readOpenReview } from '../../runtime/role-input-kit.ts'

export const contract = {
  name: 'reviewer',
  label: '审稿',
  nextAction: 'story_review',
  requiresChapter: true,
  mechanicalFindings: true,
} as const

/** The reviewer reads the body and the latest non-stale review. */
export function loadInput(deps: RoleInputDeps): RoleInputState {
  return {
    body: readBody(deps),
    ...readOpenReview(deps),
  }
}

/** A review needs a written chapter that is not settled yet. */
export function preflight(deps: RoleInputDeps, error: (code: string, message: string) => never): void {
  if (deps.entry === undefined || deps.entry.currentRevision === 0) {
    error('chapter-not-written', `第 ${deps.chapter} 章还没有正文：先写正文，再审稿`)
  }
  if (deps.entry.stage === 'settled') error('chapter-settled', `第 ${deps.chapter} 章已定稿：先 reopen 再审稿`)
}
