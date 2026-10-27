// Stage skills own one node each: a stage skill must not name another stage's
// skill, and every reference must sit inside the stage skill that loads it.
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const skills = join(root, 'skills')

const STAGES = {
  'storycraft-long-foundation': ['foundation-design.md'],
  'storycraft-long-plan': ['chapter-plan.md', 'chapter-plan-examples.md'],
  'storycraft-long-prose': ['reader-contract-and-progression.md', 'scene-dialogue-and-length-budget.md'],
  'storycraft-long-settle': ['state-projection.md'],
  'storycraft-short-outline': ['outline.md'],
  'storycraft-short-prose': ['production-checklist.md'],
  'storycraft-script-spec': ['spec.md'],
  'storycraft-script-scene': ['episode-scene-craft.md'],
}

for (const [skill, references] of Object.entries(STAGES)) {
  const text = await readFile(join(skills, skill, 'SKILL.md'), 'utf8')
  check(`${skill} keeps its name`, new RegExp(`^name:\\s*${skill}$`, 'm').test(text))
  check(`${skill} stays an index`, text.split(/\r?\n/u).length <= 40, `${text.split(/\r?\n/u).length} lines`)
  for (const reference of references) {
    const file = join(skills, skill, 'references', reference)
    let content = ''
    let present = false
    try {
      present = (await stat(file)).isFile()
      content = await readFile(file, 'utf8')
    } catch {
      present = false
    }
    check(`${skill} has references/${reference}`, present && content.startsWith('# '))
  }
  const others = Object.keys(STAGES).filter(name => name !== skill)
  check(`${skill} names no other stage skill`, others.every(name => !text.includes(name)), others.filter(name => text.includes(name)).join(','))
}

// The work-mode skill routes with fields the host fills, not with its own table.
const orchestration = await readFile(join(skills, 'storycraft-long-director', 'SKILL.md'), 'utf8')
check('orchestration defers material and method to story_next', orchestration.includes('story_next') && orchestration.includes('ask'))
check('the director routes to stage skills, never to reference files',
  orchestration.includes('storycraft-long-plan') && orchestration.includes('storycraft-long-prose')
  && !orchestration.includes('references/foundation-design.md'))

// Role skills stay thin.
const review = await readFile(join(skills, 'storycraft-review', 'SKILL.md'), 'utf8')
check('review names its dimensions reference', review.includes('references/review-dimensions.md'))
const revise = await readFile(join(skills, 'storycraft-revise-craft', 'SKILL.md'), 'utf8')
check('reviser names its deslop reference', revise.includes('references/deslop.md'))

// No stray reference outside a skill directory.
const entries = await readdir(skills, { withFileTypes: true })
check('every entry is a skill directory or the catalog', entries.every(entry => entry.isDirectory() || entry.name === 'catalog.json'))

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
