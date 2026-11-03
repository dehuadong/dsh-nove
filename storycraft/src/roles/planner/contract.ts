import type { RoleInputDeps, RoleInputState } from '../../runtime/role-input-kit.ts'
import { readPlan } from '../../storage.ts'

export const contract = {
  name: 'planner',
  label: '规划',
  nextAction: 'story_plan',
  requiresChapter: false,
  traceAfterLand: true,
} as const

/** Planner task text: work-level outline or one chapter memo. */
export function task(chapter: number | undefined): string {
  return chapter === undefined
    ? '为这部作品出全书计划：主线、卷划分、结局方向。'
    : `为第 ${chapter} 章出章纲：五项齐全且互相咬合。`
}

/** Planner reads no chapter body; it plans work-wide or one chapter. */
export function loadInput(deps: RoleInputDeps): RoleInputState {
  return {
    scope: deps.chapter === undefined ? 'work' : 'chapter',
    task: task(deps.chapter),
  }
}

/** The outline must be approved and no plan may exist yet. */
export function preflight(deps: RoleInputDeps, error: (code: string, message: string) => never): void {
  if (deps.manifest.outline?.approvedAt === undefined) {
    error('outline-required', '全书计划还没确认：先写并确认全书计划，再委派 planner 写章纲')
  }
  if (readPlan(deps.root, deps.work, deps.chapter!) !== undefined) {
    error('plan-exists', `第 ${deps.chapter} 章已有章纲：改章纲请由主编手动 story_plan，planner 只写首次章纲`)
  }
}
