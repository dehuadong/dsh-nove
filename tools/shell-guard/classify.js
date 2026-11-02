/**
 * Static classifier for shell commands that delete, move, copy, create, or write.
 *
 * Pure and dependency-free except for path-boundary. The caller passes the
 * command and the roots that may be modified; a destructive/write target
 * outside those roots is denied. This is an accident guard, not a sandbox.
 */

import { isInside, resolveTarget } from './path-boundary.js'

export { isInside, resolveTarget }

/** Deletion, movement, copy, and explicit write verbs. */
const VERBS = [
  { re: /\bRemove-Item\b/iu, label: 'Remove-Item' },
  { re: /\bClear-Content\b/iu, label: 'Clear-Content' },
  { re: /\bMove-Item\b/iu, label: 'Move-Item' },
  { re: /\bCopy-Item\b/iu, label: 'Copy-Item' },
  { re: /\bRename-Item\b/iu, label: 'Rename-Item' },
  { re: /\bNew-Item\b/iu, label: 'New-Item' },
  { re: /\bSet-Content\b/iu, label: 'Set-Content' },
  { re: /\bAdd-Content\b/iu, label: 'Add-Content' },
  { re: /\bOut-File\b/iu, label: 'Out-File' },
  { re: /\bSet-Item\b/iu, label: 'Set-Item' },
  { re: /(?:^|[;&|(\n]\s*)(rm)\s+/u, label: 'rm' },
  { re: /(?:^|[;&|(\n]\s*)(rmdir|rd)\s+/iu, label: 'rmdir/rd' },
  { re: /(?:^|[;&|(\n]\s*)(del|erase)\s+/iu, label: 'del/erase' },
  { re: /(?:^|[;&|(\n]\s*)(mv)\s+/u, label: 'mv' },
  { re: /(?:^|[;&|(\n]\s*)(cp)\s+/u, label: 'cp' },
  { re: /(?:^|[;&|(\n]\s*)(mkdir)\s+/u, label: 'mkdir' },
  { re: /(?:^|[;&|(\n]\s*)(touch)\s+/u, label: 'touch' },
  { re: /(?:^|[;&|(\n]\s*)(install)\s+/u, label: 'install' },
  { re: /(?:^|[;&|(\n]\s*)(tee)\s+/u, label: 'tee' },
  { re: /(?:^|[;&|(\n]\s*)(dd)\s+/u, label: 'dd' },
  { re: /(?:^|[;&|(\n]\s*)(truncate)\s+/u, label: 'truncate' },
  { re: /\bsed\s+-i\b/iu, label: 'sed -i' },
  { re: /\brobocopy\b[^\n]*\/(?:mir|purge|move)\b/iu, label: 'robocopy /mir|/purge|/move' },
  { re: /\bgit\s+(?:clean|checkout|reset)\b/iu, label: 'git clean/checkout/reset' },
  { re: /\bgit\s+clone\b/iu, label: 'git clone' },
  { re: /::Delete(?:Directory|File)?\s*\(/u, label: '.NET Delete' },
  { re: /\bshutil\.rmtree\b|\bos\.(?:remove|unlink)\b/u, label: 'python delete' },
  { re: /\b(?:rmSync|rmdirSync|unlinkSync|writeFileSync)\s*\(/u, label: 'node fs write' },
  { re: /\bxargs\s+(rm|mv|cp)\b/iu, label: 'xargs rm/mv/cp' },
  { re: /\bfind\b[^\n]*\s-delete\b/iu, label: 'find -delete' },
  { re: /\b(?:npm|pnpm)\s+(?:install|i)\b/iu, label: 'npm/pnpm install' },
  { re: /\b(?:rm|mv|cp)\b[^\n]*\s--prefix\b/iu, label: 'npm prefix' },
]

/** Shapes that make a token a filesystem path rather than an option or a word. */
const PATH_SHAPE = /^(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\\\\|\/(?!\/)|%USERPROFILE%|\$env:USERPROFILE|\$HOME\b|\$\{HOME\})/iu

/** A token that does not start like a path but still names a relative target. */
const RELATIVE_SHAPE = /^[^\s"'=;|&<>-]/u

/** Strip command prefixes so `sudo rm`/`command rm` are still recognized. */
function stripPrefixes(statement) {
  let text = statement.trim()
  for (;;) {
    const next = text
      .replace(/^(?:sudo|doas|command|nohup|time)\s+/u, '')
      .replace(/^env(?:\s+[A-Za-z_]\w*=\S+)*\s+/u, '')
    if (next === text) return text
    text = next
  }
}

/** A here-string consumed as file content is data, not shell path syntax. */
function stripDataHereStrings(statement) {
  if (!/\b(?:Set-Content|Add-Content|Out-File)\b/iu.test(statement)) return statement
  return statement.replace(/@'[\s\S]*?'@/gu, ' ').replace(/@"[\s\S]*?"@/gu, ' ')
}

/** Match the first destructive/write verb in a command. */
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

/** Collect the targets a command names, quoted or bare. */
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
    if (PATH_SHAPE.test(token) || (/[\\/]/u.test(token) && !/^\w+=/u.test(token))) add(token)
  }
  for (const match of command.matchAll(/(?:^|[\s(])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\\\\|\/(?!\/))[^\s"';|)&]*)/gu)) {
    add(match[1])
  }
  for (const match of command.matchAll(/(?:[A-Za-z]:[\\/]|\/(?!\/))[^'"\s);]+/gu)) add(match[0])
  const tail = command.slice(verb.index + verb.length)
  for (const token of tail.split(/[\s;|&]+/u)) {
    if (token === '' || token.startsWith('-')) continue
    if (token.startsWith('/') && !/^[A-Za-z]:/u.test(token)) continue
    if (PATH_SHAPE.test(token) || RELATIVE_SHAPE.test(token)) add(token)
    if (found.length >= 8) break
  }
  return found
}

function redirectionTargets(statement) {
  return [...String(statement).matchAll(/(?:^|\s)>{1,2}\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|]+))/gu)]
    .map(match => match[1] ?? match[2] ?? match[3])
}

function validate(targets, options, verb) {
  const violations = []
  const knownEnv = /^(?:%USERPROFILE%|\$env:USERPROFILE|\$HOME\b|\$\{HOME\}|~)/iu
  for (const target of targets) {
    if (/[$%]/u.test(target) && !knownEnv.test(target)) {
      violations.push({ raw: target, why: 'unknown' })
      continue
    }
    if (/[*?]/u.test(target)) {
      violations.push({ raw: target, why: 'wildcard' })
      continue
    }
    const resolved = resolveTarget(target, options.cwd)
    if (!options.allowedRoots.some(root => isInside(resolved, root))) {
      violations.push({ raw: target, resolved, why: 'outside' })
    }
  }
  return violations.length === 0 ? undefined : { verb, targets: violations }
}

function stripPrefixed(statement) {
  return stripDataHereStrings(stripPrefixes(statement))
}

/** Decide whether one statement's targets may be modified. */
function classifyStatement(statement, options) {
  const text = stripPrefixed(statement)
  if (text.trim() === '') return undefined
  const redirects = redirectionTargets(text)
  const verb = matchVerb(text)
  if (verb === undefined) {
    if (redirects.length === 0) return undefined
    return validate(redirects, options, 'redirection')
  }
  if (verb.label.startsWith('xargs')) {
    return { verb: verb.label, targets: [{ raw: '(pipeline)', why: 'unknown' }] }
  }
  const raw = collectTargets(text, verb)
  if (raw.length === 0) {
    if (verb.label !== 'find -delete' && verb.label !== 'npm/pnpm install') {
      const upstream = text.slice(0, verb.index)
      if (upstream.includes('|') || upstream.includes('&')) {
        return { verb: verb.label, targets: [{ raw: '(pipeline)', why: 'unknown' }] }
      }
    }
    raw.push(options.cwd)
  }
  const failure = validate(raw, options, verb.label)
  if (failure !== undefined) return failure
  return redirects.length === 0 ? undefined : validate(redirects, options, 'redirection')
}

/** Decide whether a command may run against the allowed roots. */
export function classifyCommand(command, options) {
  const failures = []
  for (const statement of String(command ?? '').split(/[\n;]/u)) {
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

/** Render a denial reason the model can act on. */
export function describeDenial(verdict, options) {
  const detail = verdict.targets
    .map(target => {
      const suffix = target.why === 'wildcard'
        ? '（含通配符，无法确定范围）'
        : target.why === 'unknown'
          ? '（由变量/管道输入，无法静态确定）'
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
    + `${trash}；临时测试请使用工作区 .artifacts/。`
}
