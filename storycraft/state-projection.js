/**
 * Pure v2 state contract: hook/fact ops, their transitions, and projections.
 *
 * This module never reads or writes a work database, so the store can import
 * it without a cycle; `state-events.js` owns the store-facing append wrappers.
 * Events are the source; every projection is derived from them.
 */

import { createHash } from 'node:crypto'
import { StoryError, chapterNumber } from './domain.js'
import { assertHookTransition, validateFact, validateHook } from './artifact-contract.js'

/** Operations that only change hook metadata. */
export const HOOK_OPS = ['upsert', 'progress', 'mention', 'defer', 'resolve', 'supersede']

/** Operations that change the fact projection. */
export const FACT_OPS = ['upsert', 'expire']

/** Bounds of one settlement payload. */
export const STATE_LIMITS = { facts: 20, hooks: 30, newHooks: 8, text: 240 }

function invalid(message, code = 'state-op-invalid') {
  throw new StoryError(code, message)
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 必须是对象`)
  return value
}

function text(value, label, optional = false) {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.trim() === '') invalid(`${label} 必须是非空字符串`)
  return value.trim()
}

function boundedText(value, label, optional = false) {
  const trimmed = text(value, label, optional)
  if (trimmed === undefined) return undefined
  if ([...trimmed].length > STATE_LIMITS.text) invalid(`${label} 超过 ${STATE_LIMITS.text} 字`)
  return trimmed
}

function sortEvents(events) {
  return [...events].sort((left, right) => Number(left?.seq ?? 0) - Number(right?.seq ?? 0))
}

/** Mint the canonical hook identity from its display text. */
export function mintHookId(text) {
  const value = String(text ?? '').trim()
  if (value === '') invalid('新伏笔缺少 text')
  return `h-${createHash('sha1').update(value).digest('hex').slice(0, 8)}`
}

/** Project one hook event onto the map; unknown/legacy hook events are ignored. */
function applyHookEvent(hooks, event) {
  if (event.op === 'upsert') {
    const hook = object(event.hook, 'hook')
    const current = hooks.get(hook.hookId)
    hooks.set(hook.hookId, {
      ...(current ?? {}),
      ...hook,
      status: current?.status === undefined ? hook.status : current.status,
      lastAdvancedChapter: current?.lastAdvancedChapter === undefined
        ? hook.lastAdvancedChapter
        : current.lastAdvancedChapter,
    })
    return
  }
  const current = hooks.get(event.hookId)
  if (current === undefined || !['progress', 'mention', 'defer', 'resolve', 'supersede'].includes(event.op)) return
  hooks.set(event.hookId, hookTransition(current, event.op, Number(event.chapter)))
}

/** Project one fact event onto the active fact list. */
function applyFactEvent(facts, event) {
  if (event.op === 'upsert') {
    const fact = event.fact
    if (fact === undefined) return
    const active = facts.find(item => item.validUntilChapter === null
      && item.subject === fact.subject && item.predicate === fact.predicate && item.object === fact.object)
    if (active !== undefined) {
      active.sourceChapter = Number(event.chapter)
      return
    }
    facts.push({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      validFromChapter: Number(event.chapter),
      validUntilChapter: null,
      sourceChapter: Number(event.chapter),
    })
    return
  }
  if (event.op !== 'expire') return
  const selector = event.selector ?? {}
  for (const fact of facts) {
    if (fact.validUntilChapter !== null) continue
    if (selector.subject !== undefined && fact.subject !== selector.subject) continue
    if (selector.predicate !== undefined && fact.predicate !== selector.predicate) continue
    if (selector.object !== undefined && fact.object !== selector.object) continue
    fact.validUntilChapter = Number(event.chapter)
  }
}

/**
 * Fold new-contract hook/fact events into current projections.
 * Events without a v2 `op` are legacy and are ignored, never translated.
 * @param {object[]} events - event records, in any order.
 * @returns {{hooks: object[], facts: object[]}} projections.
 */
export function projectState(events = []) {
  const hooks = new Map()
  const facts = []
  for (const event of sortEvents(events)) {
    if (event?.kind === 'hook') applyHookEvent(hooks, event)
    else if (event?.kind === 'fact') applyFactEvent(facts, event)
  }
  return { hooks: [...hooks.values()], facts }
}

/** Project only hooks. */
export function projectHooks(events = []) {
  return projectState(events).hooks
}

/** Project only facts. */
export function projectFacts(events = []) {
  return projectState(events).facts
}

/** Build the validated upsert payload, keeping the existing status/metadata. */
function hookUpsert(input, current) {
  const raw = object(input.hook, 'hook')
  if (current === undefined && raw.status !== undefined && raw.status !== 'open') {
    invalid('新伏笔只能以 open 创建', 'hook-transition-invalid')
  }
  if (current !== undefined && raw.status !== undefined && raw.status !== current.status) {
    invalid(`hook upsert 不能改状态（${current.status} → ${raw.status}），状态只能走 op`, 'hook-transition-invalid')
  }
  return validateHook({
    ...(current ?? {}),
    ...raw,
    hookId: raw.hookId ?? current?.hookId,
    startChapter: raw.startChapter ?? current?.startChapter,
    type: raw.type ?? current?.type,
    status: raw.status ?? current?.status ?? 'open',
    lastAdvancedChapter: current?.lastAdvancedChapter ?? raw.startChapter ?? current?.startChapter,
    expectedPayoff: raw.expectedPayoff ?? current?.expectedPayoff ?? '',
    notes: raw.notes ?? current?.notes ?? '',
    dependsOn: raw.dependsOn ?? current?.dependsOn ?? [],
    text: raw.text ?? current?.text,
  })
}

/** Advance one hook by one non-upsert op. */
function hookTransition(current, op, chapter) {
  if (op === 'mention') return current
  if (op === 'progress') {
    if (!['open', 'progressing', 'deferred'].includes(current.status)) {
      invalid(`伏笔 ${current.hookId} 当前是 ${current.status}，不能 progress`, 'hook-transition-invalid')
    }
    return {
      ...current,
      status: 'progressing',
      lastAdvancedChapter: Math.max(current.lastAdvancedChapter ?? 0, chapter),
    }
  }
  const target = op === 'defer' ? 'deferred' : op === 'resolve' ? 'resolved' : 'superseded'
  assertHookTransition(current.status, target)
  return { ...current, status: target }
}

/** The status one non-upsert op targets. */
function targetStatus(op) {
  if (op === 'progress') return 'progressing'
  if (op === 'defer') return 'deferred'
  if (op === 'resolve') return 'resolved'
  if (op === 'supersede') return 'superseded'
  return undefined
}

/**
 * Apply one hook op to the current projection.
 * With `allowReapply`, an op whose target equals the current status is an
 * idempotent no-op (a reopened chapter settles again without re-declaring it),
 * and `mention` stays a no-op event.
 * @param {object[]} events - existing events.
 * @param {object} input - `{op, hook}` for upsert, `{op, hookId, chapter}` otherwise.
 * @param {{allowReapply?: boolean}} [options] - reapply rules.
 * @returns {{event: object|null, state: {hooks: object[], facts: object[]}}} event to append (null for a no-op) and the projection.
 */
export function applyHookOp(events, input, options = {}) {
  object(input, 'hook op')
  const op = String(input.op ?? '')
  if (!HOOK_OPS.includes(op)) invalid(`未知的 hook op：${op}`)
  const state = projectState(events)
  if (op === 'upsert') {
    const hookId = String(input.hook?.hookId ?? '')
    const current = state.hooks.find(hook => hook.hookId === hookId)
    const hook = hookUpsert(input, current)
    const event = { kind: 'hook', op, hook }
    return { event, state: projectState([...events, event]) }
  }
  const hookId = text(input.hookId, 'hookId')
  const chapter = chapterNumber(input.chapter)
  const current = state.hooks.find(hook => hook.hookId === hookId)
  if (current === undefined) invalid(`没有伏笔：${hookId}`, 'hook-not-found')
  if (options.allowReapply === true && targetStatus(op) === current.status) {
    return { event: null, state }
  }
  hookTransition(current, op, chapter)
  const event = { kind: 'hook', op, hookId, chapter }
  return { event, state: projectState([...events, event]) }
}

/** Build one projected fact from an upsert op. */
function factUpsert(input) {
  const raw = object(input.fact, 'fact')
  const chapter = chapterNumber(input.chapter)
  const fact = {
    subject: boundedText(raw.subject, 'fact.subject'),
    predicate: boundedText(raw.predicate, 'fact.predicate'),
    object: boundedText(raw.object, 'fact.object'),
    validFromChapter: chapter,
    validUntilChapter: null,
    sourceChapter: chapter,
  }
  return {
    fact: validateFact(fact),
    chapter,
    source: boundedText(input.source, 'fact.source', true),
  }
}

/**
 * Apply one fact op to the current projection.
 * @param {object[]} events - existing events.
 * @param {object} input - `{op, fact, chapter, source}` or `{op, selector, chapter}`.
 * @param {{allowReapply?: boolean}} [options] - reapply rules.
 * @returns {{event: object|null, state: {hooks: object[], facts: object[]}}} event to append (null for a no-op) and the projection.
 */
export function applyFactOp(events, input, options = {}) {
  object(input, 'fact op')
  const op = String(input.op ?? '')
  if (!FACT_OPS.includes(op)) invalid(`未知的 fact op：${op}`)
  const state = projectState(events)
  if (op === 'upsert') {
    const { fact, chapter, source } = factUpsert(input)
    const event = {
      kind: 'fact', op, chapter,
      ...(source === undefined ? {} : { source }),
      fact: { subject: fact.subject, predicate: fact.predicate, object: fact.object },
    }
    return { event, state: projectState([...events, event]) }
  }
  const selector = object(input.selector, 'selector')
  const chapter = chapterNumber(input.chapter)
  const active = state.facts.filter(fact => fact.validUntilChapter === null
    && fact.subject === text(selector.subject, 'selector.subject')
    && fact.predicate === text(selector.predicate, 'selector.predicate')
    && (selector.object === undefined || fact.object === text(selector.object, 'selector.object')))
  if (active.length === 0) {
    if (options.allowReapply === true) return { event: null, state }
    invalid('没有可失效的 fact', 'fact-not-found')
  }
  const event = {
    kind: 'fact', op, chapter,
    selector: {
      subject: selector.subject,
      predicate: selector.predicate,
      ...(selector.object === undefined ? {} : { object: selector.object }),
    },
  }
  return { event, state: projectState([...events, event]) }
}
