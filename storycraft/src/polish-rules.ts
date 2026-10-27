/**
 * Deterministic polish rules: no model, no judgement, every change recorded.
 *
 * This layer stays mechanical on purpose: the reviser only handles what the rules
 * cannot see, and every rule change is recorded so a receipt can explain it.
 */

import { OPENERS } from './phrases.ts'

/** Openers that mark machine-written prose; removed only at a sentence start. */
export const BANNED_OPENERS = OPENERS

/** One recorded change; `kind` groups changes for the receipt. */
export interface PolishChange {
  readonly kind: 'opener' | 'ellipsis' | 'punctuation' | 'whitespace'
  readonly from: string
  readonly to: string
}

export interface PolishResult {
  readonly text: string
  readonly changes: PolishChange[]
}

const ELLIPSIS = '……'

/**
 * Apply the deterministic rules in one pass.
 * @param text - chapter text as stored.
 * @returns polished text plus the changes actually made.
 */
export function applyPolishRules(text: string): PolishResult {
  const changes: PolishChange[] = []
  let next = text

  for (const opener of BANNED_OPENERS) {
    const pattern = new RegExp(`(^|[。！？\\n])([ \\t]*)${opener}[，,]?`, 'gu')
    next = next.replace(pattern, (match, lead: string, indent: string) => {
      changes.push({ kind: 'opener', from: match.trim(), to: lead + indent })
      return lead + indent
    })
  }

  next = next.replace(/\.{3,}|。{3,}|…{1,2}/gu, (match) => {
    if (match === ELLIPSIS) return match
    changes.push({ kind: 'ellipsis', from: match, to: ELLIPSIS })
    return ELLIPSIS
  })

  next = next.replace(/([！？。，])\1+/gu, (match, mark: string) => {
    changes.push({ kind: 'punctuation', from: match, to: mark })
    return mark
  })

  next = next.replace(/[ \t]{2,}/gu, (match) => {
    changes.push({ kind: 'whitespace', from: match, to: ' ' })
    return ' '
  })

  return { text: next, changes }
}
