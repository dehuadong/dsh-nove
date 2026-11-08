/** Catalog-side writes: ideation proposals and the session current-work pointer. */

import { randomUUID } from 'node:crypto'
import { StoryError, WORK_FORMS, now } from '../../domain.ts'
import { openCatalog, transaction } from '../db.ts'
import { PROPOSAL_TTL_MS, requireCatalog } from './shared.ts'
// ---------------------------------------------------------------------------
// Proposals and session pointers (catalog)
// ---------------------------------------------------------------------------

/**
 * Create an ideation proposal in the catalog.
 * @param {string} root - workspace directory.
 * @param {{title: string, form?: string, premise: string, characters?: string, conflict?: string, notes?: string}} input - proposal.
 * @returns {{proposal: object}} stored proposal.
 */
export function createProposal(root: any, input: any) {
  const catalog = requireCatalog(root)
  try {
    return transaction(catalog, () => {
      const title = String(input.title ?? '').trim()
      if (title === '') throw new StoryError('proposal-invalid', '提案需要作品标题')
      const form = input.form === undefined ? 'longform' : String(input.form)
      if (!(WORK_FORMS as readonly string[]).includes(form)) throw new StoryError('proposal-invalid', `提案形态不合法：${form}`)
      const premise = String(input.premise ?? '').trim()
      if (premise === '') throw new StoryError('proposal-invalid', '提案需要一句话前提或核心冲突')
      const exists = catalog.prepare('SELECT 1 FROM works WHERE title = ? AND trashed_at IS NULL').get(title)
      if (exists !== undefined) throw new StoryError('work-exists', `作品已存在：${title}`)
      pruneProposalRows(catalog, PROPOSAL_TTL_MS)
      const id = `p-${randomUUID().slice(0, 8)}`
      const at = now()
      catalog.prepare(`INSERT INTO proposals (id, title, form, premise, characters, conflict, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, title, form, premise,
        input.characters ?? null, input.conflict ?? null, input.notes ?? null, at,
      )
      return { id, title, form, premise, createdAt: at }
    })
  } finally {
    catalog.close()
  }
}

/**
 * Read one proposal.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 * @returns {object} proposal.
 */
export function readProposal(root: any, id: any) {
  const catalog = openCatalog(root, { create: false })
  const row = catalog?.prepare('SELECT * FROM proposals WHERE id = ?').get(String(id))
  catalog?.close()
  if (row === undefined) throw new StoryError('proposal-not-found', `没有提案：${String(id)}`)
  return {
    id: row.id, title: row.title, form: row.form, premise: row.premise,
    ...(row.characters === null ? {} : { characters: row.characters }),
    ...(row.conflict === null ? {} : { conflict: row.conflict }),
    ...(row.notes === null ? {} : { notes: row.notes }),
    createdAt: row.created_at,
    ...(row.used_at === null ? {} : { usedAt: row.used_at, usedWorkId: row.used_work_id }),
  }
}

/**
 * Mark a proposal as used by a work.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 * @param {string} workId - the work it produced.
 * @returns {{id: string, workId: string}} receipt.
 */
export function markProposalUsed(root: any, id: any, workId: any) {
  const catalog = requireCatalog(root)
  try {
    return transaction(catalog, () => {
      catalog.prepare('UPDATE proposals SET used_at = ?, used_work_id = ? WHERE id = ?').run(now(), String(workId), String(id))
      return { id, workId }
    })
  } finally {
    catalog.close()
  }
}

/**
 * List proposals, newest first.
 * @param {string} root - workspace directory.
 * @returns {Array<object>} proposals.
 */
export function listProposals(root: any) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return []
  try {
    return catalog.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all().map(row => ({
      id: row.id,
      title: row.title,
      form: row.form,
      premise: row.premise,
      ...(row.characters === null ? {} : { characters: row.characters }),
      ...(row.conflict === null ? {} : { conflict: row.conflict }),
      ...(row.notes === null ? {} : { notes: row.notes }),
      createdAt: row.created_at,
      ...(row.used_at === null ? {} : { usedAt: row.used_at, workId: row.used_work_id }),
    }))
  } finally {
    catalog.close()
  }
}

/**
 * Remove one proposal.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 */
export function deleteProposal(root: any, id: any) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return
  try {
    transaction(catalog, () => catalog.prepare('DELETE FROM proposals WHERE id = ?').run(String(id)))
  } finally {
    catalog.close()
  }
}

/**
 * Delete unused proposals older than a TTL (caller owns the transaction).
 * @param {object} catalog - open catalog.
 * @param {number} ttlMs - age threshold.
 * @returns {number} rows removed.
 */
function pruneProposalRows(catalog: any, ttlMs: any) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString()
  return catalog.prepare('DELETE FROM proposals WHERE used_at IS NULL AND created_at < ?').run(cutoff).changes
}

/**
 * Prune unused proposals older than the TTL.
 * @param {string} root - workspace directory.
 * @param {number} ttlMs - age threshold.
 * @returns {{removed: number}} removal count.
 */
export function pruneProposals(root: any, ttlMs: any = PROPOSAL_TTL_MS) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return { removed: 0 }
  try {
    return transaction(catalog, () => ({ removed: pruneProposalRows(catalog, ttlMs) }))
  } finally {
    catalog.close()
  }
}

/**
 * Persist one session's current work without touching other rows.
 * @param {string} root - workspace directory.
 * @param {string} sessionId - session identity.
 * @param {string} workId - work identity.
 * @returns {{sessionId: string, workId: string}} stored pointer.
 */
export function setSessionCurrent(root: any, sessionId: any, workId: any, options: { expectedWorkId?: string | null } = {}) {
  const catalog = requireCatalog(root)
  try {
    return transaction(catalog, () => {
      const existing = catalog.prepare('SELECT work_id AS workId FROM session_current WHERE session_id = ?')
        .get(sessionId) as { workId: string } | undefined
      if (options.expectedWorkId !== undefined) {
        const current = existing?.workId ?? null
        if (current !== options.expectedWorkId) {
          throw new StoryError('work-binding-conflict',
            `会话绑定已变化：期望 ${String(options.expectedWorkId ?? '未绑定')}，实际 ${String(current ?? '未绑定')}`)
        }
      } else if (existing !== undefined && existing.workId !== workId) {
        throw new StoryError('work-binding-mismatch',
          `本会话已绑定作品 ${existing.workId}，不能再改绑 ${workId}：请为目标作品打开或新建会话`)
      }
      if (existing === undefined) {
        catalog.prepare('INSERT INTO session_current (session_id, work_id, updated_at) VALUES (?, ?, ?)')
          .run(sessionId, workId, now())
      } else if (existing.workId !== workId) {
        const result = catalog.prepare('UPDATE session_current SET work_id = ?, updated_at = ? WHERE session_id = ? AND work_id = ?')
          .run(workId, now(), sessionId, existing.workId)
        if (Number(result.changes) !== 1) {
          throw new StoryError('work-binding-conflict', '会话绑定在写入前已变化，请重试')
        }
      }
      return { sessionId, workId }
    })
  } finally {
    catalog.close()
  }
}

/**
 * Clear one session's current work without touching other rows.
 * @param {string} root - workspace directory.
 * @param {string} sessionId - session identity.
 * @returns {{removed: boolean}} whether a row was removed.
 */
export function clearSessionCurrent(root: any, sessionId: any) {
  const catalog = requireCatalog(root)
  try {
    const result = transaction(catalog, () => catalog.prepare('DELETE FROM session_current WHERE session_id = ?').run(sessionId))
    return { removed: Number(result.changes) > 0 }
  } finally {
    catalog.close()
  }
}

/**
 * Read the session→work map.
 * @param {string} root - workspace directory.
 * @returns {Record<string, string>} map, empty when the catalog is absent.
 */
export function readSessionCurrent(root: any) {
  const catalog = openCatalog(root, { create: false })
  if (catalog === undefined) return {}
  try {
    const out: Record<string, string> = {}
    for (const row of catalog.prepare('SELECT session_id, work_id FROM session_current').all()) {
      if (typeof row.work_id === 'string' && row.work_id !== '') out[String(row.session_id)] = String(row.work_id)
    }
    return out
  } finally {
    catalog.close()
  }
}

