/** Pure decisions for the implement gate; the Host plugin owns state and dispatch. */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Normalize a user message before exact gate matching. */
export function normalizeMessage(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/** Compare paths case-insensitively on Windows/macOS, byte-wise on Linux. */
export function foldPath(value) {
  const text = String(value ?? '').replaceAll('\\', '/').replace(/\/+$/u, '')
  return process.platform === 'win32' || process.platform === 'darwin' ? text.toLowerCase() : text
}

/** Whether `relative` is `base` or below it, using platform case folding. */
export function isWithin(relative, base) {
  const child = foldPath(relative)
  const parent = foldPath(base)
  return child === parent || child.startsWith(`${parent}/`)
}

/**
 * Match a gate command only from an owner-authored, whole user message.
 * `parentSession` is historical and does not classify a subagent; `origin` does.
 */
export function gateCommand(message, header, commands) {
  if (message === undefined || message === null) return undefined
  if (message.source?.kind !== 'user' || message.source.principal !== undefined) return undefined
  if (header?.origin === 'subagent') return undefined
  const text = normalizeMessage((message.content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join(''))
  for (const kind of ['implement', 'planning', 'docs']) {
    const pattern = commands?.[kind]
    if (pattern === undefined) continue
    const match = pattern.exec(text)
    if (match === null || match[0] !== text || match[1] === undefined || match[1].trim() === '') continue
    return { kind, task: match[1].trim() }
  }
  return undefined
}

const DOC_EXT = /\.(?:md|mdx|txt|rst|adoc)$/iu

function isCode(relative, policy) {
  const target = foldPath(relative)
  if (policy.codeFiles.some(file => foldPath(file) === target)) return true
  const underRoot = policy.codeRoots.some(root => isWithin(relative, root))
  return underRoot && !DOC_EXT.test(relative)
}

function isProtected(relative, policy) {
  return policy.protected.some(entry => isWithin(relative, entry))
}

/** Classify a file target relative to the workspace root. */
export function classifyPath(root, value, policy) {
  const absolute = path.resolve(root, String(value ?? ''))
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  const outside = relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)
  const notes = !outside && (relative === '.agents/notes' || relative.startsWith('.agents/notes/'))
  const proposed = !outside && policy.proposed !== undefined && isWithin(relative, policy.proposed)
  const protectedPath = !outside && isProtected(relative, policy)
  const code = !outside && isCode(relative, policy)
  return {
    absolute,
    relative,
    outside,
    notes,
    proposed,
    code,
    protected: protectedPath,
    docs: !outside && !code && !protectedPath,
  }
}

/** Write verbs and explicit shell redirection, excluding `=>` and `2>&1`. */
const WRITE_COMMAND = /(?:^|[\s;(])(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|Set-Item|rm|mv|cp|sed\s+-i)\b|(?:^|\s)>{1,2}(?!&)|git\s+(?:clean|checkout|reset)|(?:npm|pnpm)\s+(?:install|ci|run\s+build|build)|node\s+\S*build/iu

function pathArgs(text) {
  const beforePipe = String(text).split('|')[0]
  return [...beforePipe.matchAll(/(?:'([^']+)'|"([^"]+)"|(\S+))/gu)]
    .map(match => match[1] ?? match[2] ?? match[3])
    .filter(value => value !== undefined && !value.startsWith('-'))
}

/** Aggregate docs/proposed/protected classification and explicit targets. */
function pathInfo(root, values, policy, cwd) {
  let docsOnly = values.length > 0
  let touchesProposed = false
  const protectedTargets = []
  const targets = []
  for (const value of values) {
    const target = classifyPath(root, path.resolve(cwd, value), policy)
    if (target.outside || !target.docs) docsOnly = false
    if (target.proposed) touchesProposed = true
    if (target.protected) protectedTargets.push(target.relative)
    targets.push(target.absolute)
  }
  return { docsOnly, touchesProposed, protectedTargets, targets }
}

function stagedInfo(root, policy) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) {
    return { docsOnly: false, touchesProposed: false, protectedTargets: [], targets: [] }
  }
  const files = String(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  return pathInfo(root, files, policy, root)
}

/** Split on statement boundaries, but keep a pipeline as one statement. */
function segments(text) {
  return String(text).split(/&&|\|\||;|\r?\n/u).map(part => part.trim()).filter(Boolean)
}

/** Decide one shell segment; `write` means it mutates the workspace. */
function segmentAccess(text, root, policy, cwd) {
  if (/\bgit\s+push\b/iu.test(text)) {
    return { write: false, docsOnly: false, touchesProposed: false, protectedTargets: [], targets: [] }
  }
  const add = /\bgit\s+add\b([\s\S]*)$/iu.exec(text)
  if (add !== null) {
    const info = pathInfo(root, pathArgs(add[1]), policy, cwd)
    return { write: true, ...info }
  }
  const move = /\bgit\s+mv\b([\s\S]*)$/iu.exec(text)
  if (move !== null) {
    const info = pathInfo(root, pathArgs(move[1]), policy, cwd)
    return { write: true, ...info }
  }
  if (/\bgit\s+commit\b/iu.test(text)) {
    const info = stagedInfo(root, policy)
    return { write: true, ...info }
  }
  const trash = /(?:^|\s)(?:node\s+)?[^\s]*trash\.mjs\b([\s\S]*)$/iu.exec(text)
  if (trash !== null) {
    const info = pathInfo(root, pathArgs(trash[1]), policy, cwd)
    return { write: true, ...info }
  }
  return { write: WRITE_COMMAND.test(text), docsOnly: false, touchesProposed: false, protectedTargets: [], targets: [] }
}

/**
 * Decide whether a shell command needs an implement authorization.
 * `docsOnly` marks documentation operations; `targets` lets the caller enforce
 * a document scope; protected/proposed remain explicit exceptions.
 */
export function shellAccess(command, root, policy, cwd = root) {
  const writes = segments(command).map(part => segmentAccess(part, root, policy, cwd)).filter(item => item.write)
  return {
    write: writes.length > 0,
    docsOnly: writes.length > 0 && writes.every(item => item.docsOnly),
    touchesProposed: writes.some(item => item.touchesProposed),
    protectedTargets: writes.flatMap(item => item.protectedTargets ?? []),
    targets: writes.flatMap(item => item.targets ?? []),
  }
}

/** Detect an absolute/outside write target in a shell line. */
export function shellOutside(command, root) {
  // A here-string is script content, not shell path syntax; scanning its
  // imports would flag relative specifiers like ../src as outside writes.
  const text = String(command ?? '').replace(/@'[\s\S]*?'@/gu, ' ').replace(/@"[\s\S]*?"@/gu, ' ')
  for (const match of text.matchAll(/(?:^|[\s'"])(?:[A-Za-z]:\\[^\s"']+|\/[A-Za-z][^\s"']*|\.[.][/\\][^\s"']*)/gu)) {
    const raw = match[0].replace(/^[\s'"]+/u, '')
    const target = path.resolve(root, raw)
    const relative = path.relative(root, target).replaceAll('\\', '/')
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return true
  }
  return false
}
