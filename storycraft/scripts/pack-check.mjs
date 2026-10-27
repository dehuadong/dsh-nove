/**
 * Packaging guard: inspect the actual `npm pack --dry-run` manifest.
 *
 * The tarball ships the entry bundles declared by `exports` plus the skills
 * assets. It must not ship a per-module transcript of `src/` (the point of
 * bundling), nor tests, e2e, scripts, reports or temp directories.
 *
 * Run `npm run build` first: this reads a manifest and never triggers `prepack`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// The manifest is the single source for which files are entry points.
const entryTargets = Object.entries(packageJson.exports ?? {})
  .filter(([subpath]) => subpath !== './package.json')
  .map(([, target]) => String(target).replace(/^\.\//u, ''))

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

const failures = []
for (const path of ['package.json', 'README.md', 'cordis.patch.yml', 'icon.svg', ...entryTargets]) {
  if (!paths.includes(path)) failures.push(`缺少 ${path}`)
}
if (!paths.some(path => path.startsWith('skills/'))) failures.push('缺少 skills/')
if (String(packageJson.main).replace(/^\.\//u, '') !== entryTargets[0]) {
  failures.push(`main 不是 exports 的首个入口：${JSON.stringify(packageJson.main)}`)
}

// A bundled package ships the entries and the chunks those entries import; any
// other file under lib/ would ship unnoticed, so reject it.
const shippedLib = paths.filter(path => path.startsWith('lib/'))
const allowedLib = new Set(entryTargets)
for (const entry of entryTargets) {
  const file = join(root, entry)
  if (!existsSync(file)) continue
  // Bundlers minify: `from"./chunk.js"` with no space and either quote style.
  for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/gu)) {
    allowedLib.add(`lib/${match[1]}`)
  }
}
for (const file of shippedLib) {
  if (!allowedLib.has(file)) failures.push(`lib/ 里有未声明的产物 ${file}`)
}

const forbidden = ['tests', 'e2e', 'scripts', 'src', 'dist', 'test-results', '.tmp-e2e', 'playwright-report']
for (const relative of paths) {
  if (forbidden.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) {
    failures.push(`不应打包 ${relative}`)
  }
}

if (failures.length > 0) {
  console.error('[pack] FAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`[pack] PASS: ${paths.length} 个文件；${entryTargets.length} 个入口（${entryTargets.join(', ')}）+ skills，无 src/ 逐模块产物`)
