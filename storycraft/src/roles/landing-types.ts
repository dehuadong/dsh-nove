/** Shared types for one role's landing: payload → store write → receipt fields. */

/** What the runner hands to a role's `land`. */
export interface LandInput {
  root: string
  work: string
  chapter: number
  payload: any
  mode: string
  manifest: any
  loaded: any
}

/** Receipt fields a role owns; the runner adds the shared ones. */
export interface RoleLanding {
  artifact: { workId: string, artifactId: string, revisionId: string, kind: string }
  planApproved?: boolean
  revision?: number
  words?: number
  warnings?: string[]
  wordRange?: { min: number, max: number }
  summaryChars?: number
  resolved?: string[]
  lastMode?: string
  reviewRound?: number
  problems?: { total: number, open: number }
}
