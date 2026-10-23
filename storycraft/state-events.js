/**
 * v2 state events: hook and fact events are the source; projections are rebuilt.
 *
 * This module owns only the v2 contract. The legacy text-hook / string-fact
 * path (`state-validation.js`, `foldState`, `state-check.js`, `state-settle.js`)
 * remains the operating contract until the long-form migration: it does not read
 * these events, and this module ignores its events instead of translating them.
 */

import { StoryError, chapterNumber } from './domain.js'
import {
  assertHookTransition, validateFact, validateHook,
} from './artifact-contract.js'
import { appendStateEvent, readEvents } from './store-db.js'

/** Operations that only change hook metadata. */
export const HOOK_OPS = ['upsert', 'progress', 'mention', 'defer', 'resolve', 'supersede']

/** Operations that change the fact projection. */
export const FACT_OPS = ['upsert', 'expire']

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

function sortEvents(events) {
  return [...events].sort((left, right) => Number(left?.seq ?? 0) - Number(right?.seq ?? 0))
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

/**
 * Apply one hook op to the current projection.
 * @param {object} input - `{op, hook}` for upsert, `{op, hookId, chapter}` otherwise.
 * @param {object[]} events - existing events.
 * @returns {{event: object, state: {hooks: object[], facts: object[]}}} the event to append and the new projection.
 */
export function applyHookOp(events, input) {
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
  hookTransition(current, op, chapter)
  const event = { kind: 'hook', op, hookId, chapter }
  return { event, state: projectState([...events, event]) }
}

/** Build one projected fact from an upsert op. */
function factUpsert(input) {
  const raw = object(input.fact, 'fact')
  const chapter = chapterNumber(input.chapter)
  const fact = {
    subject: text(raw.subject, 'fact.subject'),
    predicate: text(raw.predicate, 'fact.predicate'),
    object: text(raw.object, 'fact.object'),
    validFromChapter: chapter,
    validUntilChapter: null,
    sourceChapter: chapter,
  }
  return { fact: validateFact(fact), chapter, source: text(input.source, 'fact.source') }
}

/** Apply one fact op to the current projection. */
export function applyFactOp(events, input) {
  object(input, 'fact op')
  const op = String(input.op ?? '')
  if (!FACT_OPS.includes(op)) invalid(`未知的 fact op：${op}`)
  const state = projectState(events)
  if (op === 'upsert') {
    const { fact, chapter, source } = factUpsert(input)
    const event = {
      kind: 'fact', op, chapter, source,
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
  if (active.length === 0) invalid('没有可失效的 fact', 'fact-not-found')
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

/** Append one hook op to the work's event log and return the new projection. */
export function appendHookOp(root, input) {
  const work = String(input.work)
  const events = readEvents(root, work)
  const result = applyHookOp(events, input)
  const chapter = result.event.op === 'upsert'
    ? result.event.hook.startChapter
    : result.event.chapter
  const { seq } = appendStateEvent(root, { work, chapter, kind: 'hook', payload: result.event })
  return { ...result, seq }
}

/** Append one fact op to the work's event log and return the new projection. */
export function appendFactOp(root, input) {
  const work = String(input.work)
  const events = readEvents(root, work)
  const result = applyFactOp(events, input)
  const { seq } = appendStateEvent(root, { work, chapter: result.event.chapter, kind: 'fact', payload: result.event })
  return { ...result, seq }
}
