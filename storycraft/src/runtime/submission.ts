/**
 * In-memory role-result submissions for one delegated child run.
 *
 * This is a transport seam, not work storage: the parent creates one bound
 * entry before starting the child, the child submits through `story_submit`,
 * and the parent consumes the accepted payload and lands it itself.
 */

import { randomUUID } from 'node:crypto'
import { StoryError, SUMMARY_MAX_CHARS, countWords, trimSummary } from '../domain.ts'
import { assertRevisionMode } from '../revision.ts'
import { checkWordRange } from '../landing.ts'
import { readChapter } from '../storage.ts'
import { FOUNDATION_PHASES } from '../roles/architect/contract.ts'
import { ROLES } from '../roles/registry.ts'

/** Entries live long enough for a slow child, never beyond the host run. */
const SUBMISSION_TTL_MS = 10 * 60 * 1000
export const FOUNDATION_TTL_MS = 30 * 60 * 1000
const MAX_ATTEMPTS = 3
const MAX_PAYLOAD_BYTES = 64 * 1024

/** Word range bound on one delegation. */
interface WordRange {
  min: number
  max: number
}

/** Model-produced role payload; every shape is checked field by field below. */
type SubmissionPayload = Record<string, any>

/** One delegation entry, from opening until its payload is consumed. */
interface SubmissionEntry {
  role: string
  workId: string
  chapter: number | null
  stage?: string
  mode?: string
  wordRange?: WordRange
  payload: SubmissionPayload | undefined
  phases?: Map<string, SubmissionPayload>
  phaseAttempts?: Map<string, number>
  attempts: number
  consumed: boolean
  bytes: number
  expiresAt: number
}

/** Binding the host records before starting the child. */
interface SubmissionBinding {
  role: string
  workId: string
  chapter?: number
  stage?: string
  phase?: string
  mode?: string
  wordRange?: WordRange
}

/** Identity handed to the child. */
interface SubmissionHandle {
  delegationId: string
  attempts: number
}

/** Accepted payload handed back to the landing path. */
interface ConsumedSubmission {
  payload: SubmissionPayload | undefined
  phases?: Map<string, SubmissionPayload>
  attempts: number
  bytes: number
  consumed: boolean
}

/** Extra fields a retryable failure may carry so the child can correct itself. */
interface FailureExtra {
  retryable?: boolean
  words?: number
  min?: number
  max?: number
  actual?: string | number
  limit?: string | number
}

/** Structured failure the child inspects; never thrown. */
interface FailureEnvelope {
  ok: false
  error: { code: string, message: string }
  retryable: boolean
  words?: number
  min?: number
  max?: number
  actual?: string | number
  limit?: string | number
}

/** Successful receipt for an accepted payload. */
interface SubmitSuccess {
  ok: true
  submitted: true
  bytes: number
  words?: number
  phase?: string
}

/** One `story_submit` call from a child. */
interface SubmitInput {
  delegationId: string
  payload: SubmissionPayload
  phase?: string
  depth: number
  root: string
}

const submissions = new Map<string, SubmissionEntry>()

/** Remove one expired entry. */
function purge(id: string, entry: SubmissionEntry | undefined): SubmissionEntry | undefined {
  if (entry !== undefined && entry.expiresAt <= Date.now()) {
    submissions.delete(id)
    return undefined
  }
  return entry
}

/**
 * Bind role/work/chapter before starting the child.
 * @param input - delegation binding.
 * @returns identity handed to the child.
 */
export function openSubmission(input: SubmissionBinding): SubmissionHandle {
  const delegationId = randomUUID()
  submissions.set(delegationId, {
    role: String(input.role),
    workId: String(input.workId),
    chapter: input.chapter === undefined ? null : Number(input.chapter),
    ...(input.stage === undefined ? {} : { stage: String(input.stage) }),
    ...(input.stage === 'foundation' ? { phases: new Map(), phaseAttempts: new Map() } : {}),
    ...(input.mode === undefined ? {} : { mode: String(input.mode) }),
    ...(input.wordRange === undefined ? {} : { wordRange: input.wordRange }),
    payload: undefined,
    attempts: 0,
    consumed: false,
    bytes: 0,
    expiresAt: Date.now() + (input.stage === 'foundation' ? FOUNDATION_TTL_MS : SUBMISSION_TTL_MS),
  })
  return { delegationId, attempts: 0 }
}

/** Build a failure envelope the child can inspect and retry. */
function failure(code: string, message: string, extra: FailureExtra = {}): FailureEnvelope {
  return {
    ok: false,
    error: { code, message },
    retryable: extra.retryable === true,
    ...(extra.words === undefined ? {} : { words: extra.words }),
    ...(extra.min === undefined ? {} : { min: extra.min }),
    ...(extra.max === undefined ? {} : { max: extra.max }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    ...(extra.limit === undefined ? {} : { limit: extra.limit }),
  }
}

/** Evidence marker used when the body has no supporting passage. */
/**
 * Validate the role-specific payload shape.
 *
 * The payload is model-produced JSON, so it arrives as `any` and every field
 * is probed at runtime; only the checks below give it a shape.
 */
export function validateSubmissionShape(role: string, payload: any, stage: string | undefined): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload 必须是对象'
  }
  const module = ROLES[role]
  if (module === undefined) return `未知角色：${role}`
  return module.schema.validate(payload, { stage })
}

/** Whether a foundation phase has its required predecessor. */
function phasePrerequisite(phase: string): string | undefined {
  if (phase === 'details') return 'outline'
  if (phase === 'cast_index') return 'details'
  if (phase === 'cards') return 'cast_index'
  return undefined
}

/** Submit one phase of a foundation delegation; phases accumulate until bundle. */
function submitFoundationPhase(input: SubmitInput, entry: SubmissionEntry): FailureEnvelope | SubmitSuccess {
  const phases = entry.phases as Map<string, SubmissionPayload>
  const attempts = entry.phaseAttempts as Map<string, number>
  entry.attempts += 1
  const phase = String(input.phase ?? '')
  if (!(FOUNDATION_PHASES as readonly string[]).includes(phase)) {
    return failure('submit-invalid', `未知的 foundation phase：${phase || '（缺失）'}`, { retryable: true })
  }
  if (phases.has(phase)) return failure('submit-already-accepted', `foundation phase 已接受：${phase}`)
  const prerequisite = phasePrerequisite(phase)
  if (prerequisite !== undefined && !phases.has(prerequisite)) {
    return failure('submit-phase-order', `foundation phase ${phase} 需要先提交 ${prerequisite}`, { retryable: true })
  }
  const count = (attempts.get(phase) ?? 0) + 1
  attempts.set(phase, count)
  if (count > MAX_ATTEMPTS) return failure('submit-attempts-exhausted', `${phase} 提交尝试超过 ${MAX_ATTEMPTS} 次`)
  const payload = input.payload
  const shapeError = validateSubmissionShape('architect', payload, phase)
  if (shapeError !== undefined) {
    return count >= MAX_ATTEMPTS
      ? failure('submit-attempts-exhausted', `${phase} 提交尝试超过 ${MAX_ATTEMPTS} 次：${shapeError}`)
      : failure('submit-invalid', shapeError, { retryable: true })
  }
  let bytes: number
  try {
    bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  } catch {
    return failure('submit-invalid', 'payload 无法序列化', { retryable: true })
  }
  if (bytes > MAX_PAYLOAD_BYTES) {
    return count >= MAX_ATTEMPTS
      ? failure('submit-attempts-exhausted', `${phase} 提交尝试超过 ${MAX_ATTEMPTS} 次`)
      : failure('submit-too-large', `${phase} payload ${bytes} 字节，超过 ${MAX_PAYLOAD_BYTES}`)
  }
  phases.set(phase, payload)
  entry.bytes += bytes
  entry.expiresAt = Date.now() + FOUNDATION_TTL_MS
  return { ok: true, submitted: true, bytes, phase }
}

/**
 * Accept one submission from a child and validate it before consumption.
 * Validation failures are returned, not thrown, so the child keeps the
 * actionable values and can retry in the same run.
 * @param input - submission.
 * @returns success or retryable failure envelope.
 */
export async function submitPayload(input: SubmitInput): Promise<FailureEnvelope | SubmitSuccess> {
  if (input.depth <= 0) return failure('submit-parent-denied', 'story_submit 只允许被派发的子代理调用')
  const id = String(input.delegationId)
  const entry = purge(id, submissions.get(id))
  if (entry === undefined) return failure('submit-unknown-delegation', 'delegationId 不存在或已过期')
  if (entry.consumed) return failure('submit-already-consumed', '该 delegationId 已提交')
  if (entry.stage === 'foundation') return submitFoundationPhase(input, entry)
  if (input.phase !== undefined) return failure('submit-invalid', 'phase 只用于 architect foundation')

  entry.attempts += 1
  if (entry.attempts > MAX_ATTEMPTS) return failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次`)

  const payload = input.payload
  const shapeError = validateSubmissionShape(entry.role, payload, entry.stage)
  if (shapeError !== undefined) {
    return entry.attempts >= MAX_ATTEMPTS
      ? failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次：${shapeError}`)
      : failure('submit-invalid', shapeError, { retryable: true })
  }
  let bytes: number
  try {
    bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  } catch {
    return failure('submit-invalid', 'payload 无法序列化', { retryable: true })
  }
  if (bytes > MAX_PAYLOAD_BYTES) {
    return entry.attempts >= MAX_ATTEMPTS
      ? failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次`)
      : failure('submit-too-large', `payload ${bytes} 字节，超过 ${MAX_PAYLOAD_BYTES}`)
  }

  if (entry.role === 'summarizer') {
    const { chars } = trimSummary(payload.rawText)
    if (chars > SUMMARY_MAX_CHARS) {
      return entry.attempts >= MAX_ATTEMPTS
        ? failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次；摘要 ${chars} 字，上限 ${SUMMARY_MAX_CHARS} 字`)
        : failure('submit-summary-range', `摘要 ${chars} 字，超过上限 ${SUMMARY_MAX_CHARS} 字`, {
          retryable: true,
          actual: `${chars} 字`,
          limit: `≤${SUMMARY_MAX_CHARS} 字`,
        })
    }
  }

  if (entry.role === 'writer' || entry.role === 'reviser') {
    try {
      checkWordRange({
        role: entry.role,
        ...(entry.mode === undefined ? {} : { mode: entry.mode }),
        body: payload.body,
        chapter: entry.chapter as number,
        wordRange: entry.wordRange,
      })
    } catch (error) {
      if (error instanceof StoryError && error.code === 'delegation-word-range') {
        const words = countWords(payload.body)
        return entry.attempts >= MAX_ATTEMPTS
          ? failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次；最后一次：${error.message}`)
          : failure('submit-word-range', error.message, {
            retryable: true,
            actual: `${words} 字`,
            limit: `${entry.wordRange?.min ?? 0}–${entry.wordRange?.max ?? '∞'} 字`,
            words,
            ...(entry.wordRange?.min === undefined ? {} : { min: entry.wordRange.min }),
            ...(entry.wordRange?.max === undefined ? {} : { max: entry.wordRange.max }),
          })
      }
      throw error
    }
  }

  if (entry.role === 'reviser') {
    let current: string
    try {
      current = readChapter(input.root, { work: entry.workId, chapter: entry.chapter as number }).content
      assertRevisionMode({ mode: entry.mode as string, chapter: entry.chapter as number, oldBody: current, body: payload.body })
    } catch (error) {
      if (error instanceof StoryError && error.code === 'revise-mode-violation') {
        return entry.attempts >= MAX_ATTEMPTS
          ? failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次；最后一次：${error.message}`)
          : failure('submit-mode-violation', error.message, { retryable: true, actual: entry.mode, limit: 'patch≤20% / polish≤40% / rewrite 不限 / deslop 必须减少' })
      }
      if (error instanceof StoryError) {
        return failure('submit-invalid', error.message, { retryable: true })
      }
      throw error
    }
  }

  entry.payload = payload
  entry.bytes = bytes
  entry.consumed = true
  return { ok: true, submitted: true, bytes, ...(entry.role === 'writer' || entry.role === 'reviser' ? { words: countWords(payload.body) } : {}) }
}

/** Mark a foundation entry consumed only after the bundle landed. */
export function markFoundationConsumed(delegationId: string): void {
  const entry = purge(String(delegationId), submissions.get(String(delegationId)))
  if (entry !== undefined) entry.consumed = true
}

/** Consume all four foundation phases; only the host calls this after the child ends. */
export function consumeFoundationSubmission(delegationId: string): ConsumedSubmission | undefined {
  const entry = purge(String(delegationId), submissions.get(String(delegationId)))
  if (entry === undefined || entry.phases === undefined) return undefined
  if (entry.phases.size !== FOUNDATION_PHASES.length) return undefined
  return { payload: undefined, phases: new Map(entry.phases), attempts: entry.attempts, bytes: entry.bytes, consumed: false }
}

/**
 * Consume the accepted payload; the caller must close the entry afterwards.
 * @param delegationId - identity.
 * @returns accepted payload.
 */
export function consumeSubmission(delegationId: string): ConsumedSubmission | undefined {
  const entry = purge(String(delegationId), submissions.get(String(delegationId)))
  if (entry === undefined) return undefined
  const result = { payload: entry.payload, attempts: entry.attempts, bytes: entry.bytes, consumed: entry.consumed === true }
  if (entry.consumed === true) submissions.delete(String(delegationId))
  return result
}

/** Remove one delegation entry in every outcome. */
export function closeSubmission(delegationId: string): void {
  submissions.delete(String(delegationId))
}
