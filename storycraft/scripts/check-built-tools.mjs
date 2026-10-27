/**
 * Check the built package, not the source: a stale `lib/` would otherwise ship
 * the old tool set even though the sources pass.
 *
 * Runs after the build in CI.
 */

const { apply } = await import('../lib/tools.js')

const registered = []
const ctx = {
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {} },
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
}
apply(ctx, { mode: 'longform' })

const names = registered.map(definition => definition.name)
const failures = []
if (names.length !== 32) failures.push(`expected 32 actions, built package has ${names.length}`)
for (const required of ['story_approve', 'story_next', 'story_delegate', 'story_critique']) {
  if (!names.includes(required)) failures.push(`built package is missing ${required}`)
}
const approve = registered.find(definition => definition.name === 'story_approve')
const params = Object.keys(approve?.parameters?.properties ?? {}).sort().join(',')
if (params !== 'chapter,kind,reason,work') failures.push(`story_approve parameters drifted: ${params}`)

if (failures.length > 0) {
  console.error('[built-tools] FAILED')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log(`[built-tools] PASS: ${names.length} actions, story_approve present with work/kind/chapter/reason`)
