/** Reviewer landing: items become evidence-bound observations; quote mismatch asks for one retry. */

import { writeReview } from '../../storage.ts'
import type { LandInput, RoleLanding } from '../landing-types.ts'

/** One reviewer item from the child's validated payload. */
interface ReviewerItem {
  quote: string
  problem: string
  impact?: string
  severity?: string
  fix?: string
  mode?: string
  resolves?: string
}

/** Reviewer payload items → review observations bound to one body revision. */
function reviewerObservations(items: ReviewerItem[], chapter: number, revision: number) {
  return items.map((item, index) => ({
    id: `O${index + 1}`,
    summary: item.problem,
    evidence: typeof item.impact === 'string' && item.impact.trim() === '' ? [] : [item.impact],
    category: 'quality',
    assessment: item.resolves === undefined ? 'issue' : 'resolved',
    ...(item.resolves === undefined ? {} : { resolves: item.resolves }),
    ...(item.severity === undefined ? {} : { severity: item.severity === 'blocker' ? 'blocking' : item.severity }),
    ...(item.fix === undefined ? {} : { fix: item.fix }),
    ...(item.mode === undefined ? {} : { mode: item.mode }),
    sourceRefs: [{ sourceId: `chapter:${chapter}:r${revision}`, quote: item.quote }],
  }))
}

/** The chapter revision this review round binds to. */
function bodyRevision(manifest: any, chapter: number): number {
  const entry = (manifest.chapters as Array<{ number: number, currentRevision: number }> | undefined)
    ?.find(item => item.number === chapter)
  return entry!.currentRevision
}

/** Land one reviewer payload. */
export async function land({ root, work, chapter, payload, manifest }: LandInput): Promise<RoleLanding> {
  const revision = bodyRevision(manifest, chapter)
  const written = writeReview(root, { work, chapter, observations: reviewerObservations(payload.items, chapter, revision) })
  return {
    reviewRound: written.round,
    artifact: { workId: work, artifactId: written.artifactId, revisionId: written.revisionId, kind: 'review' },
    problems: {
      total: written.observations.length,
      open: written.observations.filter((observation: { assessment?: string }) => observation.assessment === 'issue').length,
    },
  }
}

/** One bounded repair: a rejected quote gets one corrective retry, never silent acceptance. */
export function landRetry(error: { code?: string, message?: string } | undefined, input?: { revision?: number }): string | undefined {
  if (error?.code !== 'observation-source-unverified') return undefined
  return `上一次提交（正文 r${input?.revision ?? '?'}）被拒绝：${error.message ?? ''}。重新提交前逐条核对：quote 必须是当前正文里连续存在的原文；核对不过就删除该条 observation，不得改写引文。`
}

export * from './contract.ts'
export * from './prompts.ts'
export * from './tool-schema.ts'
