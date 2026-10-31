/**
 * Packaging guard: inspect the actual `npm pack --dry-run` manifest.
 *
 * The rules live in `pack-manifest.mjs` (pure, unit-tested); this file only
 * gathers the facts: the manifest, the tarball paths, the entry files and the
 * chunks those entries import.
 *
 * Run `npm run build` first: this reads a manifest and never triggers `prepack`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryTargets, inspectPackage } from './pack-manifest.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entries = entryTargets(packageJson)

const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const useNpmCli = existsSync(npmCli)
const command = useNpmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm')
const args = ['pack', '--dry-run', '--json', '--ignore-scripts']
const result = spawnSync(command, useNpmCli ? [npmCli, ...args] : args, {
  cwd: root,
  encoding: 'utf8',
  shell: !useNpmCli && process.platform === 'win32',
})
if (result.error !== undefined) {
  console.error(`[pack] FAILED: 无法运行 npm pack：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`[pack] FAILED: npm pack 退出 ${result.status}`)
  console.error(String(result.stderr ?? '').trim())
  process.exit(1)
}

let manifest
try {
  // npm pretty-prints the array, and a warning line may precede it: try every
  // `[` until one parses into the manifest.
  for (let start = result.stdout.indexOf('['); start >= 0; start = result.stdout.indexOf('[', start + 1)) {
    try {
      const candidate = JSON.parse(result.stdout.slice(start))
      if (Array.isArray(candidate) && candidate[0]?.files !== undefined) {
        manifest = candidate
        break
      }
    } catch {
      // Not the payload; keep looking.
    }
  }
  if (manifest === undefined) throw new Error('stdout 里没有 JSON 清单')
} catch (error) {
  console.error(`[pack] FAILED: 无法解析 npm pack --json：${error.message}`)
  process.exit(1)
}
const paths = manifest[0]?.files?.map(file => file.path) ?? []
if (paths.length === 0) {
  console.error('[pack] FAILED: npm pack 清单为空（先运行 npm run build）')
  process.exit(1)
}

// Entry files plus every relative chunk they import.
const allowedLib = new Set(entries)
const queue = [...entries]
while (queue.length > 0) {
  const entry = queue.shift()
  const file = join(root, String(entry))
  if (!existsSync(file)) continue
  // Bundlers minify: `from"./chunk.js"` with no space and either quote style.
  for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*(?:\(\s*)?["']\.\/([^"']+\.js)["']/gu)) {
    const chunk = `lib/${match[1]}`
    if (allowedLib.has(chunk)) continue
    allowedLib.add(chunk)
    queue.push(chunk)
  }
}

const licensePath = join(root, 'LICENSE')
const failures = inspectPackage({
  packageJson,
  paths,
  allowedLib,
  licenseText: existsSync(licensePath) ? readFileSync(licensePath, 'utf8') : undefined,
})

if (failures.length > 0) {
  console.error('[pack] FAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`[pack] PASS: ${paths.length} 个文件；${entries.length} 个入口（${entries.join(', ')}）+ skills，LICENSE 与 engines.dsh 齐全`)
