// Packaging invariants for the bundled build: the manifest points at entry
// bundles under lib/, sources import each other with .ts specifiers and stay
// inside src/, and no test reaches back into a build directory — tests run the
// source.
import { readdirSync, readFileSync } from 'node:fs'
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

const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const srcNames = readdirSync(join(projectRoot, 'src'))
  .filter(name => name.endsWith('.ts'))
  .map(name => name.slice(0, -3))

// The published package exposes four bundles, nothing else.
check('main points at the bundled entry', manifest.main === './lib/index.js', manifest.main)
for (const key of ['.', './tools', './skills', './client']) {
  check(`export ${key} points at lib/`, String(manifest.exports[key] ?? '').startsWith('./lib/'), manifest.exports[key])
}
const files = manifest.files ?? []
check('files ships lib and never a stale dist', files.includes('lib') && !files.includes('dist'), JSON.stringify(files))
check('files ships skills and the bundle patch',
  files.includes('skills') && files.includes('cordis.patch.yml'), JSON.stringify(files))

// TypeScript sources import each other by .ts specifier and never leave src/.
const jsSpecifiers = []
const outward = []
for (const name of srcNames) {
  const text = readFileSync(join(projectRoot, 'src', `${name}.ts`), 'utf8')
  for (const match of text.matchAll(/from '(\.{1,2}\/[^']+\.js)'/gu)) jsSpecifiers.push(`${name} -> ${match[1]}`)
  for (const match of text.matchAll(/from '(\.\.\/[^']+)'/gu)) outward.push(`${name} -> ${match[1]}`)
}
check('sources import with .ts specifiers', jsSpecifiers.length === 0, jsSpecifiers.join(','))
check('sources never import outside src', outward.length === 0, outward.join(','))

// Tests and the fixture run the source; a build directory must not creep back in.
const stale = []
for (const name of readdirSync(join(projectRoot, 'tests')).filter(entry => entry.endsWith('.mjs'))) {
  const text = readFileSync(join(projectRoot, 'tests', name), 'utf8')
  if (/\.\.\/dist\//u.test(text)) stale.push(name)
}
check('tests do not import a build directory', stale.length === 0, stale.join(','))

// The migration itself forbids these directives.
const suppressed = srcNames.filter(name => /@ts-(nocheck|ignore|expect-error)/u.test(readFileSync(join(projectRoot, 'src', `${name}.ts`), 'utf8')))
check('no source suppresses type checking', suppressed.length === 0, suppressed.join(','))

// The entry modules load from source and expose the plugin shape.
const entry = await import('../src/index.ts')
check('package entry exports apply and inject',
  typeof entry.apply === 'function' && Array.isArray(entry.inject), Object.keys(entry).join(','))
const actions = await import('../src/tools.ts')
check('tool entry exports apply', typeof actions.apply === 'function', Object.keys(actions).join(','))
const skills = await import('../src/skills.ts')
check('skill entry exports apply, name and inject',
  typeof skills.apply === 'function' && typeof skills.name === 'string' && Array.isArray(skills.inject),
  Object.keys(skills).join(','))

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
