/** Store contract types and revision limits shared by repositories. */

export const MAX_REVISION_ROUNDS = 3

export function revisionRounds(currentRevision: number): number {
  return Math.max(0, currentRevision - 1)
}

export interface WriteChapterInput {
  work: string
  chapter: number | string
  title?: string
  body: string
  rewrite?: boolean
  reopen?: boolean
  requirePlanApproval?: boolean
}

export interface ReadChapterInput {
  work: string
  chapter: number | string
  view?: 'body' | 'plan' | 'summary' | 'review'
  revision?: number
}

export interface WriteReviewInput {
  work: string
  chapter: number | string
  observations: Array<Record<string, any>>
}

export interface ReviseChapterInput {
  work: string
  chapter: number | string
  body: string
  mode?: string
  reopen?: boolean
}

export interface WriteSummaryInput {
  work: string
  chapter: number | string
  revision?: number
  text?: string
}
