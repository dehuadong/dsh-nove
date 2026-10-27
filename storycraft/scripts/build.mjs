/**
 * Build the whole package: the Host entries through tsdown (bundled into
 * `lib/`), the Client entry through esbuild (one transpiled script).
 *
 * `lib/` is deleted first and rebuilt from source, so a module that was
 * deleted or renamed cannot leave a stale bundle behind in the published
 * package. The Client is written after tsdown finished, so the two tools never
 * race on the same directory.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = dirname(fileURLToPath(import.meta.url))
const root = dirname(scripts)

/** Run one build step, keeping the child's exit code. */
function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`[build] failed to start ${file}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const tsdownManifest = join(root, 'node_modules', 'tsdown', 'package.json')
if (!existsSync(tsdownManifest)) {
  console.error('[build] tsdown 未安装：先在 storycraft/ 下运行 npm install')
  process.exit(1)
}
const bin = JSON.parse(readFileSync(tsdownManifest, 'utf8')).bin
const tsdownBin = join(root, 'node_modules', 'tsdown', typeof bin === 'string' ? bin : bin.tsdown)

rmSync(join(root, 'lib'), { recursive: true, force: true })
run(tsdownBin, [])
run(join(scripts, 'build-client.mjs'), [])
