// Architect foundation references are loaded by the runtime, not by model choice.
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { architectReferences, loadSkillReference, renderReferenceBlock, skillRoots } from '../src/skill-references.ts'
import { SKILLS_ROOT } from '../src/skills.ts'
import { architectPrompt } from '../src/roles/architect/prompts.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const refs = architectReferences('foundation')
check('foundation requires two references', refs.length === 2 && refs.some(ref => ref.path.includes('state-projection')), JSON.stringify(refs))
check('cards stage needs no injected reference', architectReferences('cards').length === 0)
check('hooks stage includes the state projection', architectReferences('hooks').some(ref => ref.path.includes('state-projection')))

const design = loadSkillReference(refs[0])
const projection = loadSkillReference(refs[1])
check('foundation design reference is readable', design.includes('## 初始伏笔'), design.slice(0, 80))
check('state projection reference is readable', projection.includes('五态') && projection.includes('deferred'), projection.slice(0, 80))
check('references are cached by skill and path', loadSkillReference(refs[1]) === projection)

const block = renderReferenceBlock(refs)
check('rendered block carries both bodies',
  block.includes('## 必读参考') && block.includes('初始伏笔') && block.includes('五态'),
  block.slice(0, 120))

const prompt = architectPrompt({
  work: 'w',
  stage: 'foundation',
  instruction: '',
  delegationId: 'delegation-1',
  manifest: { title: '书', workId: 'w', form: 'longform', chapters: [] },
  foundation: {},
})
check('foundation prompt embeds the references', prompt.includes('必读参考（运行时已加载') && prompt.includes('五态'))
check('foundation prompt no longer asks the model to read them',
  !prompt.includes('提交前必须先读它') && prompt.includes('不要再自行查找'))

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
let code
try {
  loadSkillReference(refs[1], [join(packageRoot, 'tests', '__missing_skills__')])
} catch (error) {
  code = error?.code
}
check('missing skills fail loudly', code === 'architect-reference-missing', String(code))

// `skills.ts` derives SKILLS_ROOT as <module dir>/..; the bundled entry lives in
// lib/, so that is the package root and `skills/` resolves identically there.
check('skill roots come from the package root',
  realpathSync(skillRoots()[0]) === realpathSync(join(SKILLS_ROOT, 'skills')))
check('lib module dir resolves the same root',
  realpathSync(join(packageRoot, 'lib', '..')) === realpathSync(SKILLS_ROOT))
check('the lib-layout skills dir resolves the reference',
  loadSkillReference(refs[1], [join(packageRoot, 'lib', '..', 'skills')]).includes('五态'))


if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
