/**
 * Deterministic state-delta preflight for `story_state`.
 *
 * The module owns normalization and the hook state machine so the tool, the
 * store and the tests share one interpretation. Semantic validation (whether a
 * fact is supported by the chapter) is deliberately out of scope.
 */

import { StoryError } from './domain.js'

const HOOK_STATES = ['opened', 'used', 'resolved']

/**
 * Normalize a raw `story_state` delta without deduplicating facts.
 * Duplicate facts must survive so the validator can report them.
 * @param {{entities?: Array, hooks?: Array}} input - raw delta.
 * @returns {{entities: Array<{name: string, facts: string[]}>, hooks: Array<{text: string, state: string}>}} normalized delta.
 */
export function normalizeStateDelta(input) {
  const entities = []
  for (const [index, entity] of (Array.isArray(input?.entities) ? input.entities : []).entries()) {
    const name = String(entity?.name ?? '').trim()
    const rawFacts = typeof entity?.facts === 'string' ? [entity.facts] : entity?.facts
    const facts = Array.isArray(rawFacts) ? rawFacts.map(fact => String(fact).trim()).filter(Boolean) : []
    if (name === '' || facts.length === 0) {
      throw new StoryError('invalid-entity',
        `第 ${index + 1} 条人物${name === '' ? '' : `（${name}）`}的 facts 必须是非空字符串或字符串数组`)
    }
    entities.push({ name, facts })
  }

  const hooks = []
  for (const hook of (Array.isArray(input?.hooks) ? input.hooks : [])) {
    const text = String(hook?.text ?? '').trim()
    const state = String(hook?.state ?? '')
    if (text === '') throw new StoryError('invalid-hook', '伏笔需要非空描述')
    if (!HOOK_STATES.includes(state)) {
      throw new StoryError('invalid-hook-state', `伏笔状态只能是 opened/used/resolved，收到：${state}`)
    }
    hooks.push({ text, state })
  }

  return { entities, hooks }
}

/**
 * Validate a normalized delta against the folded state.
 * @param {{entities: Array, hooks: Array}} delta - normalized delta.
 * @param {{entities: Array, hooks: Array}} foldedBefore - current folded projection.
 * @returns {{warnings: string[]}} warnings; errors are thrown.
 */
export function validateStateDelta(delta, foldedBefore) {
  const warnings = []
  const knownFacts = new Map()
  for (const entity of foldedBefore?.entities ?? []) {
    knownFacts.set(entity.name, new Set((entity.facts ?? []).map(fact => String(fact).trim()).filter(Boolean)))
  }

  for (const entity of delta.entities) {
    const facts = knownFacts.get(entity.name) ?? new Set()
    for (const fact of entity.facts) {
      if (facts.has(fact)) {
        warnings.push(`duplicate-fact: ${entity.name} — 已存在「${fact}」`)
      } else {
        facts.add(fact)
      }
    }
    knownFacts.set(entity.name, facts)
  }

  const states = new Map()
  for (const hook of foldedBefore?.hooks ?? []) states.set(hook.text, hook.state)
  const seen = new Set()
  for (const hook of delta.hooks) {
    const current = states.get(hook.text)
    if (hook.state === 'opened') {
      if (seen.has(hook.text) || current === 'resolved') {
        throw new StoryError('duplicate-hook', `伏笔「${hook.text}」重复打开或已解决：不能再次 opened`)
      }
      states.set(hook.text, 'opened')
    } else if (hook.state === 'used') {
      if (current === undefined) {
        throw new StoryError('hook-not-open', `没有可标记为已用的伏笔：${hook.text}`)
      }
      if (current === 'resolved') {
        throw new StoryError('duplicate-hook', `伏笔「${hook.text}」已经解决：不能再标记为已用`)
      }
      states.set(hook.text, 'used')
    } else {
      if (current === undefined) throw new StoryError('hook-not-found', `没有可标记为已解的伏笔：${hook.text}`)
      if (current === 'resolved') throw new StoryError('duplicate-hook', `伏笔「${hook.text}」已经是 resolved`)
      states.set(hook.text, 'resolved')
    }
    seen.add(hook.text)
  }

  return { warnings }
}
