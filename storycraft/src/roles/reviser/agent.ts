/** Reviser landing: draft checks, then one revision over the open observations. */

import { checkDraft } from '../../landing.ts'
import { latestReview, readManifest, reviseChapter } from '../../storage.ts'
import type { LandInput, RoleLanding } from '../landing-types.ts'

/** Revision write input: the store's declared input plus the problem list the action layer carries. */
type RevisionInput = Parameters<typeof reviseChapter>[1] & {
  problemIds: string[]
  requirePlanApproval: boolean
}

/** Observations that still block settlement. */
function openObservationsOf(review: { observations?: Array<{ id: string, assessment?: string }> } | undefined) {
  return (review?.observations ?? []).filter(observation => observation.assessment === 'issue')
}

/** Land one reviser payload. */
export async function land({ root, work, chapter, payload, mode, manifest }: LandInput): Promise<RoleLanding> {
  const { body } = payload
  const { warnings } = await checkDraft(root, { work, chapter, body })
  const open = openObservationsOf(latestReview(root, work, chapter)).map(observation => observation.id)
  const problemIds = Array.isArray(payload.resolved) ? payload.resolved.map(String) : open
  const revisionInput: RevisionInput = {
    work, chapter, body, problemIds, mode,
    requirePlanApproval: readManifest(root, work).planApproval === 'required',
  }
  const revised = reviseChapter(root, revisionInput)
  return {
    revision: revised.revision,
    words: revised.words,
    resolved: revised.resolved,
    lastMode: mode,
    warnings,
    artifact: { workId: work, artifactId: `chapter:${chapter}`, revisionId: `r${revised.revision}`, kind: 'chapter' },
    ...(manifest.wordRange === undefined ? {} : { wordRange: manifest.wordRange }),
  }
}

export * from './contract.ts'
export * from './prompts.ts'
export * from './tool-schema.ts'
