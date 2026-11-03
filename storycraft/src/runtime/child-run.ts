/**
 * One managed child run through the official `subagents` service.
 *
 * The caller owns cleanup: `runChild` returns the result and a disposer so the
 * role can land its output before the child is disposed. Startup telemetry,
 * timeout and transient-retry live here and are shared by chapter delegation,
 * state settlement and the state check.
 */

import { StoryError } from '../domain.ts'
import { callEvidence } from '../call-evidence.ts'
import { assertChapterBudget, recordCall } from '../telemetry.ts'
import type { CallInput } from '../telemetry.ts'
import { maxChapterTokensOf } from '../store-db.ts'

function abortPromise(signal: AbortSignal, message: string, code: string): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new StoryError(code, message))
      return
    }
    signal.addEventListener('abort', () => reject(new StoryError(code, message)), { once: true })
  })
}

/** Error code and message one unavailable-child refusal uses. */
interface AvailabilityOptions {
  unavailableCode?: string
  unavailableMessage?: string
}

/**
 * Refuse a run before any preflight or DB read when no child can be started.
 * Shared by chapter delegation (to keep its error order) and the state check.
 */
export function assertChildAvailability(
  // `ctx.get('subagents')` is a DSH dynamic boundary; the Harness owns the service shape.
  service: any,
  // `exec.agent` is a DSH dynamic boundary; the Harness owns the agent shape.
  agent: any,
  options: AvailabilityOptions = {},
): void {
  const unavailableCode = options.unavailableCode ?? 'delegation-unavailable'
  const unavailableMessage = options.unavailableMessage
    ?? '当前组合没有可用的 subagents 服务：请走手动 story_context + subagent 路径'
  if (service === undefined || agent === undefined) {
    throw new StoryError(unavailableCode, unavailableMessage)
  }
  if (typeof service.list === 'function') {
    const providers = service.list()
    if (Array.isArray(providers) && !providers.includes('spawn')) {
      throw new StoryError(unavailableCode, '当前组合没有 spawn 子代理 provider：请走手动 story_context + subagent 路径')
    }
  }
}

/** One started child from the subagents service. */
interface ChildActivation {
  childId?: string
  // The run envelope belongs to the subagents service; the Harness owns its shape.
  result: Promise<any>
  dispose(): Promise<void> | void
}

/** Child completion fields this module reads; the service owns the rest. */
interface ChildResult {
  stopReason?: string
  diagnostic?: string
  output?: any[]
}

/** Telemetry context supplied by the call site. */
export interface CallTelemetry {
  work: string
  chapter: number | null
  role: string
  scope: string
  attempt: number
  trigger: string
  delegationId?: string
  sessions?: any
  sink?: (call: CallInput) => number | undefined
  /** Called before every start attempt; chapter roles use it for the token cap. */
  assertBudget?: () => void
}

/** What a finished dispatch carries back for receipts and tests. */
export interface ChildCall {
  callId?: number
  durationMs: number
  usage: ReturnType<typeof callEvidence>
  /** Startup retries actually performed. */
  retries: number
}

/** A started child and the cleaner the caller must run. */
export interface ChildRun {
  result: ChildResult
  dispose: () => Promise<void>
  call: ChildCall
}

/** Host dependencies supplied by the action layer. */
export interface DelegateHost {
  // `ctx.get('subagents')` is a DSH dynamic boundary; the Harness owns the service shape.
  service?: any
  // `exec.agent` is a DSH dynamic boundary; the Harness owns the agent shape.
  agent?: any
  /** Caller cancellation from `exec.signal`. */
  signal?: AbortSignal
  /** Per-run budget override; defaults to DELEGATE_TIMEOUT_MS. */
  timeoutMs?: number
  /** Live session store used to read child usage before dispose. */
  sessions?: any
}

/** One child run's request; service and agent reuse the host boundary. */
export interface ChildRunInput extends DelegateHost {
  cwd: string
  prompt: string
  label: string
  timeoutMs: number
  availability?: boolean
  unavailableCode?: string
  failedCode?: string
  unavailableMessage?: string
  telemetry?: CallTelemetry
}

/**
 * Start one child and await its completion.
 *
 * The caller owns cleanup: this returns `{result, dispose}` so landing can
 * happen before the child is disposed. On any failure the helper disposes
 * before rethrowing.
 */
export async function runChild(input: ChildRunInput): Promise<ChildRun> {
  const {
    service, agent, cwd, prompt, label, signal, timeoutMs,
    availability = true,
    unavailableCode = 'delegation-unavailable',
    failedCode = 'delegation-failed',
    unavailableMessage = '当前组合没有可用的 subagents 服务：请走手动 story_context + subagent 路径',
    telemetry,
  } = input
  if (availability) {
    assertChildAvailability(service, agent, { unavailableCode, unavailableMessage })
  }

  const callerSignal = signal ?? new AbortController().signal
  const promptChars = [...prompt].length
  const budget = telemetry === undefined
    ? undefined
    : telemetry.assertBudget
      ?? (telemetry.chapter === null
        ? undefined
        : () => assertChapterBudget(cwd, telemetry.work, telemetry.chapter, maxChapterTokensOf(cwd, telemetry.work)))
  let activation: ChildActivation | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let started = Date.now()
  let startedAt = new Date(started).toISOString()
  let attemptIndex = 0
  let retries = 0
  let attemptStarted = false
  let recorded = false
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    if (activation !== undefined) {
      try {
        await activation.dispose()
      } catch (error) {
        console.warn(`[storycraft] 子代理清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const record = (outcome: string, result: ChildResult | undefined, errorCode?: string | null): ChildCall => {
    recorded = true
    const ended = Date.now()
    const usage = callEvidence(telemetry?.sessions, activation?.childId, result, promptChars)
    let callId: number | undefined
    if (telemetry?.sink !== undefined) {
      try {
        callId = telemetry.sink({
          chapter: telemetry.chapter, role: telemetry.role, scope: telemetry.scope,
          attempt: telemetry.attempt + attemptIndex,
          trigger: attemptIndex === 0 ? telemetry.trigger : 'transient-retry',
          delegationId: telemetry.delegationId ?? null,
          childSession: activation?.childId === undefined ? null : String(activation.childId),
          startedAt, endedAt: new Date(ended).toISOString(), durationMs: ended - started,
          stopReason: result?.stopReason ?? null, outcome,
          promptChars, outputChars: usage.outputChars, modelCalls: usage.modelCalls,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
          usageSource: usage.usageSource, model: usage.model, provider: usage.provider,
          errorCode: errorCode ?? null,
        })
      } catch (error) {
        console.warn(`[storycraft] 调用记录写入失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { ...(callId === undefined ? {} : { callId }), durationMs: ended - started, usage, retries }
  }

  let activeTimeout: AbortSignal | undefined
  try {
    for (;;) {
      // Budget and caller cancellation happen before the recording scaffold.
      attemptStarted = false
      recorded = false
      budget?.()
      if (callerSignal.aborted) throw new StoryError(failedCode, '子代理调用被取消')
      started = Date.now()
      startedAt = new Date(started).toISOString()
      const timeout = new AbortController()
      timer = setTimeout(() => timeout.abort(), timeoutMs)
      activeTimeout = timeout.signal
      const combined = AbortSignal.any([callerSignal, timeout.signal])
      try {
        attemptStarted = true
        activation = await service.startActivation({
          provider: 'spawn',
          label,
          request: {
            parent: agent,
            cwd,
            prompt: [{ type: 'text', text: prompt }],
          },
          signal: combined,
          delivery: 'caller',
        })
        break
      } catch (error: any) {
        const message = String(error?.message ?? error)
        const timedOut = activeTimeout?.aborted === true
        const transient = !timedOut && isTransientStartFailure(message)
        const unavailable = !transient && (error?.code === 'UNSUPPORTED_CAPABILITY' || /capabilit/iu.test(message) || /provider unavailable/iu.test(message))
        const code = timedOut ? failedCode : transient ? 'delegation-transient' : unavailable ? unavailableCode : failedCode
        const call = record(timedOut ? 'timeout' : 'error', undefined, code)
        if (callerSignal.aborted) {
          const cancelled = new StoryError(failedCode, '子代理调用被取消')
          ;(cancelled as any).retries = attemptIndex
          if (call.callId !== undefined) (cancelled as any).callId = call.callId
          throw cancelled
        }
        if (timedOut) {
          const mapped = new StoryError(failedCode, `子代理启动超时：${message}`)
          ;(mapped as any).retries = attemptIndex
          if (call.callId !== undefined) (mapped as any).callId = call.callId
          throw mapped
        }
        if (!transient || attemptIndex >= 2) {
          const mapped = new StoryError(
            transient ? 'delegation-transient-exhausted' : code,
            transient ? `子代理启动连续失败（已重试 ${attemptIndex} 次）：${message}` : `子代理启动失败：${message}`,
          )
          ;(mapped as any).retries = attemptIndex
          if (call.callId !== undefined) (mapped as any).callId = call.callId
          throw mapped
        }
        attemptIndex += 1
        retries = attemptIndex
        if (timer !== undefined) clearTimeout(timer)
        await abortableDelay(800 * attemptIndex, callerSignal, failedCode)
      }
    }

    if (activeTimeout === undefined) throw new StoryError(failedCode, '子代理没有启动')
    const result = await Promise.race([
      activation!.result,
      abortPromise(callerSignal, '子代理调用被取消', failedCode),
      abortPromise(activeTimeout, '子代理调用超时', failedCode),
    ]).catch(error => {
      if (error instanceof StoryError) throw error
      throw new StoryError(failedCode, `子代理调用失败：${error?.message ?? error}`)
    })
    if (timer !== undefined) clearTimeout(timer)
    const call = record(result?.stopReason === 'completed' ? 'completed' : 'error', result)
    return { result, dispose, call: { ...call, retries } }
  } catch (error) {
    if (!recorded && attemptStarted) {
      const outcome = callerSignal.aborted ? 'cancelled' : activeTimeout?.aborted ? 'timeout' : 'error'
      const call = record(outcome, undefined, (error as { code?: string })?.code)
      if (call.callId !== undefined && typeof error === 'object' && error !== null) (error as any).callId = call.callId
    }
    await dispose()
    if (typeof error === 'object' && error !== null) (error as any).retries = retries
    throw error
  }
}

function isTransientStartFailure(message: string): boolean {
  const text = message.toLowerCase()
  if (text.includes('model_not_available') || text.includes('model not available')) return false
  return /\b(429|502|503|504)\b/.test(text)
    || ['temporarily unavailable', 'service unavailable', 'bad gateway', 'gateway timeout', 'too many requests', 'rate limit', 'overloaded', 'please retry', 'try again later']
      .some(needle => text.includes(needle))
}

function abortableDelay(ms: number, signal: AbortSignal, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new StoryError(code, '子代理调用被取消')); return }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(new StoryError(code, '子代理调用被取消')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
