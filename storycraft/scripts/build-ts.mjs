/** Compile the TypeScript pilot sources into dist/. */
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const result = spawnSync('tsc', ['-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.error !== undefined) {
  console.error(`[build] failed to start tsc: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('[build] TypeScript pilot compiled')
