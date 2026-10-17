/**
 * Two-phase writes: stage every artifact, then commit it atomically.
 *
 * A crash between "wrote the body" and "wrote the manifest" used to leave a
 * half-written chapter. Staging keeps every file of one action off the real
 * tree until all of them are ready; the manifest is written last and is the
 * commit point.
 */

import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Staging directories older than this are leftovers from a crashed action. */
export const STALE_STAGE_MS = 24 * 60 * 60 * 1000

/**
 * A staged write set for one action.
 */
export class StagedWrite {
  /**
   * @param {string} workDir - the work's absolute directory.
   * @param {string} stageDir - absolute staging directory for this action.
   */
  constructor(workDir, stageDir) {
    this.workDir = workDir
    this.stageDir = stageDir
    /** @type {Map<string, string>} relative path → content */
    this.files = new Map()
    this.committed = false
  }

  /**
   * Buffer one file, keeping the work's relative layout.
   * @param {string} relativePath - path relative to the work directory, `/`-separated.
   * @param {string} content - full file content.
   * @returns {this} this stage, for chaining.
   */
  put(relativePath, content) {
    this.files.set(relativePath.replaceAll('\\', '/'), content)
    return this
  }

  /** Absolute destination of one staged path. */
  destination(relativePath) {
    return join(this.workDir, ...relativePath.split('/'))
  }

  /** Absolute staged path of one relative path. */
  staged(relativePath) {
    return join(this.stageDir, ...relativePath.split('/'))
  }

  /** Write every buffered file into the staging directory. */
  async materialize() {
    for (const [relativePath, content] of this.files) {
      const target = this.staged(relativePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
  }

  /**
   * Move every staged file onto its real path.
   *
   * `rename` replaces an existing file on Windows and POSIX; when the platform
   * refuses, the destination is removed first. The caller writes the manifest
   * only after this returns.
   */
  async commit() {
    for (const relativePath of this.files.keys()) {
      const from = this.staged(relativePath)
      const to = this.destination(relativePath)
      await mkdir(dirname(to), { recursive: true })
      try {
        await rename(from, to)
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
        await unlink(to).catch(() => {})
        await rename(from, to)
      }
    }
    this.committed = true
    await this.discard()
  }

  /** Remove whatever is left in the staging directory. */
  async discard() {
    await rm(this.stageDir, { recursive: true, force: true })
  }
}

/**
 * Open a staging directory for one action.
 * @param {string} workDir - the work's absolute directory.
 * @param {string} operation - short operation name, used in the directory name.
 * @returns {Promise<StagedWrite>} the staged write set.
 */
export async function openStage(workDir, operation) {
  const stageDir = join(workDir, '.staging', `${operation}-${Date.now()}`)
  await mkdir(stageDir, { recursive: true })
  return new StagedWrite(workDir, stageDir)
}

/**
 * Delete staging directories left behind by crashed actions.
 * @param {string} workDir - the work's absolute directory.
 * @param {number} [nowMs] - current time, injectable for tests.
 * @returns {Promise<number>} how many directories were removed.
 */
export async function cleanStaleStages(workDir, nowMs = Date.now()) {
  const root = join(workDir, '.staging')
  let names
  try {
    names = await readdir(root)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    const entry = join(root, name)
    try {
      const info = await stat(entry)
      if (nowMs - info.mtimeMs < STALE_STAGE_MS) continue
      await rm(entry, { recursive: true, force: true })
      removed += 1
    } catch {
      continue
    }
  }
  return removed
}
