/**
 * Volumes: named chapter ranges with a short summary.
 *
 * A volume is content structure, not progress, so it lives under `bible/` next
 * to the other truth files and is written through the same staged commit path.
 */

import { join } from 'node:path'
import {
  StoryError, chapterNumber, commitFiles, readManifest, readOptional, workDirectory,
} from './storage.js'

/** Truth file that holds every volume of one work. */
const VOLUMES_FILE = 'bible/volumes.json'

/**
 * Read every volume of one work.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<Array<object>>} volumes, ascending by `from`.
 */
export async function readVolumes(root, workId) {
  const manifest = await readManifest(root, workId)
  const text = await readOptional(join(workDirectory(root, manifest.workId), VOLUMES_FILE))
  if (text === undefined || text.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StoryError('volume-invalid', 'bible/volumes.json 不是合法 JSON')
  }
  const volumes = Array.isArray(parsed) ? parsed : parsed?.volumes
  if (!Array.isArray(volumes)) throw new StoryError('volume-invalid', 'bible/volumes.json 必须是数组')
  return volumes.map(volume => ({ ...volume })).sort((left, right) => left.from - right.from)
}

/**
 * Validate one volume against the others and the manifest.
 * @param {object[]} volumes - existing volumes, excluding the one being written.
 * @param {object} candidate - the volume to write.
 * @param {object} manifest - work manifest.
 * @returns {void}
 */
function assertVolume(volumes, candidate, manifest) {
  const numbers = new Set(manifest.chapters.map(chapter => chapter.number))
  if (typeof candidate.title !== 'string' || candidate.title.trim() === '') {
    throw new StoryError('volume-invalid', '卷需要一个标题')
  }
  if (!Number.isInteger(candidate.from) || !Number.isInteger(candidate.to) || candidate.from > candidate.to) {
    throw new StoryError('volume-invalid', `卷 ${candidate.title} 的起止章不合法：${candidate.from}–${candidate.to}`)
  }
  for (const chapter of [candidate.from, candidate.to]) {
    if (!numbers.has(chapter)) {
      throw new StoryError('chapter-not-found', `第 ${chapter} 章不在进度清单里，不能分卷`)
    }
  }
  for (const other of volumes) {
    if (other.id === candidate.id) continue
    const overlap = candidate.from <= other.to && other.from <= candidate.to
    if (overlap) {
      throw new StoryError('volume-overlap',
        `卷「${candidate.title}」(${candidate.from}–${candidate.to}) 与「${other.title}」(${other.from}–${other.to}) 重叠`)
    }
  }
}

/**
 * Create or update one volume.
 * @param {string} root - workspace directory.
 * @param {{work: string, id?: string, title: string, from: number|string, to: number|string, summary?: string}} input - volume input.
 * @returns {Promise<{volumes: object[], volume: object}>} the whole set and the written volume.
 */
export async function writeVolume(root, input) {
  return (async () => {
    const manifest = await readManifest(root, input.work)
    const volumes = await readVolumes(root, manifest.workId)
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
    assertVolume(volumes.filter(volume => volume.id !== id), candidate, manifest)
    const next = volumes.filter(volume => volume.id !== id).concat(candidate).sort((left, right) => left.from - right.from)
    await commitFiles(root, manifest.workId, 'volumes', {
      [VOLUMES_FILE]: `${JSON.stringify({ volumes: next }, null, 2)}\n`,
    })
    return { volumes: next, volume: candidate }
  })()
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
