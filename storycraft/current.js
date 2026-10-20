/**
 * The work a session is currently looking at.
 *
 * The workbench records it when the author enters a project, so actions can omit
 * `work` and still land on the right work. The map is the in-memory cache for
 * `catalog.db`'s `session_current`: the host hydrates it after a restart; the
 * panel and a successful `story_init` write through the same single-row store.
 */

/** sessionId → workId. */
const current = new Map()
const hydrated = new Map()

/** Whether a session already attempted the persisted pointer read. */
export function shouldHydrate(sessionId, root) { const roots = hydrated.get(sessionId); return typeof sessionId === 'string' && sessionId !== '' && typeof root === 'string' && root !== '' && !(roots?.has(root) ?? false) }

/** Mark a session's hydrate attempt so a missing row is not reread per call. */
export function markHydrated(sessionId, root) { if (typeof sessionId !== 'string' || sessionId === '' || typeof root !== 'string' || root === '') return; const roots = hydrated.get(sessionId) ?? new Set(); roots.add(root); hydrated.set(sessionId, roots) }

/**
 * Point a session at a work.
 * @param {string} sessionId - session identity.
 * @param {string} workId - work identity.
 * @returns {void}
 */
export function setCurrent(sessionId, workId) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  current.set(sessionId, String(workId))
  hydrated.delete(sessionId)
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
  if (typeof sessionId === 'string') { current.delete(sessionId); hydrated.delete(sessionId) }
}


/**
 * Load persisted pointers, keeping newer in-memory entries.
 * @param {Record<string, string>} entries - persisted map.
 * @returns {void}
 */
export function hydrate(entries) {
  if (entries === null || typeof entries !== 'object') return
  for (const [sessionId, workId] of Object.entries(entries)) {
    if (typeof sessionId === 'string' && typeof workId === 'string' && !current.has(sessionId)) {
      current.set(sessionId, workId)
    }
  }
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
