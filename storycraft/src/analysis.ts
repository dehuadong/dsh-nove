/** Read-only analysis aggregate for the dashboard panel. */

import { reviewDistribution } from './store-db.ts'
import { callSummary } from './telemetry.ts'

/** One work's review and call aggregates; no text fields and no manifest scan. */
export function readAnalysis(root: string, work: string) {
  const summary = callSummary(root, work, undefined, true)
  return {
    reviews: reviewDistribution(root, work),
    calls: {
      total: {
        count: summary.count,
        totalDurationMs: summary.totalDurationMs,
        totalTokens: summary.totalTokens,
        callsWithoutUsage: summary.callsWithoutUsage,
      },
      byRole: summary.byRoleDetail ?? [],
      byModel: summary.byModelDetail ?? [],
    },
  }
}
