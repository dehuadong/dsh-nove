/** Pure decisions for the implement gate; the Host plugin owns state and dispatch. */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Normalize a user message before exact gate matching. */
export function normalizeMessage(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/**
 * Match a gate command only from an owner-authored, whole user message.
 * `parentSession` is historical and does not classify a subagent; `origin` does.
 */
export function gateCommand(message, header) {
  if (message === undefined || message === null) return undefined
  if (message.source?.kind !== 'user' || message.source.principal !== undefined) return undefined
  if (header?.origin === 'subagent') return undefined
  const text = normalizeMessage((message.content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join(''))
  const implement = /^批准，使用(?:技能\s*)?implement\s+执行实现\s+(.+)$/u.exec(text)
  if (implement !== null && implement[1].trim() !== '') return { kind: 'implement', task: implement[1].trim() }
  const planning = /^批准，使用(?:技能\s*)?planning\s+执行规划\s+(.+)$/u.exec(text)
  if (planning !== null && planning[1].trim() !== '') return { kind: 'planning', task: planning[1].trim() }
  const docs = /^批准，执行文档治理\s+(.+)$/u.exec(text)
  if (docs !== null && docs[1].trim() !== '') return { kind: 'docs', task: docs[1].trim() }
  return undefined
}

const CODE_PREFIXES = [
  'storycraft/src',
  'storycraft/tests',
  'storycraft/scripts',
  'storycraft/e2e',
  'storycraft/lib',
  'tools',
  'scripts',
  '.github',
  'deepseek-harness',
]
const CODE_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.client.json',
  'cordis.patch.yml',
  '.gitignore',
  'storycraft/package.json',
  'storycraft/package-lock.json',
  'storycraft/tsconfig.json',
  'storycraft/tsconfig.client.json',
])
const DOC_EXT = /\.(?:md|mdx|txt|rst|adoc)$/iu

/** Code/config paths; documentation suffixes inside a code directory stay docs. */
function isCode(relative) {
  if (CODE_FILES.has(relative)) return true
  const underCodeDir = CODE_PREFIXES.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))
  return underCodeDir && !DOC_EXT.test(relative)
}

/** Classify a file target relative to the workspace root. */
export function classifyPath(root, value) {
  const absolute = path.resolve(root, String(value ?? ''))
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  const outside = relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)
  const notes = !outside && (relative === '.agents/notes' || relative.startsWith('.agents/notes/'))
  const proposed = !outside && (relative === '.agents/notes/proposed' || relative.startsWith('.agents/notes/proposed/'))
  const protectedPath = !outside && (relative === '.agents/implement-gate.json'
    || relative === '.agents/state/implement-gate' || relative.startsWith('.agents/state/implement-gate/'))
  const code = !outside && isCode(relative)
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
  return [...String(text).matchAll(/(?:'([^']+)'|"([^"]+)"|(\S+))/gu)]
    .map(match => match[1] ?? match[2] ?? match[3])
    .filter(value => value !== undefined && !value.startsWith('-'))
}

/** Aggregate docs/proposed classification and explicit targets for a shell segment. */
function pathInfo(root, values) {
  let docsOnly = values.length > 0
  let touchesProposed = false
  for (const value of values) {
    const target = classifyPath(root, value)
    if (target.outside || !target.docs) docsOnly = false
    if (target.proposed) touchesProposed = true
  }
  return { docsOnly, touchesProposed, targets: values }
}

function stagedInfo(root) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return { docsOnly: false, touchesProposed: false, targets: [] }
  const files = String(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  return pathInfo(root, files)
}

/** Split a compound shell line into independently classified segments. */
function segments(text) {
  return String(text).split(/&&|\|\||\||;|\r?\n/u).map(part => part.trim()).filter(Boolean)
}

/** Decide one shell segment; `write` means it mutates the workspace. */
function segmentAccess(text, root) {
  if (/\bgit\s+push\b/iu.test(text)) return { write: false, docsOnly: false, touchesProposed: false, targets: [] }
  const add = /\bgit\s+add\b([\s\S]*)$/iu.exec(text)
  if (add !== null) {
    const info = pathInfo(root, pathArgs(add[1]))
    return { write: true, ...info }
  }
  const move = /\bgit\s+mv\b([\s\S]*)$/iu.exec(text)
  if (move !== null) {
    const info = pathInfo(root, pathArgs(move[1]))
    return { write: true, ...info }
  }
  if (/\bgit\s+commit\b/iu.test(text)) {
    const info = stagedInfo(root)
    return { write: true, ...info }
  }
  const trash = /(?:^|\s)(?:node\s+)?[^\s]*trash\.mjs\b([\s\S]*)$/iu.exec(text)
  if (trash !== null) {
    const info = pathInfo(root, pathArgs(trash[1]))
    return { write: true, ...info }
  }
  return { write: WRITE_COMMAND.test(text), docsOnly: false, touchesProposed: false, targets: [] }
}

/**
 * Decide whether a shell command needs an implement authorization.
 * `docsOnly` marks documentation operations; `targets` lets the caller enforce
 * a document scope, and `touchesProposed` keeps proposed notes planning-gated.
 */
export function shellAccess(command, root) {
  const writes = segments(command).map(part => segmentAccess(part, root)).filter(item => item.write)
  return {
    write: writes.length > 0,
    docsOnly: writes.length > 0 && writes.every(item => item.docsOnly),
    touchesProposed: writes.some(item => item.touchesProposed),
    targets: writes.flatMap(item => item.targets ?? []),
  }
}

/** Detect an absolute/outside write target in a shell line. */
export function shellOutside(command, root) {
  // A here-string is script content, not shell path syntax; scanning its
  // imports would flag relative specifiers like ../src as outside writes.
  const text = String(command ?? '').replace(/@'[\s\S]*?'@/gu, ' ').replace(/@"[\s\S]*?"@/gu, ' ')
  for (const match of text.matchAll(/(?:^|[\s'"])(?:[A-Za-z]:\\[^\s"']+|\/[A-Za-z][^\s"']*|\.[.][/\\][^\s"']*)/gu)) {
    const target = classifyPath(root, match[0].replace(/^[\s'"]+/u, ''))
    if (target.outside) return true
  }
  return false
}
