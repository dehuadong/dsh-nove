/**
 * Deterministic retrieval selection for role context.
 *
 * The work database owns the corpus and FTS ranking; this module builds the
 * query text, excerpts material hits, and selects whole candidate items within
 * per-kind and character budgets. No I/O and no model calls.
 */

/** Default number of retrieval hits sent into one context. */
export const RETRIEVAL_LIMIT = 5

/** Default character budget of the retrieval fragment texts. */
export const RETRIEVAL_BUDGET = 1200

/** Candidates kept in the trace from the ranked prefix. */
export const RETRIEVAL_SCAN_LIMIT = 10

/** Maximum sent items per kind. */
export const RETRIEVAL_PER_KIND = 2

/** Maximum trace hits: prefix plus every sent item. */
export const RETRIEVAL_HITS_LIMIT = 15

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
 * Build a bounded excerpt around the strongest query token.
 * @param {string} text - source text.
 * @param {string[]} tokens - query tokens from `searchTokens`.
 * @param {number} [max] - maximum excerpt length in code points.
 * @returns {string} excerpt.
 */
export function snippetFor(text, tokens, max = 400) {
  const limit = Number.isInteger(max) && max > 0 ? max : 400
  const source = String(text ?? '').replace(/\s+/gu, ' ').trim()
  if (source === '') return ''
  const all = [...new Set((tokens ?? []).map(token => String(token ?? '').toLowerCase()).filter(token => token !== ''))]
  const strong = all.filter(token => [...token].length >= 2)
  const anchors = (strong.length > 0 ? strong : all)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, 32)
  const lower = source.toLowerCase()
  let anchor = -1
  for (const token of anchors) {
    const index = lower.indexOf(token)
    if (index >= 0 && (anchor < 0 || index < anchor)) anchor = index
  }
  const start = anchor < 0 ? 0 : Math.max(0, anchor - 80)
  const chars = [...source]
  let excerpt = chars.slice(start, start + limit).join('').trim()
  if (start > 0) excerpt = `…${[...excerpt].slice(0, limit - 1).join('')}`
  if (start + limit < chars.length) excerpt = `${[...excerpt].slice(0, limit - 1).join('')}…`
  return [...excerpt].slice(0, limit).join('')
}

/**
 * Select candidates deterministically and fit them into the budget.
 * @param {Array<object>} candidates - candidates from `searchMemory`.
 * @param {object} [options] - selection options.
 * @param {Iterable<string>} [options.excludeIds] - ids already sent by another section.
 * @param {number} [options.limit] - maximum sent hits; capped at RETRIEVAL_LIMIT.
 * @param {number} [options.budget] - maximum total code points of fragment texts.
 * @param {number} [options.perKindLimit] - maximum sent items per kind.
 * @returns {{text: string, hits: object[], chars: number}} selected section.
 */
export function select(candidates, options = {}) {
  const exclude = new Set(options.excludeIds ?? [])
  const limit = Math.min(Number.isInteger(options.limit) && options.limit > 0 ? options.limit : RETRIEVAL_LIMIT, RETRIEVAL_LIMIT)
  const budget = Number.isInteger(options.budget) && options.budget > 0 ? options.budget : RETRIEVAL_BUDGET
  const perKindLimit = Number.isInteger(options.perKindLimit) && options.perKindLimit >= 0
    ? options.perKindLimit
    : RETRIEVAL_PER_KIND
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
  const byKind = new Map()
  let chars = 0
  for (const candidate of ordered) {
    if (sent.length >= limit) break
    const kind = String(candidate.kind ?? '')
    if ((byKind.get(kind) ?? 0) >= perKindLimit) continue
    const length = codePointLength(candidate.text)
    if (chars + length > budget) continue
    chars += length
    sent.push(candidate)
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  }
  const sentIds = new Set(sent.map(candidate => candidate.id))
  const rank = new Map(ordered.map((candidate, index) => [candidate.id, index]))
  const hitCandidates = [...ordered.slice(0, RETRIEVAL_SCAN_LIMIT)]
  for (const candidate of sent) {
    if (!hitCandidates.some(item => item.id === candidate.id)) hitCandidates.push(candidate)
  }
  hitCandidates.sort((left, right) => rank.get(left.id) - rank.get(right.id))
  const hits = hitCandidates.slice(0, RETRIEVAL_HITS_LIMIT).map(candidate => ({
    id: candidate.id,
    kind: candidate.kind,
    sourceIds: Array.isArray(candidate.sourceIds) ? candidate.sourceIds : [],
    score: Number(candidate.score ?? 0),
    sent: sentIds.has(candidate.id),
  }))
  const text = sent.map(candidate => `〔${candidate.id}〕${candidate.text.trim()}`).join('\n')
  return { text, hits, chars }
}
