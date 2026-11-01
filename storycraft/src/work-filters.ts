/** Server-side work/chapter filters for the read-only E18 list views. */

export type WorkStatus = 'empty' | 'planning' | 'writing' | 'settled' | 'degraded'

export interface WorkFilters {
  q?: string
  status?: WorkStatus
  issues?: boolean
}

export interface ChapterFilters {
  q?: string
  stage?: string
  issues?: boolean
}

/** Derive the display status from chapter summaries; null for short/script. */
export function workStatus(work: any): WorkStatus | null {
  if (String(work?.form ?? '') !== 'longform') return null
  if (work?.degraded === true) return 'degraded'
  const chapters = Number(work?.chapters ?? 0)
  if (chapters === 0) return 'empty'
  if (Number(work?.writtenChapters ?? 0) === 0) return 'planning'
  return work?.latestStage === 'settled' ? 'settled' : 'writing'
}

/** Filter work summaries by title, derived status and open problem count. */
export function filterWorks(works: readonly any[], filters: WorkFilters = {}): any[] {
  const query = String(filters.q ?? '').trim().toLowerCase()
  return works.filter(work => {
    if (query !== '' && !String(work?.title ?? '').toLowerCase().includes(query)) return false
    if (filters.status !== undefined && String(work?.form ?? '') === 'longform'
      && workStatus(work) !== filters.status) return false
    if (filters.issues !== undefined) {
      const count = work?.openProblems
      if (count === null || count === undefined) return false
      if (filters.issues !== (Number(count) > 0)) return false
    }
    return true
  })
}

/** Filter chapter summaries by number/title, stage and open observations. */
export function filterChapters(chapters: readonly any[], filters: ChapterFilters = {}): any[] {
  const query = String(filters.q ?? '').trim()
  const numeric = /^#?(\d+)$/u.exec(query)
  return chapters.filter(chapter => {
    if (numeric !== null) {
      if (Number(chapter?.number) !== Number(numeric[1])) return false
    } else if (query !== '' && !String(chapter?.title ?? '').toLowerCase().includes(query.toLowerCase())) return false
    if (filters.stage !== undefined && chapter?.stage !== filters.stage) return false
    if (filters.issues !== undefined) {
      const count = Number(chapter?.openProblems ?? 0)
      if (filters.issues !== (count > 0)) return false
    }
    return true
  })
}
