/** Pure decisions for the implement gate; the Host plugin owns state and dispatch. */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Normalize a user message before exact gate matching. */
export function normalizeMessage(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/**
 * Match a gate command only from an owner-authored, whole user message.
 * @param {{content?: unknown, source?: {kind?: string, principal?: unknown}} | undefined} message
 * @param {{parentSession?: unknown, origin?: string} | undefined} header
 * @returns {{kind: 'implement' | 'planning', task: string} | undefined}
 */
export function gateCommand(message, header) {
  if (message === undefined || message === null) return undefined
  if (message.source?.kind !== 'user' || message.source.principal !== undefined) return undefined
  if (header?.parentSession !== undefined || header?.origin === 'subagent') return undefined
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

/** Classify a file target relative to the workspace root. */
export function classifyPath(root, value) {
  const absolute = path.resolve(root, String(value ?? ''))
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  const outside = relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)
  const docs = !outside && (relative === 'docs' || relative.startsWith('docs/')
    || relative === '.agents/notes' || relative.startsWith('.agents/notes/')
    || relative === '.trash' || relative.startsWith('.trash/'))
  return { absolute, relative, outside, docs }
}

/** Commands that mutate files, for the conservative shell classifier. */
const WRITE_COMMAND = /(?:^|[\s;(])(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|Set-Item|rm|mv|cp|sed\s+-i)\b|(?:^|[^>])>{1,2}|git\s+(?:add|commit|clean|checkout|reset)|npm\s+install|pnpm\s+install|node\s+\S*build/iu

/** Parse simple path arguments without trying to be a shell parser. */
function pathArgs(text) {
  return [...String(text).matchAll(/(?:'([^']+)'|"([^"]+)"|(\S+))/gu)]
    .map(match => match[1] ?? match[2] ?? match[3])
    .filter(value => value !== undefined && !value.startsWith('-') && !value.startsWith('/'))
}

function docsOnly(root, values) {
  if (values.length === 0) return false
  return values.every(value => {
    const target = classifyPath(root, value)
    return !target.outside && target.docs
  })
}

function stagedDocsOnly(root) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return false
  const files = String(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  if (files.length === 0) return true
  return files.every(file => classifyPath(root, file).docs)
}

/**
 * Decide whether a shell command needs an implement authorization.
 * `docsOnly` commands are the Agent Note/roadmap lifecycle exceptions.
 */
export function shellAccess(command, root) {
  const text = String(command ?? '')
  if (/\bgit\s+push\b/iu.test(text)) return { write: false, docsOnly: true }
  const add = /\bgit\s+add\b([\s\S]*)$/iu.exec(text)
  if (add !== null) {
    const args = pathArgs(add[1])
    return { write: true, docsOnly: docsOnly(root, args) }
  }
  if (/\bgit\s+commit\b/iu.test(text)) return { write: true, docsOnly: stagedDocsOnly(root) }
  const trash = /(?:^|\s)(?:node\s+)?[^\s]*trash\.mjs\b([\s\S]*)$/iu.exec(text)
  if (trash !== null) {
    const targets = pathArgs(trash[1])
    return { write: true, docsOnly: docsOnly(root, targets) }
  }
  return { write: WRITE_COMMAND.test(text), docsOnly: false }
}
