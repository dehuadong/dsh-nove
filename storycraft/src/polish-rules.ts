/**
 * Deterministic polish rules: no model, no judgement, every change recorded.
 *
 * The reference implementation keeps this layer mechanical (`polish/src/rules.ts`
 * in dsh-webnovel-writer); the reviser only handles what these rules cannot see.
 */

/** Openers that mark machine-written prose; removed only at a sentence start. */
export const BANNED_OPENERS = ['综上所述', '值得注意的是', '不可否认', '不难看出'] as const

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
    const pattern = new RegExp(`(^|[。！？\\n])\\s*${opener}[，,]?`, 'gu')
    next = next.replace(pattern, (match, lead: string) => {
      changes.push({ kind: 'opener', from: match.trim(), to: lead })
      return lead
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
