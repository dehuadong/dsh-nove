/** Author-facing dashboard data and hook transitions. */

import { StoryError, stageOf } from './domain.ts'
import { appendStateEvent, readEvents, readFoldedState, readManifest, readStateDraft, status as readStatus } from './storage.ts'
import { applyHookOp, projectState } from './state-projection.ts'

/** One unresolved hook rendered by the dashboard. */
export interface DashboardHook {
  hookId: string
  text: string
  type?: string
  status: string
  startChapter?: number
  lastAdvancedChapter?: number
  expectedPayoff?: string
}

/** The dashboard read model; no summary body or review detail. */
export interface DashboardData {
  status: ReturnType<typeof readStatus>
  hooks: DashboardHook[]
  transitionChapter: number | null
}

/** Latest chapter that has a body and is not settled. */
function writableChapter(manifest: ReturnType<typeof readManifest>): number | null {
  const chapters = Array.isArray(manifest.chapters) ? manifest.chapters : []
  for (let index = chapters.length - 1; index >= 0; index -= 1) {
    const chapter = chapters[index] as { number?: unknown, currentRevision?: unknown }
    const number = Number(chapter.number)
    if (!Number.isInteger(number) || number < 1) continue
    if (Number(chapter.currentRevision ?? 0) > 0 && stageOf(chapters[index]) !== 'settled') return number
  }
  return null
}

/** Read the panel dashboard for one work. */
export function readDashboard(root: string, work: string): DashboardData {
  const folded = readFoldedState(root, work)
  const hooks: DashboardHook[] = folded.hooks
    .filter((hook: any) => ['open', 'progressing', 'deferred'].includes(hook.status))
    .map((hook: any) => ({
      hookId: String(hook.hookId),
      text: String(hook.text ?? ''),
      ...(typeof hook.type === 'string' ? { type: hook.type } : {}),
      status: String(hook.status),
      ...(typeof hook.startChapter === 'number' ? { startChapter: hook.startChapter } : {}),
      ...(typeof hook.lastAdvancedChapter === 'number' ? { lastAdvancedChapter: hook.lastAdvancedChapter } : {}),
      ...(typeof hook.expectedPayoff === 'string' ? { expectedPayoff: hook.expectedPayoff } : {}),
    }))
    .sort((left, right) => (left.startChapter ?? 0) - (right.startChapter ?? 0) || left.hookId.localeCompare(right.hookId))
  return {
    status: readStatus(root, work),
    hooks,
    transitionChapter: writableChapter(readManifest(root, work)),
  }
}

/** Apply one author hook transition on the latest writable chapter. */
export function transitionHook(root: string, input: { work: string, hookId: string, op: string }): DashboardData {
  const work = String(input.work)
  const hookId = String(input.hookId)
  const op = String(input.op)
  if (op !== 'progress' && op !== 'resolve') throw new StoryError('hook-transition-invalid', 'op 只支持 progress/resolve')
  const manifest = readManifest(root, work)
  const chapter = writableChapter(manifest)
  if (chapter === null) throw new StoryError('chapter-settled', '没有未定稿的已写章：先写正文或撤回定稿')
  if (readStateDraft(root, { work, chapter }) !== undefined) {
    throw new StoryError('state-draft-pending', '本章还有状态草案：先接受或丢弃草案，再标记伏笔')
  }
  const events = readEvents(root, work)
  const current = projectState(events).hooks.find((hook: any) => hook.hookId === hookId)
  if (current === undefined) throw new StoryError('hook-not-found', `没有伏笔：${hookId}`)
  const sameTarget = op === 'progress'
    ? current.status === 'progressing' && Number(current.lastAdvancedChapter ?? 0) >= chapter
    : current.status === 'resolved'
  if (sameTarget) return readDashboard(root, work)
  const { event } = applyHookOp(events, { op, hookId, chapter }, { allowReapply: false })
  if (event !== null) {
    appendStateEvent(root, {
      work, chapter, kind: 'hook',
      payload: { op: event.op, hookId: event.hookId, chapter: event.chapter },
    })
  }
  return readDashboard(root, work)
}
