import type {
  Stage,
  ChapterEntry,
  ReviewLike,
} from './core.ts'

export const STAGES = ['planned', 'written', 'reviewed', 'revised', 'settled'] as const

export function stageOf(entry: unknown): Stage {
  const stage = (entry as ChapterEntry | null | undefined)?.stage
  return typeof stage === 'string' && (STAGES as readonly string[]).includes(stage) ? stage as Stage : 'planned'
}

export function summaryAdmissible(entry: ChapterEntry | undefined, latest: ReviewLike | undefined): boolean {
  if (entry === undefined || entry.currentRevision === 0) return false
  const stage = stageOf(entry)
  if (stage === 'revised' || stage === 'settled') return true
  return stage === 'reviewed'
    && latest !== undefined
    && latest.revision === entry.currentRevision
    && (latest.observations ?? []).filter(item => item.assessment === 'issue').length === 0
}

export const SUMMARY_MAX_CHARS = 400

export const SUMMARY_FIELDS = ['title', 'characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType']

export function trimSummary(text: unknown): { text: string, chars: number } {
  const trimmed = String(text ?? '').trim()
  return { text: trimmed, chars: [...trimmed].length }
}
