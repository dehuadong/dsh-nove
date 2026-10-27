/**
 * Storycraft CI entry: typecheck, run every unit contract test against the
 * source, build, check the tarball, then run the Playwright specs.
 *
 * Tests import `src/*.ts` directly and rely on Node's type stripping, so they
 * run before the build and never test a stale artifact.
 *
 * Usage:
 *   node storycraft/scripts/ci.mjs
 *   node storycraft/scripts/ci.mjs --no-e2e
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNode } from './node-version.mjs'

assertNode('ci')

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const storycraftDir = path.dirname(scriptsDir)
const noE2e = process.argv.includes('--no-e2e')
const tsc = path.join('node_modules', 'typescript', 'bin', 'tsc')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

let failed = 0
for (const [label, project] of [['Host', 'tsconfig.json'], ['Client', 'tsconfig.client.json']]) {
  const code = run(process.execPath, [tsc, '-p', project], storycraftDir)
  if (code !== 0) {
    console.error(`[ci] ${label} 类型检查失败`)
    failed += 1
  }
}

const tests = readdirSync(path.join(storycraftDir, 'tests'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()

for (const name of tests) {
  const code = run(process.execPath, [path.join('tests', name)], storycraftDir)
  if (code !== 0) failed += 1
}

for (const script of ['scripts/build.mjs', 'scripts/pack-check.mjs']) {
  const code = run(process.execPath, [path.join(...script.split('/'))], storycraftDir)
  if (code !== 0) failed += 1
}

if (!noE2e) {
  const code = run(process.execPath, [path.join('e2e', 'run.mjs')], storycraftDir)
  if (code !== 0) failed += 1
}

if (failed > 0) {
  console.error(`\n[ci] FAILED: ${failed} command(s)`)
  process.exit(1)
}
console.log(`\n[ci] PASS: ${tests.length} unit files${noE2e ? '' : ' + E2E'}`)
