/** Compile the TypeScript pilot sources into dist/. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('[build] TypeScript is not installed; run `npm install` in storycraft/ first.')
  process.exit(1)
}
const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error !== undefined) {
  console.error(`[build] failed to start tsc: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)
console.error('[build] TypeScript pilot compiled')
