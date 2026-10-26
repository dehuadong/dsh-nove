/**
 * Text size accounting shared by the context assembler and the brief.
 *
 * The package ships zero runtime dependencies and works offline, so there is no
 * tokenizer: sizes are estimated with a fixed, deterministic rule and the trace
 * says so. CJK characters count as one token each (the dominant case for this
 * product); every other four characters count as one.
 */

/** Unit every budget in this package speaks. */
export const BUDGET_UNIT = 'tokens'

/** One text's size in both units, so callers can show characters beside tokens. */
interface TextAccount {
  /** Characters as JavaScript counts them. */
  chars: number
  /** Estimated tokens. */
  tokens: number
}

/**
 * Estimate the tokens of one text.
 * @param text - arbitrary text.
 * @returns estimated token count.
 */
export function estimateTokens(text: string): number {
  if (text === '') return 0
  const cjk = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/**
 * Account one text in characters and estimated tokens.
 * @param text - arbitrary text.
 * @returns both sizes.
 */
export function accountOf(text: string): TextAccount {
  return { chars: text.length, tokens: estimateTokens(text) }
}

/**
 * Sum per-item accounts.
 * @param items - accounts, typically one per section.
 * @returns summed sizes.
 */
export function sumAccounts(items: ReadonlyArray<TextAccount>): TextAccount {
  return items.reduce((total, item) => ({
    chars: total.chars + item.chars,
    tokens: total.tokens + item.tokens,
  }), { chars: 0, tokens: 0 })
}
