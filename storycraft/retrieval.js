/**
 * Deterministic retrieval selection for role context.
 *
 * The work database owns the corpus and FTS ranking; this module only builds
 * the query text and selects whole candidate items within a character budget.
 * No I/O and no model calls, so the same candidates always produce the same
 * section.
 */

/** Default number of retrieval hits sent into one context. */
export const RETRIEVAL_LIMIT = 5

/** Default character budget of the retrieval fragment texts. */
export const RETRIEVAL_BUDGET = 1200

/** Candidates scanned and kept in the trace; sent hits are always a prefix. */
export const RETRIEVAL_SCAN_LIMIT = 10

/** Author instructions longer than this are clipped before query building. */
export const QUERY_INSTRUCTION_LIMIT = 600

/**
 * Count Unicode code points, not UTF-16 units.
 * @param {string} text - input.
 * @returns {number} code point count.
 */
export function codePointLength(text) {
  return [...String(text ?? '')].length
}

/**
 * Build the deterministic query text for one role dispatch.
 * @param {object} input - query input.
 * @param {string} [input.taskText] - task composed by the action.
 * @param {string} [input.chapterPlan] - chapter plan text.
 * @param {Array<{text?: string}>} [input.openHooks] - unresolved hooks.
 * @param {string} [input.instruction] - author instruction.
 * @returns {string} query text, empty when there is nothing to search.
 */
export function buildQuery(input) {
  const parts = [
    String(input.taskText ?? '').trim(),
    String(input.chapterPlan ?? '').trim(),
    ...(Array.isArray(input.openHooks) ? input.openHooks.map(hook => String(hook?.text ?? '').trim()) : []),
    [...String(input.instruction ?? '').trim()].slice(0, QUERY_INSTRUCTION_LIMIT).join(''),
  ]
  return parts.filter(part => part !== '').join('\n')
}

/**
 * Select candidates deterministically and fit them into the budget.
 * @param {Array<object>} candidates - candidates from `searchMemory`.
 * @param {object} [options] - selection options.
 * @param {Iterable<string>} [options.excludeIds] - ids already sent by another section.
 * @param {number} [options.limit] - maximum sent hits.
 * @param {number} [options.budget] - maximum total code points of fragment texts.
 * @returns {{text: string, hits: object[], chars: number}} selected section.
 */
export function select(candidates, options = {}) {
  const exclude = new Set(options.excludeIds ?? [])
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : RETRIEVAL_LIMIT
  const budget = Number.isInteger(options.budget) && options.budget > 0 ? options.budget : RETRIEVAL_BUDGET
  const ordered = [...candidates]
    .filter(candidate => typeof candidate?.id === 'string' && !exclude.has(candidate.id))
    .filter(candidate => typeof candidate.text === 'string' && candidate.text.trim() !== '')
    .sort((left, right) => {
      const score = Number(right.score ?? 0) - Number(left.score ?? 0)
      if (score !== 0) return score
      const chapter = Number(right.chapter ?? 0) - Number(left.chapter ?? 0)
      if (chapter !== 0) return chapter
      return String(left.id).localeCompare(String(right.id))
    })

  const sent = []
  let chars = 0
  for (const [index, candidate] of ordered.entries()) {
    if (index >= RETRIEVAL_SCAN_LIMIT || sent.length >= limit) break
    const length = codePointLength(candidate.text)
    if (chars + length > budget) continue
    chars += length
    sent.push(candidate)
  }
  const sentIds = new Set(sent.map(candidate => candidate.id))
  const hits = ordered.slice(0, RETRIEVAL_SCAN_LIMIT).map(candidate => ({
    id: candidate.id,
    kind: candidate.kind,
    sourceIds: Array.isArray(candidate.sourceIds) ? candidate.sourceIds : [],
    score: Number(candidate.score ?? 0),
    sent: sentIds.has(candidate.id),
  }))
  const text = sent.map(candidate => `〔${candidate.id}〕${candidate.text.trim()}`).join('\n')
  return { text, hits, chars }
}
