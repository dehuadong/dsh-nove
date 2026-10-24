/**
 * Packaging guard: inspect the actual `npm pack --dry-run` manifest.
 *
 * The tarball must contain every root runtime module, skills and bundle assets;
 * it must not contain tests, e2e, scripts, reports or temp directories.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const useNpmCli = existsSync(npmCli)
const command = useNpmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm')
const args = useNpmCli ? [npmCli, 'pack', '--dry-run', '--json'] : ['pack', '--dry-run', '--json']
const result = spawnSync(command, args, {
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
  const start = result.stdout.indexOf('[')
  manifest = JSON.parse(result.stdout.slice(start))
} catch (error) {
  console.error(`[pack] FAILED: 无法解析 npm pack --json：${error.message}`)
  process.exit(1)
}
const paths = manifest[0]?.files?.map(file => file.path) ?? []
if (paths.length === 0) {
  console.error('[pack] FAILED: npm pack 清单为空')
  process.exit(1)
}

const failures = []
const required = ['package.json', 'README.md', 'cordis.patch.yml', 'icon.svg']
for (const path of required) {
  if (!paths.includes(path)) failures.push(`缺少 ${path}`)
}
const rootJs = readdirSync(root).filter(name => name.endsWith('.js'))
const srcTs = readdirSync(join(root, 'src')).filter(name => name.endsWith('.ts'))
for (const name of rootJs) {
  if (!paths.includes(name)) failures.push(`缺少运行时模块 ${name}`)
}
for (const name of srcTs) {
  const built = 'dist/' + name.replace(/\.ts$/u, '.js')
  if (!paths.includes(built)) failures.push('缺少编译产物 ' + built)
}
if (!paths.some(path => path.startsWith('skills/'))) failures.push('缺少 skills/')

const forbidden = ['tests', 'e2e', 'scripts', 'test-results', '.tmp-e2e', 'playwright-report']
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
console.log(`[pack] PASS: ${paths.length} 个文件；${rootJs.length} 个根 JS + skills，未含 tests/e2e/scripts/报告/临时目录`)
