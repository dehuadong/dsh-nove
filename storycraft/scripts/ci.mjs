/**
 * Storycraft CI entry: run every unit contract test, then the Playwright specs.
 *
 * This is the project-owned equivalent of the reference project's
 * `pnpm install --frozen-lockfile && pnpm build && pnpm test` path: one
 * command, deterministic exit code, no manual test writing.
 *
 * Usage:
 *   node storycraft/scripts/ci.mjs
 *   node storycraft/scripts/ci.mjs --no-e2e
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const storycraftDir = path.dirname(scriptsDir)
const noE2e = process.argv.includes('--no-e2e')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

const tests = readdirSync(path.join(storycraftDir, 'tests'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
let failed = 0

for (const name of tests) {
  const code = run(process.execPath, [path.join('tests', name)], storycraftDir)
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
