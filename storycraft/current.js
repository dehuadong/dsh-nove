/**
 * The work a session is currently looking at.
 *
 * The workbench records it when the author enters a project, so actions can omit
 * `work` and still land on the right work. State is per session and lives in
 * memory only: a stale pointer would be worse than asking the author to re-enter.
 */

/** sessionId → workId. */
const current = new Map()

/**
 * Point a session at a work.
 * @param {string} sessionId - session identity.
 * @param {string} workId - work identity.
 * @returns {void}
 */
export function setCurrent(sessionId, workId) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  current.set(sessionId, String(workId))
}

/**
 * The work a session is looking at, if any.
 * @param {string} sessionId - session identity.
 * @returns {string|undefined} work identity.
 */
export function getCurrent(sessionId) {
  return typeof sessionId === 'string' ? current.get(sessionId) : undefined
}

/**
 * Forget a session's work.
 * @param {string} sessionId - session identity.
 * @returns {void}
 */
export function clearCurrent(sessionId) {
  if (typeof sessionId === 'string') current.delete(sessionId)
}

/**
 * Resolve the work an action should touch: an explicit id wins, then the
 * session's current work.
 * @param {string|undefined} sessionId - session identity.
 * @param {string|undefined} explicit - `work` from the action input.
 * @returns {string|undefined} the work id, if either source has one.
 */
export function resolveWork(sessionId, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  return getCurrent(sessionId)
}
