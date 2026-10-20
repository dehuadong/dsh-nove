/**
 * Project proposals: the bridge between free discussion and a work.
 *
 * A proposal is not a work: it has no chapters and no work database. It lives in
 * `catalog.db` beside the works, records what the author and the model agreed to
 * build, and `story_init` refuses to start without one.
 */

import {
  PROPOSAL_TTL_MS,
  createProposal as createProposalRow,
  deleteProposal as deleteProposalRow,
  listProposals as listProposalRows,
  markProposalUsed as markProposalUsedRow,
  pruneProposals as pruneProposalsRows,
  readProposal as readProposalRow,
} from './store-db.js'

export { PROPOSAL_TTL_MS }

/** @see createProposalRow */
export async function createProposal(root, input) {
  return createProposalRow(root, input)
}

/** @see readProposalRow */
export async function readProposal(root, id) {
  return readProposalRow(root, id)
}

/** @see markProposalUsedRow */
export async function markProposalUsed(root, id, workId) {
  return markProposalUsedRow(root, id, workId)
}

/** @see listProposalRows */
export async function listProposals(root) {
  return listProposalRows(root)
}

/** @see deleteProposalRow */
export async function deleteProposal(root, id) {
  return deleteProposalRow(root, id)
}

/** @see pruneProposalsRows */
export async function pruneProposals(root, ttlMs = PROPOSAL_TTL_MS) {
  return pruneProposalsRows(root, ttlMs)
}
