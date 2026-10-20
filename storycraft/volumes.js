/**
 * Volumes: named chapter ranges with a short summary.
 *
 * A volume is content structure, not progress, so it lives beside the truth
 * files inside the work database. Validation (chapter existence, overlap) runs
 * in the same transaction as the write.
 */

import { chapterNumber } from './domain.js'
import { readManifest, readVolumes as readVolumeRows, writeVolume as writeVolumeRow } from './store-db.js'

/**
 * Read every volume of one work.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<Array<object>>} volumes, ascending by `from`.
 */
export async function readVolumes(root, workId) {
  const manifest = readManifest(root, workId)
  return readVolumeRows(root, manifest.workId)
}

/**
 * Create or update one volume.
 * @param {string} root - workspace directory.
 * @param {{work: string, id?: string, title: string, from: number|string, to: number|string, summary?: string}} input - volume input.
 * @returns {Promise<{volumes: object[], volume: object}>} the whole set and the written volume.
 */
export async function writeVolume(root, input) {
  const manifest = readManifest(root, input.work)
  const volumes = readVolumeRows(root, manifest.workId)
  const id = typeof input.id === 'string' && input.id.trim() !== ''
    ? input.id.trim()
    : `v${volumes.length + 1}`
  const candidate = {
    id,
    title: String(input.title ?? '').trim(),
    from: Number(chapterNumber(input.from)),
    to: Number(chapterNumber(input.to)),
  }
  if (typeof input.summary === 'string' && input.summary.trim() !== '') candidate.summary = input.summary.trim()
  return writeVolumeRow(root, { work: manifest.workId, ...candidate, ...(candidate.summary === undefined ? {} : { summary: candidate.summary }) })
}

/**
 * The volume that owns one chapter.
 * @param {object[]} volumes - every volume of the work.
 * @param {number} chapter - chapter number.
 * @returns {object|undefined} the owning volume.
 */
export function volumeOf(volumes, chapter) {
  return volumes.find(volume => chapter >= volume.from && chapter <= volume.to)
}
