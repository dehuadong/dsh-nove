/** Locate and validate one workspace's implement-gate policy (version 2). */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const MARKER = '.agents/implement-gate.json'
export const STATE_DIR = '.agents/state/implement-gate'
export const PROJECT_ANCHOR = '.git'
export const DEFAULT_PROTECTED = [MARKER, STATE_DIR]

/** Every directory from `start` up to the filesystem root, nearest first. */
function upward(start) {
  const list = []
  let current = path.resolve(start)
  for (;;) {
    list.push(current)
    const parent = path.dirname(current)
    if (parent === current) return list
    current = parent
  }
}

/** The nearest directory at or above `workspace` that holds `name`. */
function nearest(workspace, name) {
  for (const dir of upward(workspace)) {
    if (existsSync(path.join(dir, name))) return dir
  }
  return undefined
}

/**
 * The nearest directory at or above `workspace` that holds the gate marker.
 * A session opened in a subdirectory therefore inherits its project's policy.
 * @param workspace - absolute session workspace root.
 * @returns the marker directory, or undefined when no project opts in.
 */
export function findGateRoot(workspace) {
  return nearest(workspace, MARKER)
}

/**
 * The nearest repository root at or above `workspace`.
 * @param workspace - absolute session workspace root.
 * @returns the directory holding `.git`, or undefined outside a repository.
 */
export function findProjectRoot(workspace) {
  return nearest(workspace, PROJECT_ANCHOR)
}

const ALLOWED_KEYS = new Set(['enabled', 'version', 'codeExtensions', 'codePaths', 'protected', 'proposed', 'commands'])
const COMMAND_KEYS = ['planning', 'implement', 'docs']

function normalizePath(value, { allowTrailingSlash = false } = {}) {
  if (typeof value !== 'string') return undefined
  const raw = value.trim().replaceAll('\\', '/')
  if (raw === '' || raw === '.' || raw.startsWith('//')) return undefined
  const trailing = allowTrailingSlash && raw.endsWith('/')
  const text = raw.replace(/\/+$/u, '')
  if (text === '' || text === '.') return undefined
  if (path.isAbsolute(text) || /^[A-Za-z]:/u.test(text)) return undefined
  if (text.split('/').includes('..') || /[*?[\]{}]/u.test(text)) return undefined
  return trailing ? `${text}/` : text
}

function normalizeList(value, options) {
  if (!Array.isArray(value)) return undefined
  const result = []
  for (const item of value) {
    const normalized = normalizePath(item, options)
    if (normalized === undefined) return undefined
    if (!result.includes(normalized)) result.push(normalized)
  }
  return result
}

function normalizeExtensions(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') return undefined
    const text = item.trim().toLowerCase()
    if (!/^\.[a-z0-9]+$/u.test(text)) return undefined
    if (!result.includes(text)) result.push(text)
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

/** Resolve the marker for a workspace. */
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
  return validateConfig(value, configPath)
}

/**
 * Validate one parsed policy object.
 * @param value - parsed policy JSON.
 * @param configPath - marker path used in diagnostics.
 * @returns the enabled policy, or the disabled/invalid outcome.
 */
export function validateConfig(value, configPath) {
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
  if (value.version !== 2) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.version must be 2` }
  }
  const codeExtensions = normalizeExtensions(value.codeExtensions)
  if (codeExtensions === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.codeExtensions must be a non-empty list like ".ts"` }
  }
  const codePaths = value.codePaths === undefined ? [] : normalizeList(value.codePaths, { allowTrailingSlash: true })
  if (codePaths === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.codePaths must be a relative path list` }
  }
  const configuredProtected = value.protected === undefined ? [] : normalizeList(value.protected)
  if (configuredProtected === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.protected must be a path list` }
  }
  const proposed = value.proposed === undefined ? undefined : normalizePath(value.proposed)
  if (value.proposed !== undefined && proposed === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.proposed must be a relative path` }
  }
  const commands = compileCommands(value.commands)
  if (commands === undefined) {
    return { kind: 'invalid', configPath, reason: `${MARKER}.commands must define a valid implement regex` }
  }
  const protectedPaths = [...new Set([...DEFAULT_PROTECTED, ...configuredProtected])]
  return {
    kind: 'ok',
    configPath,
    policy: { version: 2, codeExtensions, codePaths, protected: protectedPaths, proposed, commands },
  }
}
