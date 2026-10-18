/**
 * Project proposals: the bridge between free discussion and a work on disk.
 *
 * A proposal is not a work: it has no chapters, no manifest, and nothing in
 * `works/<id>/`. It records what the author and the model agreed to build, and
 * `story_init` refuses to start without one.
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { StoryError, now, readOptional, worksDirectory, writeAtomic } from './storage.js'

/** Directory that holds proposals, beside the works. */
export function proposalsDirectory(root) {
  return join(worksDirectory(root), '.proposals')
}

/** File name of one proposal. */
function proposalFile(root, id) {
  return join(proposalsDirectory(root), `${id}.json`)
}

/**
 * Write one proposal and return its id.
 * @param {string} root - workspace directory.
 * @param {{title: string, form: string, premise: string, characters?: string, conflict?: string, notes?: string}} input - proposal content.
 * @returns {Promise<object>} the stored proposal with its id.
 */
export async function createProposal(root, input) {
  const title = String(input.title ?? '').trim()
  if (title === '') throw new StoryError('proposal-invalid', '提案需要作品标题')
  const form = ['longform', 'short', 'script'].includes(input.form) ? input.form : 'longform'
  const premise = String(input.premise ?? '').trim()
  if (premise === '') throw new StoryError('proposal-invalid', '提案需要一句话前提或核心冲突')
  const id = `${slugOf(title)}-${String(Date.now())}`
  const proposal = {
    id,
    title,
    form,
    premise,
    ...(typeof input.characters === 'string' && input.characters.trim() !== ''
      ? { characters: input.characters.trim() }
      : {}),
    ...(typeof input.conflict === 'string' && input.conflict.trim() !== ''
      ? { conflict: input.conflict.trim() }
      : {}),
    ...(typeof input.notes === 'string' && input.notes.trim() !== '' ? { notes: input.notes.trim() } : {}),
    createdAt: now(),
  }
  await mkdir(proposalsDirectory(root), { recursive: true })
  await writeAtomic(proposalFile(root, id), `${JSON.stringify(proposal, null, 2)}\n`)
  return proposal
}

/**
 * Read one proposal.
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 * @returns {Promise<object>} the proposal.
 */
export async function readProposal(root, id) {
  const text = await readOptional(proposalFile(root, String(id)))
  if (text === undefined) {
    throw new StoryError('proposal-not-found', `没有提案 ${String(id)}：先和作者讨论并用 story_propose 落一份方案`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new StoryError('proposal-invalid', `提案 ${String(id)} 已损坏，重新写一份`)
  }
}

/**
 * List proposals, newest first.
 * @param {string} root - workspace directory.
 * @returns {Promise<object[]>} proposals.
 */
export async function listProposals(root) {
  let entries
  try {
    entries = await readdir(proposalsDirectory(root))
  } catch {
    return []
  }
  const proposals = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const text = await readOptional(join(proposalsDirectory(root), entry))
    if (text === undefined) continue
    try {
      proposals.push(JSON.parse(text))
    } catch {
      // A corrupt proposal is not a state the list must explain.
    }
  }
  return proposals.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

/**
 * Remove a proposal once its work exists (or the author drops it).
 * @param {string} root - workspace directory.
 * @param {string} id - proposal id.
 * @returns {Promise<void>} resolves after removal.
 */
export async function deleteProposal(root, id) {
  await rm(proposalFile(root, id), { force: true })
}

/** A file-safe slug of one title. */
function slugOf(title) {
  const ascii = String(title).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-').replace(/^-+|-+$/gu, '')
  return ascii === '' ? 'proposal' : ascii.slice(0, 40)
}
