import type { RoleInputDeps, RoleInputState } from '../../runtime/role-input-kit.ts'
import { readPlan } from '../../storage.ts'

export const contract = {
  name: 'writer',
  label: '写手',
  nextAction: 'story_write',
  requiresChapter: true,
} as const

/** The writer starts a fresh draft; it reads no body and no review. */
export function loadInput(): RoleInputState {
  return {}
}

/** The plan must exist and be approved; no prior body may exist. */
export function preflight(deps: RoleInputDeps, error: (code: string, message: string) => never): void {
  const plan = readPlan(deps.root, deps.work, deps.chapter!)
  if (deps.entry === undefined || plan === undefined) {
    error('plan-not-found', `第 ${deps.chapter} 章还没有章纲：先 story_plan，再写正文`)
  }
  if (deps.entry.stage === 'settled') error('chapter-settled', `第 ${deps.chapter} 章已定稿：改正文请先 reopen`)
  if (deps.manifest.planApproval === 'required' && deps.entry.planApproved !== true) {
    error('plan-not-approved', `第 ${deps.chapter} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」后再写正文`)
  }
  if (deps.entry.currentRevision > 0) error('chapter-exists', `第 ${deps.chapter} 章已有正文；改稿请走 story_revise 或手动 rewrite`)
}
