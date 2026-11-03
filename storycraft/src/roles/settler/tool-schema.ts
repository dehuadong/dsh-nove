/** Settler submission schema: factOps/hookOps/newHooks bounds and shapes. */

import { STATE_LIMITS } from '../../state-projection.ts'

/** Validate one settler payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
    const bounded = (value: unknown, label: string): string | undefined => {
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
