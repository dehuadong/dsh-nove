/** Resolve and compare paths against a workspace boundary. */

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

function canonical(value) {
  const text = path.resolve(value)
  let current = text
  const tail = []
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    tail.unshift(path.basename(current))
    current = parent
  }
  let base = current
  try { base = realpathSync.native(current) } catch { /* keep lexical current */ }
  return path.join(base, ...tail)
}

/** Expand home spellings and resolve a target, using real paths where possible. */
export function resolveTarget(raw, cwd) {
  let value = String(raw ?? '').trim().replace(/^["']|["']$/gu, '')
  value = value
    .replace(/%USERPROFILE%/giu, homedir())
    .replace(/\$\{?env:USERPROFILE\}?/giu, homedir())
    .replace(/\$\{?HOME\}?/gu, homedir())
    .replace(/^~(?=[\\/]|$)/u, homedir())
  return canonical(path.resolve(cwd, value))
}

/** Whether `target` is `root` or below it. */
export function isInside(target, root) {
  const child = canonical(target)
  const parent = canonical(root)
  const fold = value => (process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value)
  const childFold = fold(child)
  const parentFold = fold(parent)
  if (childFold === parentFold) return true
  return childFold.startsWith(`${parentFold}${path.sep}`)
}
