/** Write a session's current work with the catalog as authority. */

import { clearCurrent, getCurrent, hydrate, setCurrent } from './current.ts'
import { clearSessionCurrent, readManifest, readSessionCurrent, setSessionCurrent } from './storage.ts'

/** Persist the binding, then update the cache only after the catalog accepts it. */
export async function writeCurrentBinding(root: string, sessionId: string, workId: string): Promise<string> {
  if (getCurrent(sessionId) === undefined) hydrate(readSessionCurrent(root))
  const manifest = await readManifest(root, workId)
  setSessionCurrent(root, sessionId, manifest.workId)
  setCurrent(sessionId, manifest.workId, { allowRebind: true })
  return manifest.workId
}

/** Clear the binding in the catalog before forgetting the cache. */
export function clearCurrentBinding(root: string, sessionId: string): void {
  clearSessionCurrent(root, sessionId)
  clearCurrent(sessionId)
}
