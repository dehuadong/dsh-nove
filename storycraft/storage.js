/**
 * Work storage for the Storycraft long-form line.
 *
 * One work is one directory under `<workspace>/works/<workId>/`. Files are the
 * only source of truth; every action writes its artifacts first and the manifest
 * last, and rolls its artifacts back when the manifest cannot be committed, so
 * a failed action never leaves a half-consistent work behind.
 *
 * Concurrency: a mutating action holds `<works>/.<workId>.lock` for its whole
 * read-modify-write cycle, and the manifest commit rejects when another writer
 * advanced `updatedAt` in between. Two windows fail loudly instead of
 * overwriting each other.
 *
 * Every returned path is relative to the workspace root and uses `/`.
 */

import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { cleanStaleStages, openStage } from './stage.js'
import { critique } from './critique.js'

/** Directory (inside the workspace) that holds every work. */
export const WORKS_DIRNAME = 'works'

/** Manifest structure version this module writes and understands. */
export const MANIFEST_VERSION = 1

/** Age after which an abandoned write lock may be taken over. */
const STALE_LOCK_MS = 10 * 60 * 1000

/** Failure carrying a stable code for the actions' structured results. */
export class StoryError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - user-facing message.
   */
  constructor(code, message) {
    super(message)
    this.name = 'StoryError'
    this.code = code
  }
}

/**
 * Absolute works directory for a workspace root.
 * @param {string} root - workspace directory.
 * @returns {string} `<root>/works`.
 */
export function worksDirectory(root) {
  return join(resolve(root), WORKS_DIRNAME)
}

/**
 * A work's absolute directory, rejecting ids that could escape the works directory.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {string} the work directory.
 */
export function workDirectory(root, workId) {
  if (typeof workId !== 'string' || !/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}-]*$/u.test(workId)) {
    throw new StoryError('invalid-work', `作品 id 不合法：${String(workId)}`)
  }
  return join(worksDirectory(root), workId)
}

/**
 * A path as the workbench and git see it: relative to the workspace, `/` separated.
 * @param {string} root - workspace directory.
 * @param {string} file - absolute path inside the workspace.
 * @returns {string} the relative path.
 */
export function rootRelative(root, file) {
  return relative(resolve(root), file).split('\\').join('/')
}

/**
 * Turn a title into a directory-safe identity.
 * @param {string} title - work title.
 * @returns {string} lowercase kebab slug; falls back to `work`.
 */
/** Forms a work may declare; the form is data on the work, not a preset. */
export const WORK_FORMS = ['longform', 'short', 'script']

/**
 * The form of one work, defaulting to the long-form flow for older works.
 * @param {object} manifest - work manifest.
 * @returns {'longform'|'short'|'script'} the form.
 */
/**
 * The unit one form calls its chapters: 章 / 篇 / 集.
 * @param {string} form - work form.
 * @returns {string} unit noun.
 */
export function unitOf(form) {
  if (form === 'script') return '集'
  if (form === 'short') return '篇'
  return '章'
}

export function formOf(manifest) {
  return WORK_FORMS.includes(manifest?.form) ? manifest.form : 'longform'
}

export function slugify(title) {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'work' : slug
}

/** Today's ISO timestamp. */
export function now() {
  return new Date().toISOString()
}

/** Zero-padded chapter file stem: 1 → `ch-0001`. */
export function chapterStem(number) {
  return `ch-${String(number).padStart(4, '0')}`
}

/**
 * Parse a chapter number.
 * @param {unknown} value - model-supplied chapter number.
 * @returns {number} a positive integer.
 */
export function chapterNumber(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new StoryError('invalid-chapter', `章号必须是正整数，收到：${String(value)}`)
  }
  return number
}

/**
 * The ordered stage of one chapter. Stages only move forward unless a settled
 * chapter is explicitly reopened.
 */
export const STAGES = ['planned', 'written', 'reviewed', 'revised', 'settled']

/**
 * Read a chapter's stage, falling back to the legacy `status` field.
 * @param {object} entry - chapter entry.
 * @returns {string} one of {@link STAGES}.
 */
export function stageOf(entry) {
  if (entry !== null && typeof entry === 'object' && STAGES.includes(entry.stage)) return entry.stage
  const legacy = entry?.status
  return STAGES.includes(legacy) ? legacy : 'planned'
}

/**
 * Infer a stage from the artifacts on disk, for manifests written before the
 * stage field existed. A settle event wins; otherwise the furthest artifact
 * decides. Inferred stages persist on the next manifest write.
 * @param {{settled: boolean, review: string|undefined, body: boolean}} artifacts - observed artifacts.
 * @returns {string} inferred stage.
 */
function inferStage(artifacts) {
  if (artifacts.settled) return 'settled'
  const items = artifacts.review === undefined ? [] : parseReview(artifacts.review)
  if (items.length > 0 && items.every(item => item.done)) return 'revised'
  if (items.length > 0) return 'reviewed'
  if (artifacts.body) return 'written'
  return 'planned'
}

/**
 * Refuse an action whose stage precondition is not met.
 * @param {object} entry - chapter entry.
 * @param {string[]} allowed - stages the action accepts.
 * @param {string} message - failure message naming the next step.
 * @param {string} code - failure code.
 * @returns {void}
 */
function assertStage(entry, allowed, message, code = 'chapter-settled') {
  if (allowed.includes(stageOf(entry))) return
  throw new StoryError(code, message)
}

/**
 * Count characters of the body (CJK-aware: whitespace is excluded).
 * @param {string} text - body text.
 * @returns {number} character count.
 */
export function countWords(text) {
  const cjk = String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latin = String(text).match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0
  return cjk + latin
}

/**
 * Read a file, or undefined when it does not exist.
 * @param {string} file - absolute path.
 * @returns {Promise<string|undefined>} contents.
 */
export async function readOptional(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Write a file atomically: same-directory temp file, then rename.
 * @param {string} file - absolute target.
 * @param {string} text - contents.
 */
export async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true })
  const temp = join(dirname(file), `.${basename(file)}.tmp-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(temp, text, 'utf8')
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/**
 * Run one mutating action under the work's single-writer lock.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {() => Promise<T>} action - work to run.
 * @returns {Promise<T>} the action's value.
 * @template T
 */
export async function withWorkLock(root, workId, action) {
  const lock = await acquireWorkLock(root, workId)
  try {
    return await action(lock)
  } finally {
    await lock.release()
  }
}

/**
 * Acquire one work's single-writer lock.
 *
 * The returned handle can follow a rename: the lock path is the identity other
 * writers test, so a renamed work must carry its lock to the new path before the
 * old one is released.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<{release: () => Promise<void>, moveTo: (nextId: string) => Promise<void>}>} the handle.
 */
export async function acquireWorkLock(root, workId) {
  await mkdir(worksDirectory(root), { recursive: true })
  let lockPath = join(worksDirectory(root), `.${workId}.lock`)
  const tryOpen = () => open(lockPath, 'wx')
  let handle
  try {
    handle = await tryOpen()
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    // A crashed action can leave its lock behind; only an old lock is taken over.
    const age = await stat(lockPath).then(info => Date.now() - info.mtimeMs).catch(() => undefined)
    if (age === undefined || age < STALE_LOCK_MS) {
      throw new StoryError('work-busy', `作品 ${workId} 正在被另一个动作写入，请稍后重试`)
    }
    await rm(lockPath, { force: true })
    handle = await tryOpen().catch(() => {
      throw new StoryError('work-busy', `作品 ${workId} 正被另一个动作接管，请稍后重试`)
    })
  }
  return {
    async moveTo(nextId) {
      const next = join(worksDirectory(root), `.${nextId}.lock`)
      await rename(lockPath, next)
      lockPath = next
    },
    async release() {
      await handle.close().catch(() => {})
      await rm(lockPath, { force: true }).catch(() => {})
    },
  }
}

/**
 * Run a mutation that writes files before the manifest, undoing those files
 * when the mutation fails. Restores overwritten files from the given backups.
 * @param {{undo: Array<() => Promise<void>>}} journal - rollback entries, newest last.
 * @param {() => Promise<T>} action - mutation to run.
 * @returns {Promise<T>} the mutation's value.
 * @template T
 */
async function withRollback(journal, action) {
  try {
    return await action()
  } catch (error) {
    for (const undo of [...journal.undo].reverse()) {
      await undo().catch(() => {})
    }
    throw error
  }
}

/**
 * Read and validate a work's manifest.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<object>} the manifest.
 */
export async function readManifest(root, workId) {
  const text = await readOptional(join(workDirectory(root, workId), 'manifest.json'))
  if (text === undefined) throw new StoryError('work-not-found', `没有找到作品：${workId}`)
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new StoryError('manifest-invalid', `作品 ${workId} 的进度清单不是合法 JSON`)
  }
  if (manifest?.version !== MANIFEST_VERSION || !Array.isArray(manifest?.chapters)) {
    throw new StoryError('manifest-invalid', `作品 ${workId} 的进度清单版本不受支持`)
  }
  const dir = workDirectory(root, workId)
  const events = (await readOptional(join(dir, 'state', 'events.jsonl'))) ?? ''
  const settled = new Set()
  for (const line of events.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const event = JSON.parse(line)
      if (event?.kind === 'settle' && Number.isInteger(event.chapter)) settled.add(event.chapter)
      if (event?.kind === 'reopen' && Number.isInteger(event.chapter)) settled.delete(event.chapter)
    } catch {
      continue
    }
  }
  for (const entry of manifest.chapters) {
    if (STAGES.includes(entry.stage)) continue
    const review = await latestReview(root, manifest, entry)
    const current = reviewCoversRevision(review, entry, true)
    entry.stage = inferStage({ settled: settled.has(entry.number), review: current ? review.text : undefined, body: entry.currentRevision > 0 })
  }
  return manifest
}

/**
 * Stage a set of files and commit them in one pass.
 *
 * The manifest is never among them: callers write it after this returns, so the
 * commit point stays the manifest and a crash before it leaves the work intact.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {string} operation - short name used in the staging directory.
 * @param {Record<string, string>} files - work-relative path → content.
 * @returns {Promise<void>} resolves after the commit.
 */
export async function commitFiles(root, workId, operation, files, hooks = {}) {
  const workDir = workDirectory(root, workId)
  const cleaned = await cleanStaleStages(workDir)
  // Validate the staged set before anything touches the real tree: an escaping
  // path or an empty artifact is a caller bug, not a user error.
  for (const [relativePath, content] of Object.entries(files)) {
    const normalized = String(relativePath).replaceAll('\\', '/')
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new StoryError('invalid-path', `暂存路径非法：${relativePath}`)
    }
    // Empty content is a legitimate artifact (an author may clear intent.md);
    // a non-string is not.
    if (typeof content !== 'string') {
      throw new StoryError('invalid-artifact', `暂存内容不是字符串：${relativePath}`)
    }
  }
  const stage = await openStage(workDir, operation)
  try {
    for (const [relativePath, content] of Object.entries(files)) stage.put(relativePath, content)
    await stage.materialize()
    // The staged set must equal the planned set: a missing file means the write
    // silently did not happen.
    for (const relativePath of Object.keys(files)) {
      if (await readOptional(stage.staged(relativePath)) === undefined) {
        throw new StoryError('stage-incomplete', `暂存文件缺失：${relativePath}`)
      }
    }
    if (typeof hooks.beforeCommit === 'function') await hooks.beforeCommit(stage)
    await stage.commit()
    return { cleaned }
  } catch (error) {
    await stage.discard()
    throw error
  }
}

/** Append one event line to a JSONL text without touching the disk. */
function appendEventLine(previous, event) {
  const seq = previous.split(/\r?\n/).filter(line => line.trim() !== '').length + 1
  const line = JSON.stringify({ seq, at: now(), ...event })
  return previous === '' || previous.endsWith('\n') ? `${previous}${line}\n` : `${previous}\n${line}\n`
}

/** Work-relative path with forward slashes. */
function relativeToWork(workDir, file) {
  return relative(workDir, file).replaceAll('\\', '/')
}

/**
 * Recompute the derived projection of one work.
 *
 * It duplicates nothing the manifest owns: stages, revisions and word counts are
 * copied, the review and hook counts are folded from artifacts. Reading it back
 * is cheaper than rescanning every review, and deleting it loses nothing.
 * @param {string} root - workspace directory.
 * @param {object} manifest - work manifest with a current `updatedAt`.
 * @returns {Promise<object>} the projection payload.
 */
async function computeProjection(root, manifest) {
  const dir = workDirectory(root, manifest.workId)
  const events = (await readOptional(join(dir, 'state', 'events.jsonl'))) ?? ''
  const folded = foldEvents(events)
  let openProblems = 0
  for (const chapter of manifest.chapters) {
    const latest = await latestReview(root, manifest, chapter)
    if (latest !== undefined) openProblems += parseReview(latest.text).filter(item => !item.done).length
  }
  const written = manifest.chapters.filter(chapter => chapter.currentRevision > 0)
  return {
    manifestUpdatedAt: manifest.updatedAt,
    chapters: manifest.chapters.map(chapter => ({
      number: chapter.number,
      stage: stageOf(chapter),
      revision: chapter.currentRevision,
      words: chapter.words,
    })),
    writtenChapters: written.length,
    words: manifest.chapters.reduce((sum, chapter) => sum + (chapter.words ?? 0), 0),
    latestChapter: manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number,
    openProblems,
    hooks: {
      opened: folded.hooks.filter(hook => hook.state === 'opened').length,
      used: folded.hooks.filter(hook => hook.state === 'used').length,
      resolved: folded.hooks.filter(hook => hook.state === 'resolved').length,
      open: folded.hooks.filter(hook => hook.state !== 'resolved').length,
    },
    events: events.split(/\r?\n/).filter(line => line.trim() !== '').length,
    updatedAt: now(),
  }
}

/**
 * Read one work's projection, rebuilding it when absent or stale.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<object>} the projection.
 */
export async function readProjection(root, workId) {
  const manifest = await readManifest(root, workId)
  const file = join(workDirectory(root, manifest.workId), 'state', 'projection.json')
  const text = await readOptional(file)
  const eventsFile = join(workDirectory(root, manifest.workId), 'state', 'events.jsonl')
  const eventLines = ((await readOptional(eventsFile)) ?? '').split(/\r?\n/).filter(line => line.trim() !== '').length
  if (text !== undefined) {
    try {
      const parsed = JSON.parse(text)
      // Both the manifest stamp and the event count decide freshness: a crash
      // between the events commit and the manifest write matches neither.
      if (parsed?.manifestUpdatedAt === manifest.updatedAt && parsed?.events === eventLines) return parsed
    } catch {
      // A corrupt projection is just a stale one.
    }
  }
  const rebuilt = await computeProjection(root, manifest)
  await writeAtomic(file, `${JSON.stringify(rebuilt, null, 2)}\n`).catch(() => {})
  return rebuilt
}

/**
 * Write a manifest after its artifacts are on disk.
 *
 * The commit is rejected when another writer advanced the manifest since this
 * action read it: last-write-wins is exactly the silent loss the lock prevents.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {object} manifest - manifest as this action read and modified it.
 * @returns {Promise<object>} the persisted manifest.
 */
async function writeManifest(root, workId, manifest) {
  const file = join(workDirectory(root, workId), 'manifest.json')
  const current = await readOptional(file)
  if (current !== undefined) {
    let parsed
    try {
      parsed = JSON.parse(current)
    } catch {
      throw new StoryError('manifest-invalid', `作品 ${workId} 的进度清单不是合法 JSON`)
    }
    if (parsed.updatedAt !== manifest.updatedAt) {
      throw new StoryError('work-busy', `作品 ${workId} 在本次动作期间被改动，请重试`)
    }
  }
  const next = { ...manifest, updatedAt: now() }
  await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
  // The projection is derived: a failure here costs a rebuild, not correctness.
  const projection = await computeProjection(root, next).catch(() => undefined)
  if (projection !== undefined) {
    await writeAtomic(join(workDirectory(root, next.workId), 'state', 'projection.json'), `${JSON.stringify(projection, null, 2)}\n`).catch(() => {})
  }
  return next
}

/** The chapter entry for a number, creating it when absent. */
function chapterEntry(manifest, number) {
  let entry = manifest.chapters.find(chapter => chapter.number === number)
  if (entry === undefined) {
    entry = {
      id: chapterStem(number),
      number,
      title: '',
      status: 'planned',
      currentRevision: 0,
      words: 0,
      updatedAt: now(),
    }
    manifest.chapters.push(entry)
    manifest.chapters.sort((left, right) => left.number - right.number)
  }
  return entry
}

/**
 * Recompute the manifest's derived counters from the files on disk.
 * @param {string} root - workspace directory.
 * @param {object} manifest - manifest to refresh (mutated).
 * @returns {Promise<void>} resolves once the counters describe the files.
 */
async function refreshCounters(root, manifest) {
  let reviewRounds = 0
  let openProblems = 0
  for (const chapter of manifest.chapters) {
    reviewRounds += await reviewRoundsOf(root, manifest, chapter)
    const latest = await latestReview(root, manifest, chapter)
    if (latest !== undefined) openProblems += parseReview(latest.text).filter(item => !item.done).length
  }
  manifest.counters = { reviewRounds, openProblems }
}

/**
 * Create a work skeleton. An existing work under the same id is refused, so a
 * repeated init never touches a work that already has content.
 * @param {string} root - workspace directory.
 * @param {{title: string, workId?: string, form?: string, tags?: string[]}} input - creation input.
 * @returns {Promise<{workId: string, path: string, manifest: object}>} the created work.
 */
export async function initWork(root, input) {
  const form = input?.form === undefined ? 'longform' : String(input.form)
  if (!WORK_FORMS.includes(form)) {
    throw new StoryError('form-invalid', `作品形态只能是 ${WORK_FORMS.join(' / ')}：收到 ${String(input.form)}`)
  }
  const range = input?.wordRange
  if (range !== undefined) {
    const min = Number(range?.min)
    const max = Number(range?.max)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min) {
      throw new StoryError('word-range-invalid', `字数范围不合法：${JSON.stringify(range)}`)
    }
  }
  const title = String(input?.title ?? '').trim()
  if (title === '') throw new StoryError('invalid-title', '作品标题不能为空')
  const workId = typeof input?.workId === 'string' && input.workId.trim() !== ''
    ? input.workId.trim().toLowerCase()
    : slugify(title)
  return withWorkLock(root, workId, async () => {
    const dir = workDirectory(root, workId)
    try {
      await stat(dir)
      throw new StoryError('work-exists', `已经有一部作品用这个 id：${workId}；换个标题或显式传 workId`)
    } catch (error) {
      if (error instanceof StoryError) throw error
      if (error?.code !== 'ENOENT') throw error
    }
    const created = { root: dir, dirs: [] }
    try {
      await mkdir(dir, { recursive: false })
      created.dirs.push(dir)
      for (const name of ['outline', 'chapters', 'reviews', 'state', 'bible', 'summaries']) {
        await mkdir(join(dir, name), { recursive: false })
        created.dirs.push(join(dir, name))
      }
      const manifest = {
        version: MANIFEST_VERSION,
        workId,
        title,
        form,
        tags: Array.isArray(input?.tags) ? input.tags.map(tag => String(tag)) : [],
        createdAt: now(),
        updatedAt: now(),
        chapters: [],
        counters: { reviewRounds: 0, openProblems: 0 },
        ...(range === undefined ? {} : { wordRange: { min: Number(range.min), max: Number(range.max) } }),
      }
      await writeAtomic(join(dir, 'hooks.md'), '# 伏笔\n\n（定稿归档后自动生成）\n')
      await writeAtomic(join(dir, 'bible', 'world.md'), '# 世界观\n')
      await writeAtomic(join(dir, 'bible', 'characters.json'), '[]\n')
      await writeAtomic(join(dir, 'bible', 'style.md'), '# 文风基准\n')
      await writeAtomic(join(dir, 'bible', 'plan.md'), '# 写作计划\n')
      await writeAtomic(join(dir, 'bible', 'intent.md'), '# 作者意图与当前焦点\n')
      await writeAtomic(join(dir, 'state', 'events.jsonl'), '')
      const written = await writeManifest(root, workId, manifest)
      return { workId, path: rootRelative(root, dir), manifest: written }
    } catch (error) {
      for (const path of [...created.dirs].reverse()) await rm(path, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  })
}

/**
 * Write the book-level plan, or record the author's approval of it.
 *
 * The plan lives in `bible/plan.md`; approval lives on the manifest so that
 * rewriting the plan automatically invalidates it.
 * @param {string} root - workspace directory.
 * @param {{work: string, mainline?: string, volumes?: string, ending?: string, approve?: boolean}} input - outline input.
 * @returns {Promise<{workId: string, outline: object}>} the stored outline state.
 */
export async function writeOutline(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const current = manifest.outline
    if (input.approve === true) {
      if (current === undefined || current.writtenAt === undefined) {
        throw new StoryError('outline-required', '还没有全书计划：先 story_outline 写主线、卷划分与结局方向')
      }
      manifest.outline = { ...current, approvedAt: now() }
      const written = await writeManifest(root, manifest.workId, manifest)
      return { workId: written.workId, outline: written.outline }
    }
    const mainline = String(input.mainline ?? '').trim()
    if (mainline === '') throw new StoryError('outline-invalid', '全书计划至少要写主线')
    const lines = [
      '# 写作计划',
      '',
      '## 主线',
      mainline,
      '',
      '## 卷划分',
      String(input.volumes ?? '').trim() === '' ? '（暂未划分）' : String(input.volumes).trim(),
      '',
      '## 结局方向',
      String(input.ending ?? '').trim() === '' ? '（暂未确定）' : String(input.ending).trim(),
      '',
    ].join('\n')
    await commitFiles(root, manifest.workId, 'outline', { 'bible/plan.md': lines })
    // A new plan is unapproved until the author says otherwise.
    manifest.outline = { writtenAt: now() }
    const written = await writeManifest(root, manifest.workId, manifest)
    return { workId: written.workId, outline: written.outline }
  })
}

/**
 * Update one work's production settings (currently the word range).
 *
 * The range is a per-work decision made with the author, never a global rule;
 * `null` clears it back to "not set".
 * @param {string} root - workspace directory.
 * @param {{work: string, wordRange?: {min: number, max: number}|null}} input - settings input.
 * @returns {Promise<{workId: string, wordRange?: {min: number, max: number}}>} the stored settings.
 */
export async function updateSettings(root, input) {
  return withWorkLock(root, String(input.work), async (lock) => {
    const manifest = await readManifest(root, input.work)
    if (input.wordRange === null) {
      delete manifest.wordRange
    } else if (input.wordRange !== undefined) {
      const min = Number(input.wordRange?.min)
      const max = Number(input.wordRange?.max)
      if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min) {
        throw new StoryError('word-range-invalid', `字数范围不合法：${JSON.stringify(input.wordRange)}`)
      }
      manifest.wordRange = { min, max }
    }
    const written = await writeManifest(root, manifest.workId, manifest)
    return { workId: written.workId, ...(written.wordRange === undefined ? {} : { wordRange: written.wordRange }) }
  })
}

/**
 * Rename a work: its title, its identity, or both.
 *
 * The directory, the manifest and the lock path must agree afterwards, so the
 * directory rename and the manifest write are one unit: a failure renames the
 * directory back.
 * @param {string} root - workspace directory.
 * @param {{work: string, title?: string, workId?: string}} input - rename input.
 * @returns {Promise<{workId: string, title: string}>} the new identity.
 */
export async function renameWork(root, input) {
  const oldId = String(input.work)
  return withWorkLock(root, oldId, async (lock) => {
    const manifest = await readManifest(root, oldId)
    const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : manifest.title
    const requested = typeof input.workId === 'string' && input.workId.trim() !== '' ? input.workId.trim() : undefined
    const newId = requested === undefined ? manifest.workId : slugify(requested)
    if (newId === '') throw new StoryError('invalid-work-id', '作品 id 不能为空')
    if (requested !== undefined) {
      // Slugs drop dots, so the requested spelling is what must be checked.
      if (requested.startsWith('.') || requested.includes('/') || requested.includes('\\') || requested === 'works') {
        throw new StoryError('invalid-work-id', `作品 id 不能是保留名：${requested}`)
      }
    }
    if (newId !== manifest.workId) {
      const target = join(worksDirectory(root), newId)
      if (await readOptional(join(target, 'manifest.json')) !== undefined) {
        throw new StoryError('work-exists', `已经有作品 ${newId}`)
      }
      await rename(workDirectory(root, manifest.workId), target)
      try {
        manifest.workId = newId
        manifest.title = title
        const written = await writeManifest(root, newId, manifest)
        // The lock name tracks the identity: other writers test the new path.
        await lock.moveTo(newId).catch(async (error) => {
          await rename(target, workDirectory(root, oldId)).catch(() => {})
          throw error
        })
        return { workId: written.workId, title: written.title }
      } catch (error) {
        await rename(target, workDirectory(root, oldId)).catch(() => {})
        throw error
      }
    }
    manifest.title = title
    const written = await writeManifest(root, manifest.workId, manifest)
    return { workId: written.workId, title: written.title }
  })
}

/**
 * List the works currently in the trash, newest first.
 *
 * Only names of the form `<workId>-<trashedAt>` are reported, so a stray
 * directory never looks like a work.
 * @param {string} root - workspace directory.
 * @returns {Promise<Array<{workId: string, trashedAt: number, path: string}>>} trash entries.
 */
export async function listTrash(root) {
  let entries
  try {
    entries = await readdir(join(worksDirectory(root), '.trash'))
  } catch {
    return []
  }
  return entries
    .map(entry => {
      const match = /^(.*)-(\d+)$/.exec(entry)
      return match === null ? undefined : { workId: match[1], trashedAt: Number(match[2]), path: entry }
    })
    .filter(entry => entry !== undefined)
    .sort((left, right) => right.trashedAt - left.trashedAt)
}

/**
 * Move a work into `works/.trash`, keeping it restorable.
 * @param {string} root - workspace directory.
 * @param {{work: string}} input - delete input.
 * @returns {Promise<{workId: string, path: string}>} the trashed location.
 */
export async function deleteWork(root, input) {
  const workId = String(input.work)
  return withWorkLock(root, workId, async () => {
    const manifest = await readManifest(root, workId)
    const pending = await readdir(join(workDirectory(root, manifest.workId), '.staging')).catch(() => [])
    if (pending.length > 0) {
      throw new StoryError('work-busy', `作品 ${manifest.workId} 还有未提交的暂存，等它结束再删除`)
    }
    const trash = join(worksDirectory(root), '.trash')
    await mkdir(trash, { recursive: true })
    const target = join(trash, `${manifest.workId}-${Date.now()}`)
    await rename(workDirectory(root, manifest.workId), target)
    return { workId: manifest.workId, path: target }
  })
}

/**
 * Restore the newest trashed copy of one work.
 * @param {string} root - workspace directory.
 * @param {{name: string}} input - the work's name at trash time.
 * @returns {Promise<{workId: string}>} the restored identity.
 */
export async function restoreWork(root, input) {
  const name = String(input.name ?? '').trim()
  if (name === '') throw new StoryError('invalid-work-id', '要恢复的作品名不能为空')
  const trash = join(worksDirectory(root), '.trash')
  let entries
  try {
    entries = await readdir(trash)
  } catch {
    entries = []
  }
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
  const candidates = entries
    .map(entry => ({ entry, match: pattern.exec(entry) }))
    .filter(item => item.match !== null)
    .sort((left, right) => Number(left.match[2]) - Number(right.match[2]))
  const latest = candidates[candidates.length - 1]?.entry
  if (latest === undefined) throw new StoryError('work-not-found', `回收站里没有作品 ${name}`)
  if (await readOptional(join(worksDirectory(root), name, 'manifest.json')) !== undefined) {
    throw new StoryError('work-exists', `已经有作品 ${name}`)
  }
  const target = workDirectory(root, name)
  await rename(join(trash, latest), target)
  const manifest = await readManifest(root, name)
  if (manifest.workId !== name) {
    manifest.workId = name
    await writeManifest(root, name, manifest)
  }
  return { workId: name }
}

/**
 * Write one chapter plan.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, perspective: string, goal: string, obstacle: string, cost: string, turn: string}} input - plan fields.
 * @returns {Promise<{manifest: object, entry: object, artifact: {path: string}}>} result.
 */
export async function writePlan(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const fields = {
      视角: input.perspective,
      目标: input.goal,
      阻力: input.obstacle,
      代价: input.cost,
      结尾变化: input.turn,
    }
    const missing = Object.entries(fields)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key)
    if (missing.length > 0) throw new StoryError('plan-incomplete', `章纲缺少：${missing.join('、')}`)
    const entry = chapterEntry(manifest, number)
    assertStage(entry, ['planned', 'written', 'reviewed', 'revised'],
      `第 ${number} 章已定稿：改章纲前先带 reopen 重写正文回退`)
    const file = join(workDirectory(root, manifest.workId), 'outline', `${entry.id}.plan.md`)
    const workDir = workDirectory(root, manifest.workId)
    const text = [
      `# 第 ${number} 章 章纲`,
      '',
      `- 视角：${fields.视角.trim()}`,
      `- 目标：${fields.目标.trim()}`,
      `- 阻力：${fields.阻力.trim()}`,
      `- 代价：${fields.代价.trim()}`,
      `- 结尾变化：${fields.结尾变化.trim()}`,
      '',
    ].join('\n')
    await commitFiles(root, manifest.workId, 'plan', { [relativeToWork(workDir, file)]: text })
    // A fresh plan is unapproved until the author confirms it in the panel.
    delete entry.planApprovedAt
    if (stageOf(entry) === 'planned') entry.stage = 'planned'
    entry.updatedAt = now()
    const written = await writeManifest(root, manifest.workId, manifest)
    return { manifest: written, entry, artifact: { path: rootRelative(root, file) } }
  })
}

/**
 * Record the author's confirmation of one chapter plan.
 *
 * Only the host route calls this: the model has no approval action, so it cannot
 * confirm on the author's behalf.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string}} input - target chapter.
 * @returns {Promise<{manifest: object, entry: object}>} the updated chapter entry.
 */
export async function approveChapterPlan(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const entry = manifest.chapters.find(chapter => chapter.number === number)
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章：先写章纲`)
    const planFile = join(workDirectory(root, manifest.workId), 'outline', `${entry.id}.plan.md`)
    if ((await readOptional(planFile)) === undefined) {
      throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再确认`)
    }
    entry.planApprovedAt = now()
    entry.updatedAt = now()
    const written = await writeManifest(root, manifest.workId, manifest)
    return { manifest: written, entry }
  })
}

/**
 * Write a chapter body: first version, or a new revision when asked to rewrite.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, title?: string, body: string, rewrite?: boolean}} input - body input.
 * @returns {Promise<{manifest: object, entry: object, artifact: {path: string, revision: number}, words: number}>} result.
 */
export async function writeChapter(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const body = String(input.body ?? '')
    if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
    const entry = chapterEntry(manifest, number)
    const planFile = join(workDirectory(root, manifest.workId), 'outline', `${entry.id}.plan.md`)
    if ((await readOptional(planFile)) === undefined) {
      throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再写正文`)
    }
    // The public write action opts into the author gate; the check runs under
    // the same lock as the write, so a replan cannot slip between them.
    if (input.requirePlanApproval === true && entry.currentRevision === 0 && entry.planApprovedAt === undefined) {
      throw new StoryError('plan-not-approved',
        `第 ${number} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」后再写正文`)
    }
    const settled = stageOf(entry) === 'settled'
    if (settled && input.reopen !== true) {
      throw new StoryError('chapter-settled',
        `第 ${number} 章已定稿：改正文请传 reopen: true，回退到已写并作废本章旧的定稿`)
    }
    const dir = join(workDirectory(root, manifest.workId), 'chapters')
    let revision = 1
    let file = join(dir, `${entry.id}.md`)
    if (await readOptional(file) !== undefined) {
      if (input.rewrite !== true && !(settled && input.reopen === true)) {
        throw new StoryError('chapter-exists', `第 ${number} 章已有正文；改稿请传 rewrite: true 生成新版本`)
      }
      revision = Math.max(entry.currentRevision, 1) + 1
      file = join(dir, `${entry.id}.r${revision}.md`)
      while (await readOptional(file) !== undefined) {
        revision += 1
        file = join(dir, `${entry.id}.r${revision}.md`)
      }
    }
    const workDir = workDirectory(root, manifest.workId)
    const cleaned = await cleanStaleStages(workDir)
    const stage = await openStage(workDir, 'write')
    const journal = { undo: [] }
    try {
      if (typeof input.title === 'string' && input.title.trim() !== '') entry.title = input.title.trim()
      stage.put(relative(workDir, file).replaceAll('\\', '/'), body.endsWith('\n') ? body : `${body}\n`)
      await stage.materialize()
      if (settled) {
        const eventsFile = join(workDir, 'state', 'events.jsonl')
        const previousEvents = (await readOptional(eventsFile)) ?? ''
        stage.put(relativeToWork(workDir, eventsFile), appendEventLine(previousEvents, { kind: 'reopen', chapter: number }))
        await stage.materialize()
      }
      entry.currentRevision = revision
      entry.words = countWords(body)
      entry.status = 'written'
      entry.stage = 'written'
      entry.updatedAt = now()
      // Staged first, committed in one pass, and the manifest last: it is the
      // commit point, so a crash before it leaves the previous chapter intact.
      await stage.commit()
      const written = await writeManifest(root, manifest.workId, manifest)
      return { manifest: written, entry, artifact: { path: rootRelative(root, file), revision }, words: entry.words, cleaned }
    } catch (error) {
      await stage.discard()
      for (const undo of journal.undo.reverse()) await undo().catch(() => {})
      throw error
    }
  })
}

/**
 * Render one chapter body, or its plan.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, view?: 'body'|'plan', revision?: number}} input - read input.
 * @returns {Promise<{path: string, content: string, revision: number}>} the chapter text.
 */
export async function readChapter(root, input) {
  const manifest = await readManifest(root, input.work)
  const number = chapterNumber(input.chapter)
  const entry = manifest.chapters.find(chapter => chapter.number === number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const dir = workDirectory(root, manifest.workId)
  if (input.view === 'summary') {
    const file = join(dir, 'summaries', `${entry.id}.md`)
    const content = await readOptional(file)
    if (content === undefined) throw new StoryError('summary-not-found', `第 ${number} 章还没有摘要`)
    return { path: rootRelative(root, file), content, revision: 0 }
  }
  if (input.view === 'plan') {
    const file = join(dir, 'outline', `${entry.id}.plan.md`)
    const content = await readOptional(file)
    if (content === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
    return { path: rootRelative(root, file), content, revision: 0 }
  }
  const revision = input.revision === undefined || input.revision === 0 ? entry.currentRevision : Number(input.revision)
  if (revision <= 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文`)
  const file = revision === 1
    ? join(dir, 'chapters', `${entry.id}.md`)
    : join(dir, 'chapters', `${entry.id}.r${revision}.md`)
  const content = await readOptional(file)
  if (content === undefined) throw new StoryError('body-not-found', `第 ${number} 章没有版本 ${revision}`)
  return { path: rootRelative(root, file), content, revision }
}

/**
 * Persist a review: the model's findings, never the prose.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, problems: Array<{location: string, problem: string, suggestion: string}>}} input - findings.
 * @returns {Promise<{manifest: object, entry: object, artifact: {path: string}, problems: object[]}>} result.
 */
export async function writeReview(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const entry = chapterEntry(manifest, number)
    if (entry.currentRevision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能审稿`)
    assertStage(entry, ['written', 'reviewed', 'revised'],
      `第 ${number} 章已定稿：改审稿要先带 reopen: true 重写正文回退`)
    const problems = Array.isArray(input.problems) ? input.problems : []
    if (problems.length === 0) throw new StoryError('empty-review', '问题清单为空：审稿至少要给出一条问题')
    const dir = join(workDirectory(root, manifest.workId), 'reviews')
    const round = (await latestReviewRound(root, manifest, entry)) + 1
    const file = join(dir, `${entry.id}.r${round}.md`)
    const lines = [`# 第 ${number} 章 审稿（第 ${round} 轮）`, '', `- 正文版本：${entry.currentRevision}`, '']
    const recorded = problems.map((problem, index) => {
      const id = `Q${index + 1}`
      const location = String(problem?.location ?? '').trim() || '未标注'
      const text = String(problem?.problem ?? '').trim()
      const suggestion = String(problem?.suggestion ?? '').trim() || '未给出建议'
      if (text === '') throw new StoryError('empty-problem', `${id} 缺少问题描述`)
      lines.push(`- [ ] ${id} :: ${location} :: ${text} :: ${suggestion}`)
      return { id, location, problem: text, suggestion, done: false }
    })
    lines.push('')
    const workDir = workDirectory(root, manifest.workId)
    await commitFiles(root, manifest.workId, 'review', { [relativeToWork(workDir, file)]: lines.join('\n') })
    entry.status = 'reviewed'
    entry.stage = 'reviewed'
    entry.updatedAt = now()
    await refreshCounters(root, manifest)
    const written = await writeManifest(root, manifest.workId, manifest)
    return { manifest: written, entry, artifact: { path: rootRelative(root, file) }, problems: recorded }
  })
}

/** Every review round file of one chapter, ascending by round number. */
async function reviewFiles(root, manifest, entry) {
  const dir = join(workDirectory(root, manifest.workId), 'reviews')
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  return names
    .flatMap((name) => {
      const match = new RegExp(`^${entry.id}\\.r(\\d+)\\.md$`).exec(name)
      return match === null ? [] : [{ name, round: Number(match[1]), file: join(dir, name) }]
    })
    .sort((left, right) => left.round - right.round)
}

/** Highest review round number of a chapter. */
async function latestReviewRound(root, manifest, entry) {
  const files = await reviewFiles(root, manifest, entry)
  return files.length === 0 ? 0 : files[files.length - 1].round
}

/** Number of review rounds a chapter has. */
async function reviewRoundsOf(root, manifest, entry) {
  return (await reviewFiles(root, manifest, entry)).length
}

/**
 * Parse one review file into items.
 * @param {string} text - review markdown.
 * @returns {Array<{id: string, done: boolean, line: number}>} parsed items.
 */
export function parseReview(text) {
  const items = []
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    const match = /^- \[( |x)\] (Q\d+) :: (.*)$/.exec(line)
    if (match !== null) items.push({ id: match[2], done: match[1] === 'x', line: index })
  }
  return items
}

/**
 * Latest review file of a chapter, if any.
 * @param {string} root - workspace directory.
 * @param {object} manifest - work manifest.
 * @param {object} entry - chapter entry.
 * @returns {Promise<{path: string, text: string, round: number}|undefined>} review file.
 */
export async function latestReview(root, manifest, entry) {
  const files = await reviewFiles(root, manifest, entry)
  if (files.length === 0) return undefined
  const last = files[files.length - 1]
  const text = (await readOptional(last.file)) ?? ''
  const revisionMatch = /^- 正文版本：(\d+)$/mu.exec(text)
  return {
    path: rootRelative(root, last.file),
    file: last.file,
    text,
    round: last.round,
    revision: revisionMatch === null ? undefined : Number(revisionMatch[1]),
  }
}

/**
 * Whether a review still describes the current body revision.
 * @param {{revision?: number}|undefined} latest - latest review, if any.
 * @param {object} entry - chapter entry.
 * @returns {boolean} true when the review covers the current revision.
 */
function reviewCoversRevision(latest, entry, allowPrevious = false) {
  if (latest === undefined) return false
  if (latest.revision === undefined) return true
  if (latest.revision === entry.currentRevision) return true
  return allowPrevious && latest.revision === entry.currentRevision - 1
}

/**
 * Revise a chapter from a review: mark the addressed items and keep the old version.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, body: string, problemIds?: string[]}} input - revision input.
 * @returns {Promise<{manifest: object, entry: object, artifact: {path: string, revision: number}, resolved: string[]}>} result.
 */
export async function reviseChapter(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const entry = manifest.chapters.find(chapter => chapter.number === number)
    if (entry === undefined || entry.currentRevision === 0) {
      throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能修订`)
    }
    assertStage(entry, ['written', 'reviewed', 'revised'],
      `第 ${number} 章已定稿：修订要先带 reopen: true 重写正文回退`)
    const body = String(input.body ?? '')
    if (body.trim() === '') throw new StoryError('empty-body', '修订后的正文不能为空')
    const latest = await latestReview(root, manifest, entry)
    if (latest === undefined) {
      throw new StoryError('review-required', `第 ${number} 章还没有审稿清单：先审稿再用清单修订`)
    }
    const mode = ['patch', 'polish', 'rewrite', 'deslop'].includes(input.mode) ? input.mode : 'patch'
    if (!reviewCoversRevision(latest, entry, mode !== 'patch')) {
      throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${latest.revision ?? '?'}：先重新审稿`)
    }
    const items = parseReview(latest.text)
    const ids = Array.isArray(input.problemIds) ? input.problemIds.map(String) : []
    // A polish/rewrite/deslop pass may run without new items: it improves the
    // prose rather than answering a review finding. Patch is item-driven.
    if (ids.length === 0 && mode === 'patch') {
      throw new StoryError('missing-problems', '局部修补要指定本次处理的问题条目 id；如果只想润色或去 AI 味，请换模式')
    }
    const unknown = ids.filter(id => !items.some(item => item.id === id))
    if (unknown.length > 0) throw new StoryError('problem-not-found', `审稿清单里没有：${unknown.join('、')}`)

    const previous = await readChapter(root, { work: manifest.workId, chapter: number })
    if (previous.content === (body.endsWith('\n') ? body : `${body}\n`)) {
      throw new StoryError('unchanged-body', '修订后的正文与当前版本相同，没有可提交的改动')
    }
    const oldWords = countWords(previous.content)
    const newWords = countWords(body)
    const delta = oldWords === 0 ? 1 : Math.abs(newWords - oldWords) / oldWords
    if (mode === 'patch' && delta > 0.2) {
      throw new StoryError('revise-mode-violation',
        `局部修补的字数变化 ${(delta * 100).toFixed(0)}% 超过 20%：改用 polish 或 rewrite`)
    }
    if (mode === 'polish' && delta > 0.4) {
      throw new StoryError('revise-mode-violation',
        `润色的字数变化 ${(delta * 100).toFixed(0)}% 超过 40%：改用 rewrite`)
    }
    if (mode === 'deslop') {
      const before = critique(previous.content).aiPhrases.count
      const after = critique(body).aiPhrases.count
      // Nothing to remove means the goal is already met; a regression is what the
      // rule exists to catch.
      if (before > 0 && after >= before) {
        throw new StoryError('revise-mode-violation',
          `去 AI 味修订没有减少命中的腔调词（${before} → ${after}）`)
      }
    }

    let revision = entry.currentRevision + 1
    const chaptersDir = join(workDirectory(root, manifest.workId), 'chapters')
    let file = join(chaptersDir, `${entry.id}.r${revision}.md`)
    while (await readOptional(file) !== undefined) {
      revision += 1
      file = join(chaptersDir, `${entry.id}.r${revision}.md`)
    }
    const reviewFile = latest.file
    const workDir = workDirectory(root, manifest.workId)
    const marked = latest.text.split(/\r?\n/).map((line) => {
      const match = /^- \[ \] (Q\d+) ::/.exec(line)
      return match !== null && ids.includes(match[1]) ? line.replace('- [ ]', '- [x]') : line
    }).join('\n')
    await commitFiles(root, manifest.workId, 'revise', {
      [relativeToWork(workDir, file)]: body.endsWith('\n') ? body : `${body}\n`,
      [relativeToWork(workDir, reviewFile)]: marked,
    })
    entry.currentRevision = revision
    entry.words = countWords(body)
    entry.status = 'revised'
    entry.stage = 'revised'
    entry.lastReviseMode = mode
    entry.updatedAt = now()
    await refreshCounters(root, manifest)
    const written = await writeManifest(root, manifest.workId, manifest)
    return { manifest: written, entry, artifact: { path: rootRelative(root, file), revision }, resolved: ids }
  })
}

/**
 * Fold state facts for one chapter into the event log.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string, entities?: Array<{name: string, facts: string[]}>, hooks?: Array<{text: string, state: 'opened'|'used'|'resolved'}>}} input - state input.
 * @returns {Promise<{manifest: object, counts: {entities: number, opened: number, used: number, resolved: number, open: number}, artifact: {path: string}}>} result.
 */
export async function foldState(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const entry = manifest.chapters.find(chapter => chapter.number === number)
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    const entities = Array.isArray(input.entities) ? input.entities : []
    const hooks = Array.isArray(input.hooks) ? input.hooks : []
    if (entities.length === 0 && hooks.length === 0) {
      throw new StoryError('empty-state', '定稿归档至少要给出一条人物事实或伏笔变化')
    }
    const dir = workDirectory(root, manifest.workId)
    const eventsFile = join(dir, 'state', 'events.jsonl')
    const previous = (await readOptional(eventsFile)) ?? ''
    const current = foldEvents(previous)
    const lines = []
    let offset = previous.split(/\r?\n/).filter(line => line.trim() !== '').length
    for (const [index, entity] of entities.entries()) {
      const name = String(entity?.name ?? '').trim()
      // A single fact as a plain string is accepted: the model often sends one.
      const rawFacts = typeof entity?.facts === 'string' ? [entity.facts] : entity?.facts
      const facts = Array.isArray(rawFacts) ? rawFacts.map(fact => String(fact).trim()).filter(Boolean) : []
      if (name === '' || facts.length === 0) {
        throw new StoryError('invalid-entity',
          `第 ${index + 1} 条人物${name === '' ? '' : `（${name}）`}的 facts 必须是非空字符串或字符串数组；收到的类型：${typeof entity?.facts}`)
      }
      offset += 1
      lines.push(JSON.stringify({ seq: offset, at: now(), chapter: number, kind: 'entity', name, facts }))
    }
    const counts = { entities: entities.length, opened: 0, used: 0, resolved: 0, open: 0 }
    for (const hook of hooks) {
      const text = String(hook?.text ?? '').trim()
      const state = String(hook?.state ?? '')
      if (text === '') throw new StoryError('invalid-hook', '伏笔需要非空描述')
      if (!['opened', 'used', 'resolved'].includes(state)) {
        throw new StoryError('invalid-hook-state', `伏笔状态只能是 opened/used/resolved，收到：${state}`)
      }
      if (state === 'used' && !current.hooks.some(item => item.text === text && item.state !== 'resolved')) {
        throw new StoryError('hook-not-open', `没有可标记为已用的伏笔：${text}`)
      }
      offset += 1
      lines.push(JSON.stringify({ seq: offset, at: now(), chapter: number, kind: 'hook', text, state }))
      counts[state] += 1
    }
    const latest = await latestReview(root, manifest, entry)
    if (latest === undefined) {
      throw new StoryError('review-required', `第 ${number} 章还没有审稿清单：先审稿与修订，再定稿`)
    }
    const open = parseReview(latest.text).filter(item => !item.done)
    if (open.length > 0) {
      throw new StoryError('review-required',
        `第 ${number} 章还有 ${open.length} 条未处理审稿：${open.map(item => item.id).join('、')}；先修订再定稿`)
    }
    if (!reviewCoversRevision(latest, entry, true)) {
      throw new StoryError('review-required', `第 ${number} 章的审稿针对旧版本 r${latest.revision ?? '?'}：先重新审稿`)
    }
    if (stageOf(entry) !== 'revised') {
      throw new StoryError('review-required',
        `第 ${number} 章还没走完修订（当前阶段：${stageOf(entry)}）：先 story_revise 提交改动，再定稿`)
    }
    lines.push(JSON.stringify({ seq: offset + 1, at: now(), chapter: number, kind: 'settle' }))
    const nextEvents = previous === '' || previous.endsWith('\n')
      ? `${previous}${lines.join('\n')}\n`
      : `${previous}\n${lines.join('\n')}\n`
    const folded = foldEvents(nextEvents)
    const hooksFile = join(dir, 'hooks.md')
    await commitFiles(root, manifest.workId, 'settle', {
      [relativeToWork(dir, eventsFile)]: nextEvents,
      [relativeToWork(dir, hooksFile)]: renderHooks(folded.hooks),
    })
    counts.open = folded.hooks.filter(hook => hook.state !== 'resolved').length
    entry.stage = 'settled'
    entry.status = 'settled'
    entry.updatedAt = now()
    const written = await writeManifest(root, manifest.workId, manifest)
    return { manifest: written, counts, artifact: { path: rootRelative(root, eventsFile) } }
  })
}

/**
 * Fold the event log into current entities and hooks.
 * @param {string} text - events.jsonl contents.
 * @returns {{entities: Array<{name: string, facts: string[]}>, hooks: Array<{text: string, state: string, openedChapter: number}>}} folded state.
 */
export function foldEvents(text) {
  const entities = new Map()
  const hooks = new Map()
  const lines = String(text).split(/\r?\n/)
  // A reopened chapter's events before its last reopen no longer describe the
  // current state: the author rewrote the body, so the old settlement is void.
  const reopenAt = new Map()
  for (const [index, line] of lines.entries()) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.kind === 'reopen' && Number.isInteger(event.chapter)) reopenAt.set(event.chapter, index)
  }
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const reopenedAt = reopenAt.get(event?.chapter)
    if (reopenedAt !== undefined && index < reopenedAt) continue
    if (event?.kind === 'entity') {
      const existing = entities.get(event.name) ?? { name: event.name, facts: [] }
      existing.facts.push(...(event.facts ?? []))
      entities.set(event.name, existing)
    } else if (event?.kind === 'hook') {
      const existing = hooks.get(event.text) ?? { text: event.text, state: 'opened', openedChapter: event.chapter }
      hooks.set(event.text, { ...existing, state: event.state, updatedChapter: event.chapter })
    }
  }
  return { entities: [...entities.values()], hooks: [...hooks.values()] }
}

/**
 * Render the human-readable hooks view.
 * @param {Array<{text: string, state: string, openedChapter: number, updatedChapter?: number}>} hooks - folded hooks.
 * @returns {string} markdown.
 */
export function renderHooks(hooks) {
  const lines = ['# 伏笔', '']
  if (hooks.length === 0) {
    lines.push('（还没有记录伏笔）', '')
    return lines.join('\n')
  }
  lines.push('| 伏笔 | 状态 | 埋设章 | 最近变化 |', '| --- | --- | --- | --- |')
  for (const hook of hooks) {
    lines.push(`| ${hook.text} | ${hook.state} | ${hook.openedChapter} | ${hook.updatedChapter ?? hook.openedChapter} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Progress summary for one work.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Promise<object>} status payload.
 */
export async function status(root, work) {
  const manifest = await readManifest(root, work)
  const events = (await readOptional(join(workDirectory(root, manifest.workId), 'state', 'events.jsonl'))) ?? ''
  const folded = foldEvents(events)
  const written = manifest.chapters.filter(chapter => chapter.currentRevision > 0)
  let openProblems = 0
  for (const chapter of manifest.chapters) {
    const latest = await latestReview(root, manifest, chapter)
    if (latest !== undefined) openProblems += parseReview(latest.text).filter(item => !item.done).length
  }
  return {
    workId: manifest.workId,
    title: manifest.title,
    chapters: manifest.chapters.map(chapter => ({
      number: chapter.number,
      status: chapter.status,
      stage: stageOf(chapter),
      revision: chapter.currentRevision,
      words: chapter.words,
    })),
    form: formOf(manifest),
    writtenChapters: written.length,
    latestChapter: manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number,
    ...(manifest.wordRange === undefined ? {} : { wordRange: manifest.wordRange }),
    openProblems,
    entities: folded.entities.length,
    hooks: {
      opened: folded.hooks.filter(hook => hook.state === 'opened').length,
      used: folded.hooks.filter(hook => hook.state === 'used').length,
      resolved: folded.hooks.filter(hook => hook.state === 'resolved').length,
    },
  }
}

/**
 * Void one chapter's settlement without touching the body.
 *
 * Use it when a settled chapter needs fresh review findings recorded: the body
 * stays as it is, the settlement becomes void (its facts stop counting), and the
 * chapter returns to `written` so review, revision and settlement can run again.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number|string}} input - reopen input.
 * @returns {Promise<object>} reopen receipt.
 */
export async function reopenChapter(root, input) {
  return withWorkLock(root, String(input.work), async () => {
    const manifest = await readManifest(root, input.work)
    const number = chapterNumber(input.chapter)
    const entry = manifest.chapters.find(chapter => chapter.number === number)
    if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    if (stageOf(entry) !== 'settled') {
      throw new StoryError('not-settled', `第 ${number} 章还没定稿（当前阶段：${stageOf(entry)}），不需要重开`)
    }
    const workDir = workDirectory(root, manifest.workId)
    const eventsFile = join(workDir, 'state', 'events.jsonl')
    const previousEvents = (await readOptional(eventsFile)) ?? ''
    await commitFiles(root, manifest.workId, 'reopen', {
      [relativeToWork(workDir, eventsFile)]: appendEventLine(previousEvents, { kind: 'reopen', chapter: number }),
    })
    entry.stage = 'written'
    entry.status = 'written'
    entry.updatedAt = now()
    const written = await writeManifest(root, manifest.workId, manifest)
    return {
      entry,
      manifest: written,
      artifact: { path: rootRelative(root, join(workDir, 'manifest.json')) },
    }
  })
}

/**
 * The next step of one work, derived from the stage machine.
 *
 * Read-only: it never writes, so the page and the model can both ask it what to
 * do next without changing the work.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Promise<{workId: string, chapter: number, stage: string, action: string, reason: string, missing: string[]}>} next step.
 */
export async function nextStep(root, work) {
  const step = await nextStepRaw(root, work)
  const manifest = await readManifest(root, work)
  const form = formOf(manifest)
  return { ...step, form, unit: unitOf(form) }
}

/**
 * The stage-derived next step, before the form is attached.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Promise<object>} next step.
 */
async function nextStepRaw(root, work) {
  const manifest = await readManifest(root, work)
  const last = manifest.chapters.length === 0 ? undefined : manifest.chapters[manifest.chapters.length - 1]
  const chapter = last === undefined ? 1 : last.number
  const outline = manifest.outline
  if (last === undefined && outline?.approvedAt === undefined) {
    const reason = outline === undefined || outline.writtenAt === undefined
      ? '还没有全书计划：先写主线、卷划分与结局方向，等作者确认'
      : '全书计划等作者确认：确认后才能写第 1 章章纲'
    return { workId: manifest.workId, chapter, stage: 'planned', action: 'story_outline', reason, missing: ['outline'] }
  }
  if (last === undefined) {
    return { workId: manifest.workId, chapter, stage: 'planned', action: 'story_plan', reason: '还没有任何章节：先写第 1 章章纲', missing: ['outline'] }
  }
  const stage = stageOf(last)
  const dir = workDirectory(root, manifest.workId)
  const planFile = join(dir, 'outline', `${last.id}.plan.md`)
  const hasPlan = (await readOptional(planFile)) !== undefined
  const hasBody = last.currentRevision > 0
  if (stage === 'settled') {
    // The rolling window reads summaries; a settled chapter without one leaves a
    // hole the next chapters would silently inherit.
    const summary = await readOptional(join(dir, 'summaries', `${last.id}.md`))
    if (summary === undefined || summary.trim() === '') {
      return {
        workId: manifest.workId, chapter: last.number, stage, action: 'story_summarize',
        reason: `第 ${last.number} 章已定稿但没有摘要：先补摘要，后面几章的写前上下文才用得上`, missing: ['summary'],
      }
    }
    // A volume's last chapter is the natural moment for its summary.
    const volumesText = await readOptional(join(dir, 'bible', 'volumes.json'))
    let volumes = []
    if (volumesText !== undefined) {
      try {
        const parsed = JSON.parse(volumesText)
        volumes = Array.isArray(parsed) ? parsed : (parsed?.volumes ?? [])
      } catch {
        volumes = []
      }
    }
    const closing = volumes.find(volume => volume?.to === last.number)
    if (closing !== undefined && (typeof closing.summary !== 'string' || closing.summary.trim() === '')) {
      return {
        workId: manifest.workId, chapter: last.number, stage, action: 'story_volume',
        reason: `第 ${last.number} 章是「${closing.title}」的最后一章：给它补一段卷摘要，下一卷的写前上下文要用`,
        missing: ['volume-summary'],
      }
    }
    const next = last.number + 1
    return { workId: manifest.workId, chapter: next, stage: 'planned', action: 'story_plan', reason: `第 ${last.number} 章已定稿：写第 ${next} 章章纲`, missing: ['outline'] }
  }
  if (!hasPlan) {
    return { workId: manifest.workId, chapter: last.number, stage, action: 'story_plan', reason: `第 ${last.number} 章缺章纲`, missing: ['outline'] }
  }
  if (!hasBody) {
    if (last.planApprovedAt === undefined) {
      return {
        workId: manifest.workId, chapter: last.number, stage, action: 'story_write',
        reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」，然后写正文`,
        missing: ['plan-approval'],
      }
    }
    return { workId: manifest.workId, chapter: last.number, stage, action: 'story_write', reason: `第 ${last.number} 章已有章纲，写正文`, missing: ['body'] }
  }
  if (stage === 'written') {
    return { workId: manifest.workId, chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
  }
  const latest = await latestReview(root, manifest, last)
  if (!reviewCoversRevision(latest, last, true)) {
    return { workId: manifest.workId, chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
  }
  const open = parseReview(latest.text).filter(item => !item.done)
  if (open.length > 0) {
    return {
      workId: manifest.workId, chapter: last.number, stage, action: 'story_revise',
      reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map(item => item.id),
    }
  }
  if (stage !== 'revised') {
    return { workId: manifest.workId, chapter: last.number, stage, action: 'story_revise', reason: `第 ${last.number} 章审稿条目已处理完，但还没提交修订`, missing: ['revision'] }
  }
  // The summary is the last content artifact:写摘要 before 定稿, so 定稿 concludes.
  const summary = await readOptional(join(dir, 'summaries', `${last.id}.md`))
  if (summary === undefined || summary.trim() === '') {
    return {
      workId: manifest.workId, chapter: last.number, stage, action: 'story_summarize',
      reason: `第 ${last.number} 章已修订：先写摘要，再定稿`, missing: ['summary'],
    }
  }
  return { workId: manifest.workId, chapter: last.number, stage, action: 'story_state', reason: `第 ${last.number} 章已修订，定稿`, missing: [] }
}

/**
 * List every work in a workspace, newest activity first.
 * @param {string} root - workspace directory.
 * @returns {Promise<Array<object>>} work summaries.
 */
export async function listWorks(root) {
  let names
  try {
    names = await readdir(worksDirectory(root), { withFileTypes: true })
  } catch {
    return []
  }
  const works = []
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = await readManifest(root, entry.name)
      const written = manifest.chapters.filter(chapter => chapter.currentRevision > 0)
      let openProblems = 0
      for (const chapter of manifest.chapters) {
        const latest = await latestReview(root, manifest, chapter)
        if (latest !== undefined) openProblems += parseReview(latest.text).filter(item => !item.done).length
      }
      works.push({
        workId: manifest.workId,
        title: manifest.title,
        form: formOf(manifest),
        chapters: manifest.chapters.length,
        writtenChapters: written.length,
        latestChapter: manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number,
        openProblems,
        updatedAt: manifest.updatedAt,
      })
    } catch {
      continue
    }
  }
  return works.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
}

/**
 * Read one work for the workbench: manifest, chapters, plans, reviews, state.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {Promise<object>} work detail payload.
 */
export async function readWork(root, work) {
  const manifest = await readManifest(root, work)
  const dir = workDirectory(root, manifest.workId)
  const chapters = []
  for (const chapter of manifest.chapters) {
    const plan = await readOptional(join(dir, 'outline', `${chapter.id}.plan.md`))
    const summary = await readOptional(join(dir, 'summaries', `${chapter.id}.md`))
    const latest = await latestReview(root, manifest, chapter)
    chapters.push({
      number: chapter.number,
      id: chapter.id,
      title: chapter.title,
      status: chapter.status,
      revision: chapter.currentRevision,
      words: chapter.words,
      stage: stageOf(chapter),
      hasPlan: plan !== undefined,
      planApproved: chapter.planApprovedAt !== undefined,
      hasSummary: summary !== undefined && summary.trim() !== '',
      reviewRound: latest?.round ?? 0,
      openProblems: latest === undefined ? 0 : parseReview(latest.text).filter(item => !item.done).length,
      updatedAt: chapter.updatedAt,
    })
  }
  const events = (await readOptional(join(dir, 'state', 'events.jsonl'))) ?? ''
  const folded = foldEvents(events)
  return {
    manifest: {
      version: manifest.version,
      workId: manifest.workId,
      title: manifest.title,
      form: formOf(manifest),
      tags: manifest.tags,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    },
    chapters,
    state: {
      entities: folded.entities,
      hooks: folded.hooks,
      events: events.split(/\r?\n/).filter(line => line.trim() !== '').length,
    },
  }
}

/**
 * Read the latest review of a chapter with its items.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {number|string} chapterNumberValue - chapter number.
 * @returns {Promise<{path: string, round: number, items: Array<{id: string, done: boolean, location: string, problem: string, suggestion: string}>}>} review payload.
 */
export async function readReview(root, work, chapterNumberValue) {
  const manifest = await readManifest(root, work)
  const number = chapterNumber(chapterNumberValue)
  const entry = manifest.chapters.find(chapter => chapter.number === number)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
  const latest = await latestReview(root, manifest, entry)
  if (latest === undefined) return { path: '', round: 0, items: [], rounds: await reviewRoundsOf(root, manifest, entry) }
  const items = latest.text.split(/\r?\n/).flatMap((line) => {
    const match = /^- \[( |x)\] (Q\d+) :: (.*?) :: (.*?) :: (.*)$/.exec(line)
    return match === null
      ? []
      : [{ id: match[2], done: match[1] === 'x', location: match[3], problem: match[4], suggestion: match[5] }]
  })
  return {
    path: latest.path,
    round: latest.round,
    items,
    rounds: await reviewRoundsOf(root, manifest, entry),
  }
}
