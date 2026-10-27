/**
 * Host build: three entry bundles into `lib/`.
 *
 * Everything the Host half imports is in this package, so there are no
 * externals to keep alive: the bundler may inline and split freely. The Client
 * entry is not built here — it is a `__ModuleLoader__` script, not ESM, and
 * `scripts/build-client.mjs` transpiles it on its own.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'dsh-storycraft',
  entry: {
    index: 'src/index.ts',
    tools: 'src/tools.ts',
    skills: 'src/skills.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  // Entry files must be the exact paths named by `exports` (`lib/index.js`),
  // so keep the real `.js` extension instead of tsdown's `.mjs` default.
  fixedExtension: false,
  dts: false,
  sourcemap: false,
})
