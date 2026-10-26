/**
 * Build the whole package: the Host program through tsc, the Client entry
 * through esbuild. Both publish only their built output.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = dirname(fileURLToPath(import.meta.url))

for (const script of ['build-ts.mjs', 'build-client.mjs']) {
  const result = spawnSync(process.execPath, [join(scripts, script)], { stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`[build] failed to start ${script}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
