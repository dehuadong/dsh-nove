/**
 * Static classifier for shell commands that delete, move, or overwrite.
 *
 * Pure and dependency-free so it can be exercised without a Harness: the caller
 * passes the command text and the roots that may be modified, and gets back
 * either "nothing destructive" or the concrete targets that fall outside them.
 *
 * This is a guard against mistakes, not a security boundary: a deliberately
 * obfuscated command can slip past a static check. Its job is to stop the
 * ordinary shape of an accident — a destructive verb pointed at a user-level
 * directory — before the tool is dispatched.
 */

import { homedir } from 'node:os'
import path from 'node:path'

/** Destructive forms worth stopping. `rm`/`del`/`rd` only count in command position. */
const VERBS = [
  { re: /\bRemove-Item\b/iu, label: 'Remove-Item' },
  { re: /\bClear-Content\b/iu, label: 'Clear-Content' },
  { re: /\bMove-Item\b/iu, label: 'Move-Item' },
  { re: /(?:^|[;&|(\n]\s*)(rm)\s+/u, label: 'rm' },
  { re: /(?:^|[;&|(\n]\s*)(rmdir|rd)\s+/iu, label: 'rmdir/rd' },
  { re: /(?:^|[;&|(\n]\s*)(del|erase)\s+/iu, label: 'del/erase' },
  { re: /\brobocopy\b[^\n]*\/(?:mir|purge|move)\b/iu, label: 'robocopy /mir|/purge|/move' },
  { re: /::Delete(?:Directory|File)?\s*\(/u, label: '.NET Delete' },
  { re: /\bshutil\.rmtree\b|\bos\.(?:remove|unlink)\b/u, label: 'python delete' },
  { re: /\b(?:rmSync|rmdirSync|unlinkSync)\s*\(/u, label: 'node fs delete' },
  { re: /\bgit\s+clean\s+-[a-z]*[xdf]/iu, label: 'git clean -x/-d/-f' },
]

/** Shapes that make a token a filesystem path rather than an option or a word. */
const PATH_SHAPE = /^(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\\\\|\/(?!\/)|%USERPROFILE%|\$env:USERPROFILE|\$HOME\b|\$\{HOME\})/iu

/** A token that does not start like a path but still names a relative target. */
const RELATIVE_SHAPE = /^[^\s"'=;|&<>-]/u

/**
 * Match the first destructive verb in a command.
 * @param {string} command - raw shell text.
 * @returns {{ label: string, index: number, length: number } | undefined} the match.
 */
export function matchVerb(command) {
  let best
  for (const verb of VERBS) {
    const found = verb.re.exec(command)
    if (found === null) continue
    const at = found.index + found[0].indexOf(found[1] ?? found[0])
    if (best === undefined || at < best.index) {
      best = { label: verb.label, index: at, length: (found[1] ?? found[0]).length }
    }
  }
  return best
}

/**
 * Expand the home and environment spellings a shell command may use.
 * @param {string} raw - one candidate token.
 * @param {string} cwd - base for relative targets.
 * @returns {string} an absolute path.
 */
export function resolveTarget(raw, cwd) {
  let value = raw.trim().replace(/^["']|["']$/gu, '')
  value = value
    .replace(/%USERPROFILE%/giu, homedir())
    .replace(/\$\{?env:USERPROFILE\}?/giu, homedir())
    .replace(/\$\{?HOME\}?/gu, homedir())
    .replace(/^~(?=[\\/]|$)/u, homedir())
  return path.resolve(cwd, value)
}

/**
 * Whether `target` is `root` or lies below it, case-insensitively on Windows.
 * @param {string} target - absolute path.
 * @param {string} root - absolute path.
 * @returns {boolean} true when the target is inside the root.
 */
export function isInside(target, root) {
  const norm = (value) => {
    const resolved = path.resolve(value).replace(/[\\/]+$/u, '')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const child = norm(target)
  const parent = norm(root)
  if (child === parent) return true
  const sep = process.platform === 'win32' ? '\\' : '/'
  return child.startsWith(`${parent}${sep}`)
}

/**
 * Collect the targets a destructive command names, quoted or bare.
 * @param {string} command - raw shell text.
 * @param {{ label: string, index: number, length: number }} verb - the matched verb.
 * @returns {string[]} candidate targets, deduplicated in first-seen order.
 */
export function collectTargets(command, verb) {
  const found = []
  const add = (value) => {
    if (value === undefined || value === '') return
    const token = value.trim().replace(/^["']|["']$/gu, '')
    if (token === '') return
    if (!found.includes(token)) found.push(token)
  }

  for (const match of command.matchAll(/"([^"]+)"|'([^']+)'/gu)) {
    const token = match[1] ?? match[2]
    // A quoted message such as "exit=$LASTEXITCODE" is not a target; only
    // path-shaped quotes are.
    if (PATH_SHAPE.test(token) || (/[\\/]/u.test(token) && !/^\w+=/u.test(token))) add(token)
  }
  for (const match of command.matchAll(/(?:^|[\s(])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\\\\|\/(?!\/))[^\s"';|)&]*)/gu)) {
    add(match[1])
  }

  // Every non-option token after the verb is an operand: `rm -rf a b` and
  // `Move-Item from to` both name more than one target.
  const tail = command.slice(verb.index + verb.length)
  for (const token of tail.split(/[\s;|&]+/u)) {
    if (token === '' || token.startsWith('-')) continue
    // A PowerShell switch such as `/mir` is not a target; a drive path is.
    if (token.startsWith('/') && !/^[A-Za-z]:/u.test(token)) continue
    if (PATH_SHAPE.test(token) || RELATIVE_SHAPE.test(token)) add(token)
    if (found.length >= 8) break
  }
  return found
}

/**
 * Decide whether one statement's targets may be modified.
 * @param {string} statement - one newline- or `;`-delimited statement.
 * @param {{ allowedRoots: string[], cwd: string }} options - roots that may be modified.
 * @returns {{ verb: string, targets: { raw: string, resolved?: string, why: string }[] } | undefined} failure.
 */
function classifyStatement(statement, options) {
  const verb = matchVerb(statement)
  if (verb === undefined) return undefined

  // `git clean` and a bare cmdlet operate on the current directory: the working
  // directory is the target. A pipeline feeding the verb is different — the real
  // operand is whatever the upstream produced, so it cannot be bounded.
  const raw = collectTargets(statement, verb)
  if (raw.length === 0) {
    const upstream = statement.slice(0, verb.index)
    if (upstream.includes('|') || upstream.includes('&')) {
      return { verb: verb.label, targets: [{ raw: '(pipeline)', why: 'unknown' }] }
    }
    raw.push(options.cwd)
  }
  const targets = raw.map(value => ({ raw: value, why: 'named' }))

  const violations = []
  const knownEnv = /^(?:%USERPROFILE%|\$env:USERPROFILE|\$HOME\b|\$\{HOME\}|~)/iu
  for (const target of targets) {
    if (/[$%]/u.test(target.raw) && !knownEnv.test(target.raw)) {
      // A variable operand hides the real path; refusing is the only safe read.
      violations.push({ ...target, why: 'unknown' })
      continue
    }
    if (/[*?]/u.test(target.raw)) {
      violations.push({ ...target, why: 'wildcard' })
      continue
    }
    const resolved = resolveTarget(target.raw, options.cwd)
    if (!options.allowedRoots.some(root => isInside(resolved, root))) {
      violations.push({ ...target, resolved, why: 'outside' })
    }
  }
  return violations.length === 0 ? undefined : { verb: verb.label, targets: violations }
}

/**
 * Decide whether a command may run against the allowed roots.
 *
 * Each statement is classified on its own: an unrelated quoted string in an
 * earlier line must not count as a target, and a second statement must not hide
 * behind a harmless first one.
 * @param {string} command - raw shell text.
 * @param {{ allowedRoots: string[], cwd: string }} options - roots that may be modified.
 * @returns {{ ok: true } | { ok: false, verb: string, targets: { raw: string, resolved?: string, why: string }[] }} verdict.
 */
export function classifyCommand(command, options) {
  const failures = []
  for (const statement of command.split(/[\n;]/u)) {
    const failure = classifyStatement(statement, options)
    if (failure !== undefined) failures.push(failure)
  }
  if (failures.length === 0) return { ok: true }
  return {
    ok: false,
    verb: failures[0].verb,
    targets: failures.flatMap(failure => failure.targets),
  }
}

/**
 * Render a denial reason the model can act on.
 * @param {Exclude<ReturnType<typeof classifyCommand>, { ok: true }>} verdict - the failure.
 * @param {{ allowedRoots: string[], trashHint?: string }} options - reporting context.
 * @returns {string} one reason string.
 */
export function describeDenial(verdict, options) {
  const detail = verdict.targets
    .map(target => {
      const suffix = target.why === 'wildcard'
        ? '（含通配符，无法确定范围）'
        : target.why === 'unknown'
          ? '（由变量拼接，无法静态确定）'
          : target.why === 'implicit-cwd'
            ? '（未写目标，按当前目录处理）'
            : ''
      return `${target.resolved ?? target.raw}${suffix}`
    })
    .join('、')
  const trash = options.trashHint === undefined
    ? '改用可还原的删除方式'
    : `改用可还原的删除：node ${options.trashHint} <路径>（--restore 还原）`
  return `[shell-guard] 拒绝执行：${verdict.verb} 的目标在工作区外（${detail}）。`
    + `允许修改的根：${options.allowedRoots.join('、')}。`
    + `${trash}；确需删除工作区外内容时，先向作者申请一次性授权并说明完整路径。`
}
