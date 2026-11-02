/** Load and validate one workspace's implement-gate policy. */

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const MARKER = '.agents/implement-gate.json'
export const STATE_DIR = '.agents/state/implement-gate'
export const DEFAULT_PROTECTED = [MARKER, STATE_DIR]
const ALLOWED_KEYS = new Set(['enabled', 'version', 'codeRoots', 'codeFiles', 'protected', 'proposed', 'commands'])
const COMMAND_KEYS = ['planning', 'implement', 'docs']

function normalizePath(value, label) {
  if (typeof value !== 'string') return undefined
  const text = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
  if (text === '' || text === '.') return text === '' ? undefined : '.'
  if (path.isAbsolute(text) || /^[A-Za-z]:/u.test(text) || text.startsWith('//')) return undefined
  if (text.split('/').includes('..') || /[*?[\]{}]/u.test(text)) return undefined
  return text
}

function normalizeList(value, label) {
  if (!Array.isArray(value)) return undefined
  const result = []
  for (const item of value) {
    const normalized = normalizePath(item, label)
    if (normalized === undefined) return undefined
    if (!result.includes(normalized)) result.push(normalized)
  }
  return result
}

function compileCommands(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (Object.keys(value).some(key => !COMMAND_KEYS.includes(key))) return undefined
  const commands = {}
  for (const key of COMMAND_KEYS) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string' || value[key] === '') return undefined
    try {
      commands[key] = new RegExp(value[key], 'u')
    } catch {
      return undefined
    }
  }
  if (commands.implement === undefined) return undefined
  return commands
}

/**
 * Resolve the marker for a workspace.
 * missing: no marker (pass-through); disabled: enabled:false; invalid: fail closed; ok: policy.
 */
export function loadConfig(root) {
  const configPath = path.join(root, MARKER)
  let raw
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (error) {
    return error?.code === 'ENOENT'
      ? { kind: 'missing', configPath }
      : { kind: 'invalid', configPath, reason: `cannot read ${MARKER}` }
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', configPath, reason: `${MARKER} is not valid JSON` }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'invalid', configPath, reason: `${MARKER} must be an object` }
  }
  if (value.enabled === false) return { kind: 'disabled', configPath }
  if (value.enabled !== true) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.enabled must be boolean true` }
  }
  if (Object.keys(value).some(key => !ALLOWED_KEYS.has(key))) {
    return { kind: 'invalid', configPath, reason: `${MARKER} has an unknown key` }
  }
  if (value.version !== 1) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.version must be 1` }
  }
  const codeRoots = normalizeList(value.codeRoots, 'codeRoots')
  if (codeRoots === undefined || codeRoots.length === 0) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.codeRoots must be a non-empty list` }
  }
  const codeFiles = value.codeFiles === undefined ? [] : normalizeList(value.codeFiles, 'codeFiles')
  if (codeFiles === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.codeFiles must be a path list` }
  }
  const configuredProtected = value.protected === undefined ? [] : normalizeList(value.protected, 'protected')
  if (configuredProtected === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.protected must be a path list` }
  }
  const proposed = value.proposed === undefined ? undefined : normalizePath(value.proposed, 'proposed')
  if (value.proposed !== undefined && proposed === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.proposed must be a relative path` }
  }
  const commands = compileCommands(value.commands)
  if (commands === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.commands must define a valid implement regex` }
  }
  const protectedPaths = [...new Set([...DEFAULT_PROTECTED, ...configuredProtected])]
  return { kind: 'ok', configPath, policy: { version: 1, codeRoots, codeFiles, protected: protectedPaths, proposed, commands } }
}
