#!/usr/bin/env node
/**
 * Move paths into a workspace-local trash instead of deleting them outright.
 *
 * Every entry keeps its original absolute path in `manifest.json`, so
 * `--restore <id>` puts it back. Moves across volumes copy first and only then
 * remove the source, so a failed copy leaves the original untouched.
 *
 * Usage:
 *   node scripts/trash.mjs <path...>        move to .trash/<id>/
 *   node scripts/trash.mjs --list           show entries
 *   node scripts/trash.mjs --restore <id>   put one entry back
 *   node scripts/trash.mjs --purge <id>     delete one entry for good
 *
 * Refusals are deliberate: the trash never accepts a drive root, the user home,
 * or an ancestor of the workspace, because those are the moves nobody can undo.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const trashRoot = path.join(root, '.trash')

/** @param {string} value @returns {string} */
const norm = value => {
  const resolved = path.resolve(value).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** @param {string} id */
function entryDir(id) {
  return path.join(trashRoot, id)
}

/** @param {string} dir @returns {{ files: number, bytes: number }} */
function weigh(dir) {
  let files = 0
  let bytes = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    const info = statSync(current)
    if (info.isDirectory()) {
      for (const name of readdirSync(current)) stack.push(path.join(current, name))
    } else {
      files += 1
      bytes += info.size
    }
  }
  return { files, bytes }
}

/** @param {string} target */
function refuseBroadTarget(target) {
  const home = norm(homedir())
  const rootNorm = norm(root)
  const targetNorm = norm(target)
  if (path.parse(target).root === path.resolve(target)) {
    return `拒绝：${target} 是盘符根`
  }
  if (targetNorm === home) return `拒绝：${target} 是用户主目录`
  if (targetNorm === rootNorm) return `拒绝：${target} 是工作区根`
  if (rootNorm.startsWith(`${targetNorm}${path.sep}`)) return `拒绝：${target} 是工作区的上级目录`
  return undefined
}

/** @param {string} id */
function readManifest(id) {
  const file = path.join(entryDir(id), 'manifest.json')
  if (!existsSync(file)) throw new Error(`没有这个条目：${id}`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** @param {string} from @param {string} to */
function moveAcross(from, to) {
  try {
    renameSync(from, to)
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') throw error
    cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    rmSync(from, { recursive: true, force: true })
  }
}

/** @param {string[]} targets */
function trash(targets) {
  if (targets.length === 0) {
    console.error('用法：node scripts/trash.mjs <path...> | --list | --restore <id> | --purge <id>')
    process.exitCode = 1
    return
  }
  mkdirSync(trashRoot, { recursive: true })
  for (const target of targets) {
    const resolved = path.resolve(target)
    if (!existsSync(resolved)) {
      console.error(`跳过（不存在）：${resolved}`)
      continue
    }
    const refusal = refuseBroadTarget(resolved)
    if (refusal !== undefined) {
      console.error(refusal)
      process.exitCode = 1
      continue
    }
    const stamp = new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)
    const id = `${stamp}-${Math.random().toString(16).slice(2, 6)}`
    const destination = path.join(entryDir(id), path.basename(resolved))
    mkdirSync(path.dirname(destination), { recursive: true })
    moveAcross(resolved, destination)
    const info = statSync(destination)
    const kind = info.isDirectory() ? 'dir' : 'file'
    const size = info.isDirectory() ? weigh(destination) : { files: 1, bytes: info.size }
    writeFileSync(path.join(entryDir(id), 'manifest.json'), `${JSON.stringify({
      id,
      trashedAt: new Date().toISOString(),
      originalPath: resolved,
      kind,
      ...size,
    }, null, 2)}\n`)
    console.log(`[trash] ${resolved} -> ${id}（${size.files} 个文件，${size.bytes} 字节；还原：--restore ${id}）`)
  }
}

function list() {
  if (!existsSync(trashRoot)) {
    console.log('（空）')
    return
  }
  const entries = readdirSync(trashRoot)
    .map(id => {
      try {
        return readManifest(id)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)))
  if (entries.length === 0) {
    console.log('（空）')
    return
  }
  for (const entry of entries) {
    console.log(`${entry.id}  ${entry.trashedAt}  ${entry.kind}  ${entry.files} 文件  ${entry.originalPath}`)
  }
}

/** @param {string} id @param {boolean} force */
function restore(id, force) {
  const manifest = readManifest(id)
  const destination = manifest.originalPath
  if (existsSync(destination) && !force) {
    throw new Error(`原路径已存在，未覆盖：${destination}（确认要覆盖时加 --force）`)
  }
  mkdirSync(path.dirname(destination), { recursive: true })
  const source = path.join(entryDir(id), path.basename(destination))
  moveAcross(source, destination)
  rmSync(entryDir(id), { recursive: true, force: true })
  console.log(`[trash] 已还原：${destination}`)
}

/** @param {string} id */
function purge(id) {
  readManifest(id)
  rmSync(entryDir(id), { recursive: true, force: true })
  console.log(`[trash] 已永久删除：${id}`)
}

const argv = process.argv.slice(2)
try {
  if (argv[0] === '--list') list()
  else if (argv[0] === '--restore') restore(argv[1], argv.includes('--force'))
  else if (argv[0] === '--purge') purge(argv[1])
  else trash(argv)
} catch (error) {
  console.error(`[trash] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
