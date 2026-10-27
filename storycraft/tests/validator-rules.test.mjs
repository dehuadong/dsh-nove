// The dangling-name rule fails on a name with no directory, and it is the rule
// the skill walk uses for both SKILL.md and references.
import { findDanglingSkills } from '../scripts/validate-skills.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const known = new Set(['storycraft-a', 'storycraft-b'])

check('a known name is not reported',
  findDanglingSkills('读 `storycraft-a` 与 `storycraft-b`', known).length === 0,
  JSON.stringify(findDanglingSkills('读 `storycraft-a` 与 `storycraft-b`', known)))

check('an unknown name is reported once',
  JSON.stringify(findDanglingSkills('先 `storycraft-missing`，再 `storycraft-missing`', known)) === '["storycraft-missing"]',
  JSON.stringify(findDanglingSkills('先 `storycraft-missing`，再 `storycraft-missing`', known)))

check('a reference document is scanned the same way',
  JSON.stringify(findDanglingSkills('见 `storycraft-gone`', known)) === '["storycraft-gone"]')

check('prose without a skill name reports nothing', findDanglingSkills('普通说明文字', known).length === 0)

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
