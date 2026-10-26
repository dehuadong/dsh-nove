/**
 * Transpile the Client entry into one browser file.
 *
 * The Client is not an ES module: DSH loads it through its module loader, which
 * evaluates the file and calls `window.__ModuleLoader__.load(...)` with a
 * factory. So this only transpiles one source file — no bundling, no import
 * rewriting, and the `require('react')` the loader provides stays untouched.
 */
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const result = await build({
  entryPoints: [join(root, 'src', 'client.ts')],
  outfile: join(root, 'dist', 'client.js'),
  bundle: false,
  target: 'es2022',
  logLevel: 'warning',
  metafile: true,
})

const output = Object.values(result.metafile.outputs)[0]
if (output === undefined) {
  console.error('[build-client] esbuild produced no output')
  process.exit(1)
}
console.error(`[build-client] compiled dist/client.js (${output.bytes} bytes)`)
