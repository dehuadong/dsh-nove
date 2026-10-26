/**
 * Build the whole package: the Host program through tsc, the Client entry
 * through esbuild. Both publish only their built output.
 *
 * `dist/` is recreated from scratch so a module that was deleted or renamed
 * cannot leave a stale file behind in the published package.
 */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = dirname(fileURLToPath(import.meta.url))
const root = dirname(scripts)

rmSync(join(root, 'dist'), { recursive: true, force: true })

for (const script of ['build-ts.mjs', 'build-client.mjs']) {
  const result = spawnSync(process.execPath, [join(scripts, script)], { stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`[build] failed to start ${script}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
