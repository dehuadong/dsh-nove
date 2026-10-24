/**
 * The work a session is currently looking at.
 *
 * The workbench records it when the author enters a project, so actions can omit
 * `work` and still land on the right work. The map is the in-memory cache for
 * `catalog.db`'s `session_current`: the host hydrates it after a restart; the
 * panel and a successful `story_init` write through the same single-row store.
 */

/** sessionId → workId. */
const current = new Map<string, string>()
const hydrated = new Map<string, Set<string>>()

/** Whether a session already attempted the persisted pointer read. */
export function shouldHydrate(sessionId: unknown, root: unknown): boolean {
  const roots = typeof sessionId === 'string' ? hydrated.get(sessionId) : undefined
  return typeof sessionId === 'string' && sessionId !== '' && typeof root === 'string' && root !== '' && !(roots?.has(root) ?? false)
}

/** Mark a session's hydrate attempt so a missing row is not reread per call. */
export function markHydrated(sessionId: unknown, root: unknown): void { if (typeof sessionId !== 'string' || sessionId === '' || typeof root !== 'string' || root === '') return; const roots = hydrated.get(sessionId) ?? new Set(); roots.add(root); hydrated.set(sessionId, roots) }

/**
 * Point a session at a work.
 */
export function setCurrent(sessionId: unknown, workId: unknown): void {
  if (typeof sessionId !== 'string' || sessionId === '') return
  current.set(sessionId, String(workId))
  hydrated.delete(sessionId)
}

/**
 * The work a session is looking at, if any.
 */
export function getCurrent(sessionId: unknown): string | undefined {
  return typeof sessionId === 'string' ? current.get(sessionId) : undefined
}

/**
 * Forget a session's work.
 */
export function clearCurrent(sessionId: unknown): void {
  if (typeof sessionId === 'string') { current.delete(sessionId); hydrated.delete(sessionId) }
}


/**
 * Load persisted pointers, keeping newer in-memory entries.
 */
export function hydrate(entries: unknown): void {
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
 */
export function resolveWork(sessionId: unknown, explicit: unknown): string | undefined {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  return getCurrent(sessionId)
}
