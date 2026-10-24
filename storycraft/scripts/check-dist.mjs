/** Fail when the committed TypeScript output does not match a fresh build. */
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const result = spawnSync('git', ['status', '--porcelain', '--', 'dist'], {
  cwd: root,
  encoding: 'utf8',
})
if (result.error !== undefined) {
  console.error(`[dist] failed to run git: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error('[dist] git status failed')
  process.exit(result.status ?? 1)
}
if (String(result.stdout).trim() !== '') {
  console.error('[dist] committed output differs from a fresh build:')
  console.error(String(result.stdout).trim())
  process.exit(1)
}
console.log('[dist] committed output matches the build')
