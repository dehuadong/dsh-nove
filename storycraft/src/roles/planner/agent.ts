/** Planner landing: the five plan fields become the chapter plan artifact. */

import { writePlan } from '../../storage.ts'
import type { LandInput, RoleLanding } from '../landing-types.ts'

/** Land one planner payload. */
export async function land({ root, work, chapter, payload }: LandInput): Promise<RoleLanding> {
  const { perspective, goal, obstacle, cost, turn, body, threadRefs } = payload
  const written = writePlan(root, {
    work, chapter, perspective, goal, obstacle, cost, turn, body, threadRefs, requireBody: true, requireAbsent: true,
  })
  return {
    planApproved: written.planApproved,
    artifact: { workId: work, artifactId: `plan:${chapter}`, revisionId: written.artifact.revisionId, kind: 'plan' },
  }
}

export * from './contract.ts'
export * from './prompts.ts'
export * from './tool-schema.ts'
