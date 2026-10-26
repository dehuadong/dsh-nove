// Packaging invariants for the TS build: published entry points resolve, every
// source has its compiled module, and no consumer still points at a moved file.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
const exists = path => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const srcNames = readdirSync(join(projectRoot, 'src')).filter(name => name.endsWith('.ts')).map(name => name.slice(0, -3))
const rootJs = readdirSync(projectRoot).filter(name => name.endsWith('.js'))

// Every source file has its compiled module; a stale dist breaks the install.
const missingBuilt = srcNames.filter(name => !exists(join(projectRoot, 'dist', `${name}.js`)))
check('every source module is built', missingBuilt.length === 0, missingBuilt.join(','))

// Entry points must resolve to files that exist in this checkout.
const unresolvable = Object.entries(manifest.exports)
  .filter(([key]) => key !== './package.json')
  .filter(([, target]) => !exists(join(projectRoot, target)))
check('every export target exists', unresolvable.length === 0, unresolvable.map(([key]) => key).join(','))

// Every entry is built: the Host ones through tsc, the Client through esbuild.
for (const key of ['.', './tools', './skills', './client']) {
  check(`export ${key} points at the build`, String(manifest.exports[key]).startsWith('./dist/'), manifest.exports[key])
}
check('the Client bundle is shipped', exists(join(projectRoot, 'dist', 'client.js')))
check('the manifest no longer ships root JavaScript',
  !(manifest.files ?? []).some(entry => entry.includes('*.js')), JSON.stringify(manifest.files))

// A moved module must not keep a root-level twin.
const duplicated = srcNames.filter(name => rootJs.includes(`${name}.js`))
check('no module has both a source and a root build', duplicated.length === 0, duplicated.join(','))

// TypeScript sources import each other, never a file above src/.
const outward = []
for (const name of srcNames) {
  const text = readFileSync(join(projectRoot, 'src', `${name}.ts`), 'utf8')
  for (const match of text.matchAll(/from '(\.\.\/[^']+\.js)'/gu)) outward.push(`${name} -> ${match[1]}`)
}
check('sources never import outside src', outward.length === 0, outward.join(','))

// Tests load the compiled module, not the source or a moved root file.
const stale = []
for (const name of readdirSync(join(projectRoot, 'tests')).filter(entry => entry.endsWith('.test.mjs'))) {
  const text = readFileSync(join(projectRoot, 'tests', name), 'utf8')
  for (const match of text.matchAll(/from '\.\.\/([\w-]+)\.js'/gu)) {
    if (srcNames.includes(match[1])) stale.push(`${name} -> ../${match[1]}.js`)
  }
}
check('tests import compiled modules', stale.length === 0, stale.join(','))

// The migration itself forbids these directives.
const suppressed = srcNames.filter(name => /@ts-(nocheck|ignore|expect-error)/u.test(readFileSync(join(projectRoot, 'src', `${name}.ts`), 'utf8')))
check('no source suppresses type checking', suppressed.length === 0, suppressed.join(','))

// The published package loads through its declared entry points.
const entry = await import(`../dist/index.js`)
check('package entry exports apply and inject',
  typeof entry.apply === 'function' && Array.isArray(entry.inject), Object.keys(entry).join(','))
const actions = await import(`../dist/tools.js`)
check('tool entry exports apply', typeof actions.apply === 'function', Object.keys(actions).join(','))
const skills = await import(`../dist/skills.js`)
check('skill entry exports apply, name and inject',
  typeof skills.apply === 'function' && typeof skills.name === 'string' && Array.isArray(skills.inject),
  Object.keys(skills).join(','))

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
