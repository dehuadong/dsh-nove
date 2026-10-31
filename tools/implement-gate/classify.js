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
  return undefined
}

/** Whether a relative path is documentation/repository governance. */
function isDocs(relative) {
  return relative === 'AGENTS.md'
    || relative === 'GATES.md'
    || relative === 'README.md'
    || relative === 'docs' || relative.startsWith('docs/')
    || relative === '.agents/notes' || relative.startsWith('.agents/notes/')
    || relative === '.agents/skills' || relative.startsWith('.agents/skills/')
    || relative === '.trash' || relative.startsWith('.trash/')
    || (relative.startsWith('tools/') && relative.endsWith('/README.md'))
}

/** Classify a file target relative to the workspace root. */
export function classifyPath(root, value) {
  const absolute = path.resolve(root, String(value ?? ''))
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  const outside = relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)
  const notes = !outside && (relative === '.agents/notes' || relative.startsWith('.agents/notes/'))
  const protectedPath = !outside && (relative === '.agents/implement-gate.json'
    || relative === '.agents/state/implement-gate' || relative.startsWith('.agents/state/implement-gate/'))
  return { absolute, relative, outside, notes, protected: protectedPath, docs: !outside && isDocs(relative) }
}

/** Write verbs and explicit shell redirection, excluding `=>` and `2>&1`. */
const WRITE_COMMAND = /(?:^|[\s;(])(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|Set-Item|rm|mv|cp|sed\s+-i)\b|(?:^|\s)>{1,2}(?!&)|git\s+(?:clean|checkout|reset)|(?:npm|pnpm)\s+(?:install|ci|run\s+build|build)|node\s+\S*build/iu

function pathArgs(text) {
  return [...String(text).matchAll(/(?:'([^']+)'|"([^"]+)"|(\S+))/gu)]
    .map(match => match[1] ?? match[2] ?? match[3])
    .filter(value => value !== undefined && !value.startsWith('-'))
}

function allDocs(root, values) {
  return values.length > 0 && values.every(value => {
    const target = classifyPath(root, value)
    return !target.outside && target.docs
  })
}

function stagedDocsOnly(root) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return false
  const files = String(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  return files.length > 0 && files.every(file => classifyPath(root, file).docs)
}

/** Split a compound shell line into independently classified segments. */
function segments(text) {
  return String(text).split(/&&|\|\||\||;|\r?\n/u).map(part => part.trim()).filter(Boolean)
}

/** Decide one shell segment; `write` means it mutates the workspace. */
function segmentAccess(text, root) {
  if (/\bgit\s+push\b/iu.test(text)) return { write: false, docsOnly: false }
  const add = /\bgit\s+add\b([\s\S]*)$/iu.exec(text)
  if (add !== null) {
    const args = pathArgs(add[1])
    return { write: true, docsOnly: allDocs(root, args) }
  }
  const move = /\bgit\s+mv\b([\s\S]*)$/iu.exec(text)
  if (move !== null) {
    const args = pathArgs(move[1])
    return { write: true, docsOnly: allDocs(root, args) }
  }
  if (/\bgit\s+commit\b/iu.test(text)) return { write: true, docsOnly: stagedDocsOnly(root) }
  const trash = /(?:^|\s)(?:node\s+)?[^\s]*trash\.mjs\b([\s\S]*)$/iu.exec(text)
  if (trash !== null) {
    const targets = pathArgs(trash[1])
    return { write: true, docsOnly: allDocs(root, targets) }
  }
  return { write: WRITE_COMMAND.test(text), docsOnly: false }
}

/**
 * Decide whether a shell command needs an implement authorization.
 * `docsOnly` commands are the Agent Note/roadmap lifecycle exceptions.
 */
export function shellAccess(command, root) {
  const parts = segments(command)
  const writes = parts.map(part => segmentAccess(part, root)).filter(item => item.write)
  return {
    write: writes.length > 0,
    docsOnly: writes.length > 0 && writes.every(item => item.docsOnly),
  }
}

/** Detect an absolute/outside write target in a shell line. */
export function shellOutside(command, root) {
  for (const match of String(command ?? '').matchAll(/(?:^|[\s'"])(?:[A-Za-z]:\\[^\s"']+|\/[A-Za-z][^\s"']*|\.[.][/\\][^\s"']*)/gu)) {
    const target = classifyPath(root, match[0].replace(/^[\s'"]+/u, ''))
    if (target.outside) return true
  }
  return false
}
