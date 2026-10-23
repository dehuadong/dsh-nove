/**
 * In-memory role-result submissions for one delegated child run.
 *
 * This is a transport seam, not work storage: the parent creates one bound
 * entry before starting the child, the child submits through `story_submit`,
 * and the parent consumes the accepted payload and lands it itself.
 */

import { randomUUID } from 'node:crypto'
import { StoryError, SUMMARY_MAX_CHARS, countWords, trimSummary } from './domain.js'
import { HOOK_STATES } from './state-validation.js'
import { assertRevisionMode } from './revision.js'
import { checkWordRange } from './landing.js'
import { readChapter } from './storage.js'

/** Entries live long enough for a slow child, never beyond the host run. */
const SUBMISSION_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 3
const MAX_PAYLOAD_BYTES = 64 * 1024

/** @type {Map<string, object>} */
const submissions = new Map()

/** Remove one expired entry. */
function purge(id, entry) {
  if (entry !== undefined && entry.expiresAt <= Date.now()) {
    submissions.delete(id)
    return undefined
  }
  return entry
}

/**
 * Bind role/work/chapter before starting the child.
 * @param {{role: string, workId: string, chapter: number, mode?: string, wordRange?: object}} input - delegation binding.
 * @returns {{delegationId: string, attempts: number}} identity handed to the child.
 */
export function openSubmission(input) {
  const delegationId = randomUUID()
  submissions.set(delegationId, {
    role: String(input.role),
    workId: String(input.workId),
    chapter: Number(input.chapter),
    ...(input.mode === undefined ? {} : { mode: String(input.mode) }),
    ...(input.wordRange === undefined ? {} : { wordRange: input.wordRange }),
    payload: undefined,
    attempts: 0,
    consumed: false,
    bytes: 0,
    expiresAt: Date.now() + SUBMISSION_TTL_MS,
  })
  return { delegationId, attempts: 0 }
}

/** Build a failure envelope the child can inspect and retry. */
function failure(code, message, extra = {}) {
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
export const STATE_CHECK_NO_EVIDENCE = '无对应段落'

/** State-check finding codes accepted by the validator role. */
const VALIDATOR_CODES = new Set([
  'fact-unsupported',
  'fact-ambiguous',
  'missing-change',
  'hook-state-mismatch',
  'hook-evidence-weak',
])

/** Per-field character caps for one validator finding. */
const VALIDATOR_LIMITS = { where: 120, problem: 160, evidence: 240, impact: 120, fix: 120 }

/** Settler delta bounds; the host still re-normalizes and validates it. */
const SETTLER_LIMITS = { entities: 30, facts: 20, hooks: 30, text: 240 }

/** Validate the role-specific payload shape. */
function validateShape(role, payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload 必须是对象'
  }
  if (role === 'writer') {
    if (typeof payload.title !== 'string' || payload.title.trim() === '') return 'writer 缺少 title'
    if (typeof payload.body !== 'string' || payload.body.trim() === '') return 'writer 缺少 body'
    return undefined
  }
  if (role === 'reviser') {
    if (typeof payload.body !== 'string' || payload.body.trim() === '') return 'reviser 缺少 body'
    return undefined
  }
  if (role === 'summarizer') {
    if (typeof payload.summary !== 'string' || payload.summary.trim() === '') return 'summarizer 缺少 summary'
    return undefined
  }
  if (role === 'settler') {
    if (!Array.isArray(payload.entities)) return 'settler 缺少 entities 数组'
    if (payload.entities.length > SETTLER_LIMITS.entities) return `settler entities 最多 ${SETTLER_LIMITS.entities} 条`
    for (const [index, entity] of payload.entities.entries()) {
      if (entity === null || typeof entity !== 'object') return `settler 第 ${index + 1} 个实体不是对象`
      if (typeof entity.name !== 'string' || entity.name.trim() === '') return `settler 第 ${index + 1} 个实体缺少 name`
      if ([...entity.name].length > SETTLER_LIMITS.text) return `settler 第 ${index + 1} 个实体 name 超过 ${SETTLER_LIMITS.text} 字`
      if (!Array.isArray(entity.facts)) return `settler 第 ${index + 1} 个实体缺少 facts 数组`
      if (entity.facts.length > SETTLER_LIMITS.facts) return `settler 第 ${index + 1} 个实体 facts 最多 ${SETTLER_LIMITS.facts} 条`
      for (const [factIndex, fact] of entity.facts.entries()) {
        if (typeof fact !== 'string' || fact.trim() === '') return `settler 第 ${index + 1} 个实体第 ${factIndex + 1} 条 fact 为空`
        if ([...fact].length > SETTLER_LIMITS.text) return `settler 第 ${index + 1} 个实体第 ${factIndex + 1} 条 fact 超过 ${SETTLER_LIMITS.text} 字`
      }
    }
    if (!Array.isArray(payload.hooks)) return 'settler 缺少 hooks 数组'
    if (payload.hooks.length > SETTLER_LIMITS.hooks) return `settler hooks 最多 ${SETTLER_LIMITS.hooks} 条`
    for (const [index, hook] of payload.hooks.entries()) {
      if (hook === null || typeof hook !== 'object') return `settler 第 ${index + 1} 条伏笔不是对象`
      if (typeof hook.text !== 'string' || hook.text.trim() === '') return `settler 第 ${index + 1} 条伏笔缺少 text`
      if ([...hook.text].length > SETTLER_LIMITS.text) return `settler 第 ${index + 1} 条伏笔 text 超过 ${SETTLER_LIMITS.text} 字`
      if (!HOOK_STATES.includes(hook.state)) return `settler 第 ${index + 1} 条伏笔 state 非法`
    }
    return undefined
  }
  if (role === 'validator') {
    if (!Array.isArray(payload.items)) return 'validator 缺少 items 数组'
    if (payload.items.length > 8) return 'validator items 最多 8 条'
    for (const [index, item] of payload.items.entries()) {
      if (item === null || typeof item !== 'object') return `validator 第 ${index + 1} 条不是对象`
      if (!VALIDATOR_CODES.has(item.code)) return `validator 第 ${index + 1} 条 code 非法`
      for (const key of ['where', 'problem', 'evidence', 'impact', 'fix']) {
        if (typeof item[key] !== 'string' || item[key].trim() === '') {
          return `validator 第 ${index + 1} 条缺少 ${key}`
        }
        if ([...item[key]].length > VALIDATOR_LIMITS[key]) {
          return `validator 第 ${index + 1} 条 ${key} 超过 ${VALIDATOR_LIMITS[key]} 字`
        }
      }
      if (item.code === 'missing-change' && item.evidence.trim() === STATE_CHECK_NO_EVIDENCE) {
        return `validator 第 ${index + 1} 条 missing-change 需要正文引文`
      }
      if (!['major', 'minor'].includes(item.severity)) {
        return `validator 第 ${index + 1} 条 severity 非法`
      }
    }
    return undefined
  }
  if (!Array.isArray(payload.items)) return 'reviewer 缺少 items 数组'
  if (payload.items.length > 8) return 'reviewer items 最多 8 条'
  for (const [index, item] of payload.items.entries()) {
    if (item === null || typeof item !== 'object') return `reviewer 第 ${index + 1} 条不是对象`
    for (const key of ['where', 'problem', 'fix']) {
      if (typeof item[key] !== 'string' || item[key].trim() === '') return `reviewer 第 ${index + 1} 条缺少 ${key}`
    }
    if (!['blocker', 'major', 'minor'].includes(item.severity)) return `reviewer 第 ${index + 1} 条 severity 非法`
    if (!['patch', 'polish', 'rewrite', 'deslop'].includes(item.mode)) return `reviewer 第 ${index + 1} 条 mode 非法`
  }
  return undefined
}

/**
 * Accept one submission from a child and validate it before consumption.
 * Validation failures are returned, not thrown, so the child keeps the
 * actionable values and can retry in the same run.
 * @param {{delegationId: string, payload: object, depth: number, root: string}} input - submission.
 * @returns {Promise<object>} success or retryable failure envelope.
 */
export async function submitPayload(input) {
  if (input.depth <= 0) return failure('submit-parent-denied', 'story_submit 只允许被派发的子代理调用')
  const id = String(input.delegationId)
  const entry = purge(id, submissions.get(id))
  if (entry === undefined) return failure('submit-unknown-delegation', 'delegationId 不存在或已过期')
  if (entry.consumed) return failure('submit-already-consumed', '该 delegationId 已提交')

  entry.attempts += 1
  if (entry.attempts > MAX_ATTEMPTS) return failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次`)

  const payload = input.payload
  const shapeError = validateShape(entry.role, payload)
  if (shapeError !== undefined) {
    return entry.attempts >= MAX_ATTEMPTS
      ? failure('submit-attempts-exhausted', `提交尝试超过 ${MAX_ATTEMPTS} 次：${shapeError}`)
      : failure('submit-invalid', shapeError, { retryable: true })
  }
  let bytes
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
    const { chars } = trimSummary(payload.summary)
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
        chapter: entry.chapter,
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
    let current
    try {
      current = readChapter(input.root, { work: entry.workId, chapter: entry.chapter }).content
      assertRevisionMode({ mode: entry.mode, chapter: entry.chapter, oldBody: current, body: payload.body })
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

/**
 * Consume the accepted payload; the caller must close the entry afterwards.
 * @param {string} delegationId - identity.
 * @returns {{payload: object, attempts: number, bytes: number}|undefined} accepted payload.
 */
export function consumeSubmission(delegationId) {
  const entry = purge(String(delegationId), submissions.get(String(delegationId)))
  if (entry === undefined) return undefined
  const result = { payload: entry.payload, attempts: entry.attempts, bytes: entry.bytes, consumed: entry.consumed === true }
  if (entry.consumed === true) submissions.delete(String(delegationId))
  return result
}

/** Remove one delegation entry in every outcome. */
export function closeSubmission(delegationId) {
  submissions.delete(String(delegationId))
}
