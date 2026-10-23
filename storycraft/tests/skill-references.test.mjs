// Long-form method references: one home, named by every role that reads them.
//
// The method skill is an index, not an output contract. These checks keep the
// three references discoverable from the role skills and tie the projection
// wording back to the shipped hook state machine.
import { readFile, readdir, stat } from 'node:fs/promises'
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
const methodDir = join(skills, 'longform', 'storycraft-longform-method')
const methodSkill = await readFile(join(methodDir, 'SKILL.md'), 'utf8')

const REFERENCES = [
  'foundation-design.md',
  'reader-contract-and-progression.md',
  'state-projection.md',
]

check('method skill keeps its routed name', /^name:\s*storycraft-longform-method$/m.test(methodSkill))
check('method skill stays an index', methodSkill.split(/\r?\n/).length <= 60,
  `${methodSkill.split(/\r?\n/).length} lines`)
check('method skill does not impersonate an output contract',
  !methodSkill.includes('story_submit') && !methodSkill.includes('payload') && !methodSkill.includes('```'))

const referenceText = {}
for (const reference of REFERENCES) {
  check(`method skill names ${reference}`, methodSkill.includes(`references/${reference}`))
  const file = join(methodDir, 'references', reference)
  let text = ''
  let present = false
  try {
    present = (await stat(file)).isFile()
    text = await readFile(file, 'utf8')
  } catch {
    present = false
  }
  referenceText[reference] = text
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  check(`${reference} has a heading and a body`,
    present && lines[0]?.startsWith('# ') && lines.length > 2,
    present ? `${lines.length} non-empty lines` : 'missing')
}

const referenceFiles = (await readdir(join(methodDir, 'references'), { withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .sort()
check('references directory has no orphan file', referenceFiles.join(',') === [...REFERENCES].sort().join(','),
  referenceFiles.join(','))

const roleSkills = {
  plan: join(skills, 'plan', 'storycraft-plan-craft', 'SKILL.md'),
  write: join(skills, 'write', 'storycraft-write-craft', 'SKILL.md'),
  review: join(skills, 'review', 'storycraft-review', 'SKILL.md'),
  orchestration: join(skills, 'shared', 'storycraft-studio-orchestration', 'SKILL.md'),
}
const roleText = {}
for (const [role, file] of Object.entries(roleSkills)) roleText[role] = await readFile(file, 'utf8')

const loadsMethod = role => role.includes('加载 `storycraft-longform-method`')
check('planning loads the method and reads foundation + reader contract',
  loadsMethod(roleText.plan)
  && roleText.plan.includes('读它的 `references/foundation-design.md`')
  && roleText.plan.includes('读它的 `references/reader-contract-and-progression.md`'))
check('writing loads the method and reads the reader contract',
  loadsMethod(roleText.write)
  && roleText.write.includes('读它的 `references/reader-contract-and-progression.md`'))
check('review loads the method and reads the reader contract + state projection',
  loadsMethod(roleText.review)
  && roleText.review.includes('读它的 `references/reader-contract-and-progression.md`')
  && roleText.review.includes('读它的 `references/state-projection.md`'))
check('orchestration loads the method and reads state projection before settling',
  loadsMethod(roleText.orchestration)
  && roleText.orchestration.includes('读它的 `references/state-projection.md`'))

const shortStory = await readFile(join(skills, 'shortform', 'storycraft-short-story', 'SKILL.md'), 'utf8')
const shortDrama = await readFile(join(skills, 'screenplay', 'storycraft-short-drama', 'SKILL.md'), 'utf8')
check('short form is not asked to read long-form method',
  !shortStory.includes('storycraft-longform-method'))
check('screenplay is not asked to read long-form method',
  !shortDrama.includes('storycraft-longform-method'))

const validation = await readFile(join(root, 'state-validation.js'), 'utf8')
const hookMatch = /const HOOK_STATES = \[([^\]]+)\]/u.exec(validation)
check('state-validation exposes its hook states', hookMatch !== null)
const hookStates = hookMatch === null
  ? []
  : [...hookMatch[1].matchAll(/'([^']+)'/gu)].map(match => match[1])
const projection = referenceText['state-projection.md']
check('the shipped hook machine has exactly three states', hookStates.join(',') === 'opened,used,resolved',
  hookStates.join(','))
check('state projection names the same three states and says so',
  hookStates.every(state => projection.includes(`\`${state}\``)) && projection.includes('只有三种状态'))
check('state projection invents no reference-only hook state or timing field',
  !projection.includes('superseded') && !projection.includes('lastAdvancedChapter')
  && !projection.includes('兑现区间') && !projection.includes('兑现档位'))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
