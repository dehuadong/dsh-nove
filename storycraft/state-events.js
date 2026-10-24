/**
 * Store-facing v2 state event helpers.
 *
 * The pure contract (ops, transitions, projections, hook id minting) lives in
 * `state-projection.js`; this module adds the append wrappers that read and
 * write the work event log. Legacy text-hook/string-fact events are ignored by
 * the v2 projection and never translated.
 */

import { readEvents, appendStateEvent } from './store-db.js'
import { applyFactOp, applyHookOp } from './state-projection.js'

export {
  FACT_OPS, HOOK_OPS, STATE_LIMITS, applyFactOp, applyHookOp, mintHookId,
  projectFacts, projectHooks, projectState,
} from './state-projection.js'

/** Append one hook op to the work's event log and return the new projection. */
export function appendHookOp(root, input, options = {}) {
  const work = String(input.work)
  const events = readEvents(root, work)
  const result = applyHookOp(events, input, options)
  if (result.event === null) return { ...result, seq: undefined }
  const chapter = result.event.op === 'upsert'
    ? result.event.hook.startChapter
    : result.event.chapter
  const { seq } = appendStateEvent(root, { work, chapter, kind: 'hook', payload: result.event })
  return { ...result, seq }
}

/** Append one fact op to the work's event log and return the new projection. */
export function appendFactOp(root, input, options = {}) {
  const work = String(input.work)
  const events = readEvents(root, work)
  const result = applyFactOp(events, input, options)
  if (result.event === null) return { ...result, seq: undefined }
  const { seq } = appendStateEvent(root, { work, chapter: result.event.chapter, kind: 'fact', payload: result.event })
  return { ...result, seq }
}
