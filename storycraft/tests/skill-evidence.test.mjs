// A9: single skill routing, catalog-backed evidence, and reference revisions.
import { roleMethod, roleSkills, methodForStep } from '../src/skill-routing.ts'
import { atStage, skillEvidence, skillRevision } from '../src/skill-evidence.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

check('writer follows the form craft', (() => {
  const long = roleSkills('writer', 'longform')
  const short = roleSkills('writer', 'short')
  const script = roleSkills('writer', 'script')
  return long[0] === 'storycraft-long-prose' && short[0] === 'storycraft-short-prose' && script[0] === 'storycraft-script-scene'
})(), JSON.stringify([roleSkills('writer', 'longform'), roleSkills('writer', 'short'), roleSkills('writer', 'script')]))

const planner = roleSkills('planner', 'longform')
check('planner loads craft and method skill', planner.includes('storycraft-long-prose') && planner.includes('storycraft-long-plan'), JSON.stringify(planner))
const architect = roleSkills('architect', 'longform')
check('architect loads architect and foundation skills', architect.includes('storycraft-architect') && architect.includes('storycraft-long-foundation'), JSON.stringify(architect))
check('fixed roles route to their skills', roleSkills('reviewer', 'longform')[0] === 'storycraft-review'
  && roleSkills('reviser', 'longform')[0] === 'storycraft-revise-craft'
  && roleSkills('settler', 'longform')[0] === 'storycraft-state-settler'
  && roleSkills('validator', 'longform')[0] === 'storycraft-state-check', JSON.stringify([
  roleSkills('reviewer', 'longform'), roleSkills('reviser', 'longform'), roleSkills('settler', 'longform'), roleSkills('validator', 'longform'),
]))
check('summarizer has no skill', roleSkills('summarizer', 'longform').length === 0)

const evidenceRows = skillEvidence(planner)
check('planner evidence has two ids', evidenceRows.length === 2, JSON.stringify(evidenceRows))
check('revisions are short stable hashes', evidenceRows.every(row => /^[0-9a-f]{12}$/u.test(row.revision)), JSON.stringify(evidenceRows))
check('reference-owning skill revision is recorded', evidenceRows.some(row => row.id === 'storycraft-long-plan')
  && evidenceRows.some(row => row.id === 'storycraft-long-plan' && row.revision === skillRevision('storycraft-long-plan')), JSON.stringify(evidenceRows))
check('architect evidence includes foundation revision', skillEvidence(roleSkills('architect', 'longform')).some(row => row.id === 'storycraft-long-foundation'))

check('roleMethod points at the planner reference', roleMethod('planner', 'longform')?.reference === 'references/chapter-plan.md')
check('methodForStep keeps story_next routing', methodForStep('story_write', 'short')?.skill === 'storycraft-short-prose'
  && methodForStep('story_settle', 'longform')?.reference === 'references/state-projection.md')

let missing = ''
try { skillEvidence(['not-a-real-skill']) } catch (error) { missing = error?.code }
check('missing catalog skill fails loudly', missing === 'skill-missing', missing)

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = await mkdtemp(join(tmpdir(), 'storycraft-skill-'))
try {
  await cp(join(process.cwd(), 'skills', 'storycraft-review'), join(tempRoot, 'skills', 'storycraft-review'), { recursive: true })
  await writeFile(join(tempRoot, 'skills', 'catalog.json'), JSON.stringify({ modes: { test: ['storycraft-review'] } }))
  const before = skillEvidence(['storycraft-review'], { root: tempRoot })[0].revision
  await writeFile(join(tempRoot, 'skills', 'storycraft-review', 'references', 'review-dimensions.md'), readFile(join(tempRoot, 'skills', 'storycraft-review', 'references', 'review-dimensions.md'), 'utf8') + '\n<!-- changed -->\n')
  const after = skillEvidence(['storycraft-review'], { root: tempRoot })[0].revision
  check('reference changes move the revision', before !== after, before + '/' + after)
  const staged = atStage(skillEvidence(['storycraft-review'], { root: tempRoot }), 'validator')
  check('evidence can be stage-scoped', staged[0].stage === 'validator' && staged[0].id === 'storycraft-review')
  await rm(join(tempRoot, 'skills', 'storycraft-review'), { recursive: true, force: true })
  let missingDir = ''
  try { skillEvidence(['storycraft-review'], { root: tempRoot }) } catch (error) { missingDir = error?.code }
  check('missing directory fails as skill-missing', missingDir === 'skill-missing', missingDir)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
