/**
 * In-memory role-result submissions for one delegated child run.
 *
 * This is a transport seam, not work storage: the parent creates one bound
 * entry before starting the child, the child submits through `story_submit`,
 * and the parent consumes the accepted payload and lands it itself.
 */

import { randomUUID } from 'node:crypto'
import { StoryError, SUMMARY_FIELDS, SUMMARY_MAX_CHARS, countWords, trimSummary } from './domain.js'
import { STATE_LIMITS } from './state-projection.js'
import { assertRevisionMode } from './revision.js'
import {
  validateBookRules, validateRoleCard, validateRolesIndex, validateStoryFrame, validateVolumeMap,
} from './artifact-contract.js'
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
    chapter: input.chapter === undefined ? null : Number(input.chapter),
    ...(input.stage === undefined ? {} : { stage: String(input.stage) }),
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

/** Validate the role-specific payload shape. */
function validateShape(role, payload, stage) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload 必须是对象'
  }
  if (role === 'architect') {
    const stages = {
      frame: { keys: ['storyFrame', 'volumeMap', 'currentFocus'], label: 'frame' },
      rules: { keys: ['bookRules'], label: 'rules' },
      roles: { keys: ['rolesIndex'], label: 'roles' },
      cards: { keys: ['roleCards'], label: 'cards' },
    }
    const spec = stages[stage]
    if (spec === undefined) return `未知的 architect stage：${String(stage)}`
    for (const key of spec.keys) {
      if (payload[key] === undefined) return `architect ${spec.label} 缺少 ${key}`
    }
    for (const key of Object.keys(payload)) {
      if (!spec.keys.includes(key)) return `architect ${spec.label} 不接受字段 ${key}`
    }
    if (stage === 'frame') {
      for (const key of spec.keys) {
        if (typeof payload[key] !== 'string' || payload[key].trim() === '') return `architect frame 的 ${key} 必须是非空字符串`
      }
      if ([...payload.currentFocus].length > 600) return 'architect frame 的 currentFocus 超过 600 字'
    }
    if (stage === 'cards') {
      if (!Array.isArray(payload.roleCards) || payload.roleCards.length === 0) return 'architect cards 的 roleCards 必须是非空数组'
      if (payload.roleCards.length > 12) return 'architect cards 最多 12 张'
    }
    if (stage === 'roles' && Array.isArray(payload.rolesIndex?.roles) && payload.rolesIndex.roles.length > 20) {
      return 'architect roles 最多 20 人'
    }
    try {
      if (stage === 'frame') {
        validateStoryFrame(payload.storyFrame)
        validateVolumeMap(payload.volumeMap)
      } else if (stage === 'rules') {
        validateBookRules(payload.bookRules)
      } else if (stage === 'roles') {
        validateRolesIndex(payload.rolesIndex)
      } else {
        for (const card of payload.roleCards) validateRoleCard(card)
      }
    } catch (error) {
      return `architect ${spec.label} 不符合合同：${error?.message ?? String(error)}`
    }
    return undefined
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
    if (payload.rawText === undefined || typeof payload.rawText !== 'string' || payload.rawText.trim() === '') {
      return 'summarizer 缺少 rawText'
    }
    for (const field of SUMMARY_FIELDS) {
      if (payload[field] !== undefined && typeof payload[field] !== 'string') {
        return `summarizer 的 ${field} 必须是字符串`
      }
    }
    return undefined
  }
  if (role === 'settler') {
    const bounded = (value, label) => {
      if (typeof value !== 'string' || value.trim() === '') return `${label} 必须是非空字符串`
      if ([...value.trim()].length > STATE_LIMITS.text) return `${label} 超过 ${STATE_LIMITS.text} 字`
      return undefined
    }
    const factOps = payload.factOps
    const hookOps = payload.hookOps
    const newHooks = payload.newHooks
    for (const key of Object.keys(payload)) {
      if (!['factOps', 'hookOps', 'newHooks'].includes(key)) return `settler 不接受字段 ${key}`
    }
    if (factOps !== undefined && (factOps === null || typeof factOps !== 'object' || Array.isArray(factOps))) return 'factOps 必须是对象'
    if (hookOps !== undefined && (hookOps === null || typeof hookOps !== 'object' || Array.isArray(hookOps))) return 'hookOps 必须是对象'
    if (newHooks !== undefined && !Array.isArray(newHooks)) return 'newHooks 必须是数组'
    for (const key of Object.keys(factOps ?? {})) {
      if (!['upsert', 'expire'].includes(key)) return `factOps 不接受字段 ${key}`
    }
    for (const key of Object.keys(hookOps ?? {})) {
      if (!['progress', 'mention', 'defer', 'resolve', 'supersede'].includes(key)) return `hookOps 不接受字段 ${key}`
    }
    const upserts = factOps?.upsert ?? []
    const expires = factOps?.expire ?? []
    if (!Array.isArray(upserts) || !Array.isArray(expires)) return 'factOps.upsert/expire 必须是数组'
    if (upserts.length > STATE_LIMITS.facts) return `factOps.upsert 最多 ${STATE_LIMITS.facts} 条`
    if (expires.length > STATE_LIMITS.facts) return `factOps.expire 最多 ${STATE_LIMITS.facts} 条`
    for (const [index, fact] of upserts.entries()) {
      for (const key of ['subject', 'predicate', 'object']) {
        const problem = bounded(fact?.[key], `factOps.upsert 第 ${index + 1} 条 ${key}`)
        if (problem !== undefined) return problem
      }
      if (fact?.source !== undefined) {
        const problem = bounded(fact.source, `factOps.upsert 第 ${index + 1} 条 source`)
        if (problem !== undefined) return problem
      }
    }
    for (const [index, selector] of expires.entries()) {
      for (const key of ['subject', 'predicate']) {
        const problem = bounded(selector?.[key], `factOps.expire 第 ${index + 1} 条 ${key}`)
        if (problem !== undefined) return problem
      }
      if (selector?.object !== undefined) {
        const problem = bounded(selector.object, `factOps.expire 第 ${index + 1} 条 object`)
        if (problem !== undefined) return problem
      }
    }
    let transitions = 0
    for (const name of ['progress', 'mention', 'defer', 'resolve', 'supersede']) {
      const list = hookOps?.[name] ?? []
      if (!Array.isArray(list)) return `hookOps.${name} 必须是数组`
      for (const hookId of list) {
        const problem = bounded(hookId, `hookOps.${name} 的 hookId`)
        if (problem !== undefined) return problem
      }
      transitions += list.length
    }
    const candidates = newHooks ?? []
    if (transitions > STATE_LIMITS.hooks) return `hookOps 最多 ${STATE_LIMITS.hooks} 条`
    if (candidates.length > STATE_LIMITS.newHooks) return `newHooks 最多 ${STATE_LIMITS.newHooks} 条`
    for (const [index, candidate] of candidates.entries()) {
      const problem = bounded(candidate?.text, `newHooks 第 ${index + 1} 条 text`)
      if (problem !== undefined) return problem
      for (const key of ['type', 'expectedPayoff', 'notes']) {
        if (candidate?.[key] === undefined) continue
        const issue = bounded(candidate[key], `newHooks 第 ${index + 1} 条 ${key}`)
        if (issue !== undefined) return issue
      }
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
  const shapeError = validateShape(entry.role, payload, entry.stage)
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
