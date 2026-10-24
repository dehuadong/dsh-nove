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

/** What the author and the model agreed to build before initializing a work. */
interface ProposalInput {
  title: string
  form?: string
  premise: string
  characters?: string
  conflict?: string
  notes?: string
}

/** One stored proposal as the catalog returns it. */
interface Proposal {
  id: string
  title: string
  form: string
  premise: string
  characters?: string
  conflict?: string
  notes?: string
  createdAt: string
  usedAt?: string
  usedWorkId?: string
}

/** @see createProposalRow */
export async function createProposal(root: string, input: ProposalInput): Promise<Proposal> {
  return createProposalRow(root, input)
}

/** @see readProposalRow */
export async function readProposal(root: string, id: string): Promise<Proposal> {
  // SQLite widens catalog columns to SQLOutputValue; every proposal column is TEXT.
  return readProposalRow(root, id) as Proposal
}

/** @see markProposalUsedRow */
export async function markProposalUsed(root: string, id: string, workId: string): Promise<{ id: string, workId: string }> {
  return markProposalUsedRow(root, id, workId)
}

/** @see listProposalRows */
export async function listProposals(root: string): Promise<Proposal[]> {
  // SQLite widens catalog columns to SQLOutputValue; every proposal column is TEXT.
  return listProposalRows(root) as Proposal[]
}

/** @see deleteProposalRow */
export async function deleteProposal(root: string, id: string): Promise<void> {
  return deleteProposalRow(root, id)
}

/** @see pruneProposalsRows */
export async function pruneProposals(root: string, ttlMs = PROPOSAL_TTL_MS): Promise<{ removed: number }> {
  return pruneProposalsRows(root, ttlMs)
}
