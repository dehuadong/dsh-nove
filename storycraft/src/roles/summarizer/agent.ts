/** Summarizer landing: the raw summary plus its structured fields. */

import { writeSummary } from '../../storage.ts'
import type { LandInput, RoleLanding } from '../landing-types.ts'

/** Summary write input: the store's declared input plus the structured payload. */
type SummaryInput = Parameters<typeof writeSummary>[1] & {
  content: unknown
  ifAbsent: boolean
}

/** Land one summarizer payload. */
export async function land({ root, work, chapter, payload }: LandInput): Promise<RoleLanding> {
  const summaryInput: SummaryInput = { work, chapter, content: payload, ifAbsent: true }
  const receipt = writeSummary(root, summaryInput)
  return {
    artifact: receipt.artifact,
    summaryChars: receipt.chars,
  }
}

export * from './contract.ts'
export * from './prompts.ts'
export * from './tool-schema.ts'
