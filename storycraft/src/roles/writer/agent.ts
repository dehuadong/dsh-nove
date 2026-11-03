/** Writer landing: draft checks run before the chapter is written. */

import { checkDraft } from '../../landing.ts'
import { writeChapter } from '../../storage.ts'
import type { LandInput, RoleLanding } from '../landing-types.ts'

/** Land one writer payload. */
export async function land({ root, work, chapter, payload, manifest }: LandInput): Promise<RoleLanding> {
  const { title, body } = payload
  const { warnings } = await checkDraft(root, { work, chapter, body })
  const written = writeChapter(root, {
    work, chapter, title, body,
    requirePlanApproval: manifest.planApproval === 'required',
  })
  return {
    revision: written.revision,
    words: written.words,
    warnings,
    artifact: { workId: work, artifactId: `chapter:${chapter}`, revisionId: `r${written.revision}`, kind: 'chapter' },
    ...(manifest.wordRange === undefined ? {} : { wordRange: manifest.wordRange }),
  }
}

export * from './contract.ts'
export * from './prompts.ts'
export * from './tool-schema.ts'
