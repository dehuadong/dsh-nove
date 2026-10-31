// B2: skill reference segments and unified panel search.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { searchSkillReferences } from '../src/skill-search.ts'
import { searchUnified, SEARCH_SNIPPET_CHARS } from '../src/search.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
const b64 = text => Buffer.from(text, 'utf8').toString('base64')

const root = await mkdtemp(join(tmpdir(), 'storycraft-search-'))
const packageRoot = await mkdtemp(join(tmpdir(), 'storycraft-skill-root-'))
try {
  const skillDir = join(packageRoot, 'skills', 'test-skill')
  await mkdir(join(skillDir, 'references'), { recursive: true })
  await writeFile(join(packageRoot, 'skills', 'catalog.json'), JSON.stringify({ modes: { all: ['test-skill'] } }))
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: test-skill\n---\n\n## 独特方法\n\n青苔信号表示旧井的潮气。\n')
  await writeFile(join(skillDir, 'references', 'special.md'), '## 场景检查\n\n青苔信号只在背光处出现，检查时先看墙根。\n')

  const hits = searchSkillReferences('青苔信号', { root: packageRoot })
  check('skill hit carries file and heading', hits.some(hit => hit.source === 'skill:test-skill/references/special.md'
    && hit.location === '场景检查 · L3-3' && hit.id.includes('#')), JSON.stringify(hits.slice(0, 2)))
  check('frontmatter is skipped without shifting lines', hits.some(hit => hit.source === 'skill:test-skill/SKILL.md' && hit.location === '独特方法 · L7-7'), JSON.stringify(hits))
  check('skill missing is fail-open', searchSkillReferences('青苔信号', { root: packageRoot, skills: ['missing'] }).length === 0)

  const { workId: work } = s.initWork(root, { title: '检索' })
  s.writeOutline(root, { work, mainline: '青苔信号来自旧井。' })
  await s.importMaterial(root, work, { name: '旧井.md', contentBase64: b64('青苔信号在旧井里。') })
  const unified = searchUnified(root, work, '青苔信号', { skillRoot: packageRoot })
  const kinds = unified.groups.map(group => group.kind)
  check('unified search returns skill, material and memory groups', kinds.includes('skill') && kinds.includes('material') && kinds.includes('memory'), JSON.stringify(kinds))
  check('memory group has a work hit', unified.groups.find(group => group.kind === 'memory')?.hits.length > 0, JSON.stringify(unified.groups.find(group => group.kind === 'memory')))
  const skillGroup = unified.groups.find(group => group.kind === 'skill')
  check('skill hit has source/location/snippet', skillGroup?.hits.some(hit => hit.source.startsWith('skill:test-skill/')
    && hit.location?.includes('·') && hit.snippet.includes('青苔信号')), JSON.stringify(skillGroup?.hits))
  check('unified search clips snippets', unified.groups.every(group => group.hits.every(hit => hit.snippet.length <= SEARCH_SNIPPET_CHARS))
    && !JSON.stringify(unified).includes('"text":'), JSON.stringify(unified).slice(0, 200))

  await writeFile(join(skillDir, 'references', 'special.md'), '## 场景检查\n\n新术语出现，旧说法换掉了。\n')
  const after = searchSkillReferences('新术语', { root: packageRoot })
  const oldSpecial = searchSkillReferences('青苔信号', { root: packageRoot }).filter(hit => hit.source === 'skill:test-skill/references/special.md')
  check('revision drops old text from the changed file', oldSpecial.length === 0, JSON.stringify(oldSpecial))
  check('revision change rebuilds skill segments', after.some(hit => hit.source === 'skill:test-skill/references/special.md' && hit.text.includes('新术语')), JSON.stringify(after.slice(0, 1)))
  check('empty query has no groups', searchUnified(root, work, '', { skillRoot: packageRoot }).groups.length === 0)
  try {
    searchUnified(root, 'missing-work', '青苔信号', { skillRoot: packageRoot })
    check('unknown work is rejected', false)
  } catch (error) {
    check('unknown work is rejected', error?.code === 'work-not-found', String(error?.code))
  }
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(packageRoot, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
