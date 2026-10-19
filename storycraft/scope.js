/**
 * Workspace scope guard: decide whether one tool call may touch the work store.
 *
 * The store lives under `<workspace>/works`; the future SQLite store lives under
 * `<workspace>/.storycraft`. A session may read only the work it is pointed at,
 * and no session may touch the database files directly. The predicate is pure,
 * synchronous and total: malformed input denies instead of throwing.
 */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

/** Denial copy, fixed so acceptance can assert it. */
export const SCOPE_MESSAGES = {
  discussion: '讨论阶段不读历史作品：请先在面板进入一部作品，或给 path 限定到项目目录。',
  otherWork: '只能访问当前作品：works/<其他作品> 不在当前会话的作用域内。',
  search: '检索默认会扫进 works/：请给 path 限定到项目目录或当前作品。',
  database: '不直接访问作品库：请通过故事工坊动作或导出读取。',
  cd: '不进入作品目录：请用相对项目根的路径访问作品。',
}

/** Tools that read or write paths. */
const PATH_TOOLS = new Set(['read', 'edit', 'write', 'read_image'])
const SEARCH_TOOLS = new Set(['glob', 'grep'])
const SHELL_TOOLS = new Set(['pwsh', 'bash'])

/** Case-insensitive path comparison on Windows. */
function fold(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * Whether `target` is inside `root`.
 * @param {string} root - absolute directory.
 * @param {string} target - absolute path.
 * @returns {boolean} true when target is root or below it.
 */
function within(root, target) {
  const left = fold(normalize(root))
  const right = fold(normalize(target))
  return right === left || right.startsWith(left.endsWith(sep) ? left : `${left}${sep}`)
}

/** Resolve one model-supplied path against the live cwd. */
function absolute(cwd, value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return isAbsolute(value) ? normalize(value) : resolve(cwd, value)
}

/** Whether a shell command mentions the work store or the database store. */
function shellMentions(command) {
  if (typeof command !== 'string') return { works: [], database: false }
  const works = []
  const pattern = /(^|[\s"'=:/\\])works[/\\]([^/\s"']+)/gu
  for (const match of command.matchAll(pattern)) works.push(match[2])
  const database = /(^|[\s"'=:/\\])\.storycraft([/\\]|$)/u.test(command)
  return { works, database }
}

/**
 * Decide one call.
 * @param {{tool: string, arguments?: object, cwd: string, worksRoot: string, dbRoot: string, currentWork?: string}} input - call facts.
 * @returns {string|undefined} denial copy, or undefined to allow.
 */
export function scopeDenial(input) {
  const tool = typeof input?.tool === 'string' ? input.tool : ''
  const args = input?.arguments ?? {}
  const cwd = typeof input?.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined
  const worksRoot = typeof input?.worksRoot === 'string' ? input.worksRoot : undefined
  const dbRoot = typeof input?.dbRoot === 'string' ? input.dbRoot : undefined
  if (cwd === undefined || worksRoot === undefined || dbRoot === undefined) return SCOPE_MESSAGES.discussion

  const check = (value) => {
    const target = absolute(cwd, value)
    if (target === undefined) return undefined
    if (within(dbRoot, target)) return SCOPE_MESSAGES.database
    if (!within(worksRoot, target)) return undefined
    if (typeof input.currentWork !== 'string' || input.currentWork === '') return SCOPE_MESSAGES.discussion
    if (within(join(worksRoot, input.currentWork), target)) return undefined
    return SCOPE_MESSAGES.otherWork
  }

  if (PATH_TOOLS.has(tool)) return check(args.file_path)

  if (SEARCH_TOOLS.has(tool)) {
    // Without an explicit path the tool recurses the whole workspace, works included.
    if (typeof args.path !== 'string' || args.path.trim() === '') return SCOPE_MESSAGES.search
    return check(args.path)
  }

  if (tool === 'working_directory') {
    if (typeof args.cd !== 'string' || args.cd.trim() === '') return undefined
    const target = absolute(cwd, args.cd)
    if (target === undefined) return undefined
    if (within(dbRoot, target) || within(worksRoot, target)) return SCOPE_MESSAGES.cd
    return undefined
  }

  if (SHELL_TOOLS.has(tool)) {
    const workdir = check(args.workdir)
    if (workdir !== undefined) return workdir
    const mentioned = shellMentions(args.command)
    if (mentioned.database) return SCOPE_MESSAGES.database
    if (mentioned.works.length === 0) return undefined
    const current = typeof input.currentWork === 'string' ? input.currentWork : ''
    for (const name of mentioned.works) {
      if (current === '' || name !== current) return SCOPE_MESSAGES.otherWork
    }
    return undefined
  }

  return undefined
}
