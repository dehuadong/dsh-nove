import { createHash } from 'node:crypto'

/**
 * The input a review is bound to: the chapter plan revision.
 *
 * Facts are out of the binding on purpose. Scoping them to earlier chapters
 * still let one chapter's settle invalidate another chapter's review in the
 * settle suite, so per-chapter fact binding needs its own design pass.
 * @param db - open work database.
 * @param chapter - chapter number.
 */
export function reviewInputOf(db: any, chapter: number): string {
  const plan = db.prepare('SELECT revision_id FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(`plan:${chapter}`)
  return createHash('sha256')
    .update(plan === undefined ? '' : String(plan.revision_id))
    .digest('hex')
}
