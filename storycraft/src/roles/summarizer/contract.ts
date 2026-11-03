import type { RoleInputDeps, RoleInputState } from '../../runtime/role-input-kit.ts'
import { latestReview, readSummaryState, summaryAdmissible } from '../../storage.ts'
import { readBody } from '../../runtime/role-input-kit.ts'

export const contract = {
  name: 'summarizer',
  label: '摘要',
  nextAction: 'story_summarize',
  requiresChapter: true,
} as const

/** The summarizer reads the settled body only; the plan and review are not its material. */
export function loadInput(deps: RoleInputDeps): RoleInputState {
  return { body: readBody(deps) }
}

/** A summary needs a body, an admissible review state, and no current summary. */
export function preflight(deps: RoleInputDeps, error: (code: string, message: string) => never): void {
  if (deps.entry === undefined || deps.entry.currentRevision === 0) {
    error('chapter-not-written', `第 ${deps.chapter} 章还没有正文：先写正文，再写摘要`)
  }
  const summary = readSummaryState(deps.root, deps.work, deps.chapter!)
  if (summary.state === 'current') {
    error('summary-exists', `第 ${deps.chapter} 章当前版本已有摘要：作者的主动重写请走手动 story_summarize`)
  }
  const latest = latestReview(deps.root, deps.work, deps.chapter!)
  if (summaryAdmissible(deps.entry, latest)) return
  error('review-required', `第 ${deps.chapter} 章还没到可写摘要的阶段：先完成审稿与修订，或清稿`)
}
