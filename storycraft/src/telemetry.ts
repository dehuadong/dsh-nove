/** Per-dispatch model call telemetry stored in the work database. */

import { openWork, transaction } from './db.ts'

export interface CallInput {
  chapter: number | null
  role: string
  scope: string
  attempt: number
  trigger: string
  delegationId?: string | null
  childSession?: string | null
  startedAt: string
  endedAt: string
  durationMs: number
  stopReason?: string | null
  outcome: string
  promptChars: number
  outputChars: number
  modelCalls?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  usageSource: 'session' | 'partial' | 'unavailable'
  model?: string | null
  provider?: string | null
  errorCode?: string | null
}

const nullable = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

/** Insert one dispatch row; returns its id. */
export function recordCall(root: string, work: string, input: CallInput): number {
  const db = openWork(root, work)
  try {
    return transaction(db, () => {
      const info = db.prepare(`INSERT INTO model_calls
        (chapter, role, scope, attempt, submission_attempts, trigger, delegation_id, child_session,
         started_at, ended_at, duration_ms, stop_reason, outcome, prompt_chars, output_chars, model_calls,
         input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens, usage_source, model, provider, error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.chapter, input.role, input.scope, input.attempt, null, input.trigger,
        input.delegationId ?? null, input.childSession ?? null, input.startedAt, input.endedAt,
        input.durationMs, input.stopReason ?? null, input.outcome, input.promptChars, input.outputChars,
        input.modelCalls ?? null, nullable(input.inputTokens), nullable(input.outputTokens), nullable(input.totalTokens),
        nullable(input.cacheReadTokens), nullable(input.cacheWriteTokens), input.usageSource,
        input.model ?? null, input.provider ?? null, input.errorCode ?? null,
      )
      return Number(info.lastInsertRowid)
    })
  } finally {
    db.close()
  }
}

/** Update the call site-owned outcome fields after submission consumption. */
export function finishCall(root: string, work: string, id: number, patch: {
  outcome?: string
  submissionAttempts?: number | null
  errorCode?: string | null
}): void {
  const db = openWork(root, work)
  try {
    transaction(db, () => {
      const fields: string[] = []
      const values: unknown[] = []
      if (patch.outcome !== undefined) { fields.push('outcome = ?'); values.push(patch.outcome) }
      if (patch.submissionAttempts !== undefined) { fields.push('submission_attempts = ?'); values.push(patch.submissionAttempts) }
      if (patch.errorCode !== undefined) { fields.push('error_code = ?'); values.push(patch.errorCode) }
      if (fields.length === 0) return
      values.push(id)
      db.prepare(`UPDATE model_calls SET ${fields.join(', ')} WHERE id = ?`).run(...(values as any[]))
    })
  } finally {
    db.close()
  }
}

/** Aggregate call telemetry for one work. */
export function callSummary(root: string, work: string) {
  const db = openWork(root, work)
  try {
    const rows = db.prepare(`SELECT role, outcome, usage_source, duration_ms, total_tokens FROM model_calls`).all() as any[]
    const byRole: Record<string, number> = {}
    let duration = 0
    let tokens = 0
    let tokenRows = 0
    let withUsage = 0
    let partial = 0
    let without = 0
    for (const row of rows) {
      byRole[row.role] = (byRole[row.role] ?? 0) + 1
      duration += Number(row.duration_ms ?? 0)
      if (row.usage_source === 'session') withUsage += 1
      else if (row.usage_source === 'partial') partial += 1
      else without += 1
      if (typeof row.total_tokens === 'number') { tokens += row.total_tokens; tokenRows += 1 }
    }
    return {
      count: rows.length,
      totalDurationMs: duration,
      totalTokens: tokenRows === 0 ? null : tokens,
      callsWithUsage: withUsage,
      callsPartial: partial,
      callsWithoutUsage: without,
      usageComplete: rows.length > 0 && withUsage === rows.length,
      byRole,
    }
  } finally {
    db.close()
  }
}
