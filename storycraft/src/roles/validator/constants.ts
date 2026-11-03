export const STATE_CHECK_NO_EVIDENCE = '无对应段落'

/** State-check finding codes accepted by the validator role. */
export const VALIDATOR_CODES = new Set([
  'fact-unsupported',
  'fact-ambiguous',
  'missing-change',
  'hook-state-mismatch',
  'hook-evidence-weak',
])

/** Per-field character caps for one validator finding. */
export const VALIDATOR_LIMITS: Record<string, number> = { where: 120, problem: 160, evidence: 240, impact: 120, fix: 120 }

/** Settler delta bounds; the host still re-normalizes and validates it. */
