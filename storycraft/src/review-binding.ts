import { createHash } from 'node:crypto'

/**
 * The input a review is bound to: the chapter plan revision plus a version of
 * the accumulated facts. A review is only current while both stay put.
 * @param db - open work database.
 * @param chapter - chapter number.
 */
export function reviewInputOf(db: any, chapter: number): string {
  const plan = db.prepare('SELECT revision_id FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(`plan:${chapter}`)
  // Facts are deliberately out of the binding for now: the events table is
  // global, so settling chapter 1 would mark chapter 2's review stale. Scoping
  // facts to the reviewed chapter is the follow-up.
  return createHash('sha256')
    .update(plan === undefined ? '' : String(plan.revision_id))
    .digest('hex')
}
