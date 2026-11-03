import type { RoleInputDeps, RoleInputState } from '../../runtime/role-input-kit.ts'
import { latestReview } from '../../storage.ts'
import { polishFirst, readBody, readOpenReview, requireOpenReview } from '../../runtime/role-input-kit.ts'

export const contract = {
  name: 'reviser',
  label: '修订',
  nextAction: 'story_revise',
  requiresChapter: true,
  usesMode: true,
  revisionLimitBlocked: true,
} as const

/** The reviser needs a body and an open finding; deslop runs the rules first. */
export function loadInput(deps: RoleInputDeps): RoleInputState {
  const body = readBody(deps)
  const started = deps.mode === 'deslop' ? polishFirst(deps, body) : body
  const { latest, review } = readOpenReview(deps)
  requireOpenReview(deps, review)
  return { body: started, latest, review }
}

/** A revision needs a written, unsettled body whose latest review still covers it. */
export function preflight(deps: RoleInputDeps, error: (code: string, message: string) => never): void {
  if (deps.entry === undefined || deps.entry.currentRevision === 0) {
    error('chapter-not-written', `第 ${deps.chapter} 章还没有正文：先写正文，再修订`)
  }
  if (deps.entry.stage === 'settled') error('chapter-settled', `第 ${deps.chapter} 章已定稿：先 reopen 再修订`)
  if (deps.manifest.planApproval === 'required' && deps.entry.planApproved !== true) {
    error('plan-not-approved', `第 ${deps.chapter} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」后再修订`)
  }
  const latest: any = latestReview(deps.root, deps.work, deps.chapter!)
  if (latest === undefined) error('review-required', `第 ${deps.chapter} 章还没有审稿：先 story_review`)
  const open = latest.items.filter((item: any) => !item.done)
  if (open.length === 0) error('review-required', `第 ${deps.chapter} 章没有未处理的审稿条目：先 story_review，再修订`)
  const current = deps.entry.currentRevision
  const covers = latest.revision === current || (deps.mode !== 'patch' && latest.revision === current - 1)
  if (!covers) error('review-required', `第 ${deps.chapter} 章的审稿针对旧版本 r${latest.revision}：先重新审稿`)
}
