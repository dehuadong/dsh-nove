/**
 * Workspace scope guard: decide whether one tool call may touch the work store.
 *
 * The store lives under `<workspace>/works`; the future SQLite store lives under
 * `<workspace>/.storycraft`. A session may read only the work it is pointed at,
 * and no session may touch the database files directly. The predicate is pure,
 * synchronous and total: malformed input denies instead of throwing.
 */

import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

/** Denial copy, fixed so acceptance can assert it. */
export const SCOPE_MESSAGES = {
  discussion: '讨论阶段不读历史作品：请先在面板进入一部作品，或给 path 限定到项目目录。',
  otherWork: '只能访问当前作品：works/<其他作品> 不在当前会话的作用域内。',
  search: '检索默认会扫进 works/：请给 path 限定到项目目录或当前作品。',
  database: '不直接访问作品库：读内容用 story_brief/story_context/story_bible；story_export 只供作者导出取用。',
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

/**
 * Split a shell command into rough path tokens (quotes stripped).
 * @param {string} command - shell command text.
 * @returns {string[]} tokens.
 */
function shellTokens(command) {
  const tokens = []
  for (const raw of String(command).split(/[\s;|&]+/u)) {
    const token = raw.replace(/^["']|["']$/gu, '')
    if (token === '') continue
    tokens.push(token)
    // `--directory=works` and `x=works/y` carry the path after '='.
    const equals = token.indexOf('=')
    if (equals !== -1 && equals + 1 < token.length) tokens.push(token.slice(equals + 1))
  }
  return tokens
}

/**
 * Store a shell command can reach: `database`, `works` (with a work name when
 * the token names one), or nothing.
 * @param {string} command - shell command text.
 * @param {string} cwd - live working directory.
 * @param {string} worksRoot - protected work root.
 * @param {string} dbRoot - protected database root.
 * @returns {{database: boolean, works: Array<string|undefined>}} hits.
 */
function shellHits(command, cwd, worksRoot, dbRoot) {
  const hits = { database: false, works: [] }
  for (const token of shellTokens(command)) {
    const target = absolute(cwd, token)
    if (target === undefined) continue
    if (within(dbRoot, target)) {
      hits.database = true
      continue
    }
    if (!within(worksRoot, target)) continue
    const rest = target.slice(shellLength(worksRoot)).replace(/^[/\\]/u, '')
    const name = rest.split(/[/\\]/u)[0]
    hits.works.push(name === '' ? undefined : name)
  }
  return hits
}

/** Length of the root prefix, tolerating a trailing separator. */
function shellLength(root) {
  const normalized = normalize(root)
  return normalized.endsWith(sep) ? normalized.length - 1 : normalized.length
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
    const target = absolute(cwd, args.path)
    // A path at or above the work store still recurses into it (and .storycraft).
    if (target !== undefined && within(target, worksRoot)) return SCOPE_MESSAGES.search
    const denial = check(args.path)
    if (denial !== undefined) return denial
    if (typeof args.include !== 'string' || args.include.trim() === '') return undefined
    return check(isAbsolute(args.include) ? args.include : join(args.path, args.include))
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
    const mentioned = shellHits(args.command, cwd, worksRoot, dbRoot)
    if (mentioned.database) return SCOPE_MESSAGES.database
    if (mentioned.works.length === 0) return undefined
    const current = typeof input.currentWork === 'string' ? input.currentWork : ''
    if (current === '') return SCOPE_MESSAGES.discussion
    for (const name of mentioned.works) {
      // A bare `works` (listing/Set-Location) cannot be proven to stay inside the
      // current work, so it is treated as reaching the whole store.
      if (name === undefined || fold(name) !== fold(current)) return SCOPE_MESSAGES.otherWork
    }
    return undefined
  }

  return undefined
}
