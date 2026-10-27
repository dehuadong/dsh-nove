// Shared method references: one home per form, named by every role that reads them.
//
// A method skill is an index, not an output contract. These checks keep the
// references discoverable from role skills and tie the projection wording back
// to the shipped hook state machine.
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
const methodDir = join(skills, 'storycraft-long-writing')
const methodSkill = await readFile(join(methodDir, 'SKILL.md'), 'utf8')

const REFERENCES = [
  'chapter-plan-examples.md',
  'chapter-plan.md',
  'foundation-design.md',
  'reader-contract-and-progression.md',
  'scene-dialogue-and-length-budget.md',
  'state-projection.md',
]

check('shared long-form method keeps its name', /^name:\s*storycraft-long-writing$/m.test(methodSkill))
check('shared long-form method stays an index', methodSkill.split(/\r?\n/).length <= 60,
  `${methodSkill.split(/\r?\n/).length} lines`)
check('shared long-form method does not impersonate an output contract',
  !methodSkill.includes('story_submit') && !methodSkill.includes('payload') && !methodSkill.includes('```'))

const referenceText = {}
for (const reference of REFERENCES) {
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

const oldMethod = await readFile(join(skills, 'storycraft-longform-method', 'SKILL.md'), 'utf8')
check('the old method name is a thin alias to the shared method',
  oldMethod.includes('storycraft-long-writing') && !oldMethod.includes('references/'))

const shortMethod = await readFile(join(skills, 'storycraft-short-writing', 'SKILL.md'), 'utf8')
const shortChecklist = await readFile(join(skills, 'storycraft-short-writing', 'references', 'production-checklist.md'), 'utf8')
check('short method defers node selection and the checklist is a document',
  shortMethod.includes('story_next.method') && shortChecklist.startsWith('# '))

const scriptMethod = await readFile(join(skills, 'storycraft-script-writing', 'SKILL.md'), 'utf8')
const scriptCraft = await readFile(join(skills, 'storycraft-script-writing', 'references', 'episode-scene-craft.md'), 'utf8')
check('script method defers node selection and the reference is a document',
  scriptMethod.includes('story_next.method') && scriptCraft.startsWith('# '))

const roleSkills = {
  review: join(skills, 'storycraft-review', 'SKILL.md'),
  orchestration: join(skills, 'storycraft-studio-orchestration', 'SKILL.md'),
  chapter: join(skills, 'storycraft-longform-chapter', 'SKILL.md'),
  revise: join(skills, 'storycraft-revise-craft', 'SKILL.md'),
  stateCheck: join(skills, 'storycraft-state-check', 'SKILL.md'),
  stateSettler: join(skills, 'storycraft-state-settler', 'SKILL.md'),
}
const roleText = {}
for (const [role, file] of Object.entries(roleSkills)) roleText[role] = await readFile(file, 'utf8')

const loadsMethod = role => /加载\s*`storycraft-long-writing`/u.test(role)
for (const [role, text] of Object.entries(roleText)) {
  check(`${role} skill carries no long-form method body`,
    !/^## (从章纲到场景|卷怎么划|人物与因果|节奏与收尾|写作纪律|自检清单)/mu.test(text))
}
const longCraft = await readFile(join(skills, 'storycraft-long-writing', 'SKILL.md'), 'utf8')
check('the long-form craft defers node selection to the host',
  longCraft.includes('story_next.method') && !longCraft.includes('| 节点 |'))
check('review loads the shared method and reads the reader contract + state projection',
  loadsMethod(roleText.review)
  && roleText.review.includes('`references/reader-contract-and-progression.md`')
  && roleText.review.includes('`references/state-projection.md`'))
check('orchestration loads the shared method and reads state projection before settling',
  loadsMethod(roleText.orchestration)
  && roleText.orchestration.includes('`references/state-projection.md`'))
check('the single-chapter flow points to the shared method',
  roleText.chapter.includes('`storycraft-long-writing`'))

const shortStory = await readFile(join(skills, 'storycraft-short-story', 'SKILL.md'), 'utf8')
const shortDrama = await readFile(join(skills, 'storycraft-short-drama', 'SKILL.md'), 'utf8')
check('short form loads its shared method, not the long-form method',
  shortStory.includes('storycraft-short-writing') && !shortStory.includes('storycraft-long-writing'))
check('screenplay loads its shared method, not the long-form method',
  shortDrama.includes('storycraft-script-writing') && !shortDrama.includes('storycraft-long-writing'))

const projectionSource = await readFile(join(root, 'src', 'state-projection.ts'), 'utf8')
const hookMatch = /const HOOK_OPS = \[([^\]]+)\]/u.exec(projectionSource)
check('state projection exposes its hook ops', hookMatch !== null)
const hookOps = hookMatch === null
  ? []
  : [...hookMatch[1].matchAll(/'([^']+)'/gu)].map(match => match[1])
const projection = referenceText['state-projection.md']
check('the shipped hook machine has the five v2 ops',
  hookOps.join(',') === 'upsert,progress,mention,defer,resolve,supersede', hookOps.join(','))
check('state projection names the same ops and says so',
  hookOps.filter(op => op !== 'upsert').every(op => projection.includes(`\`${op}\``))
  && projection.includes('五态'))
check('state projection carries the v2 hook id identity, not text identity',
  projection.includes('`hookId`') && !projection.includes('身份就是 `text`'))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
