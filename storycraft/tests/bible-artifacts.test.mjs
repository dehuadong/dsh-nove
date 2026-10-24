// S4a: world/style/intent/outline live as artifacts; bible keeps characters only.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { readTextArtifact } from '../artifact-store.js'
import { openWork } from '../db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-bible-artifacts-'))
try {
  const { workId: work } = s.initWork(root, { title: '真值迁移', wordRange: { min: 50, max: 5000 } })

  const world = await b.writeBible(root, work, 'world', '# 世界观\n\n荒原上以前有过城。\n')
  await b.writeBible(root, work, 'style', '# 文风\n\n短句。\n')
  await b.writeBible(root, work, 'intent', '# 意图\n\n写立国。\n')
  check('write returns the artifact revision', typeof world.version === 'string' && world.version.length === 12, JSON.stringify(world))

  const db = openWork(root, work)
  try {
    check('world/style/intent/plan leave the bible table',
      db.prepare("SELECT count(*) AS n FROM bible WHERE name IN ('world','style','intent','plan')").get().n === 0)
    check('characters stay in the bible table', db.prepare("SELECT count(*) AS n FROM bible WHERE name = 'characters'").get().n === 1)
    check('truth entries are artifacts',
      ['bible:world', 'bible:style', 'bible:intent', 'outline'].every(id => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(id) !== undefined))
  } finally {
    db.close()
  }

  const beforeRows = openWork(root, work)
  const worldRows = beforeRows.prepare("SELECT count(*) AS n FROM artifacts WHERE artifact_id = 'bible:world'").get().n
  beforeRows.close()
  const repeat = await b.writeBible(root, work, 'world', '# 世界观\n\n荒原上以前有过城。\n')
  const afterRows = openWork(root, work)
  const worldRowsAfter = afterRows.prepare("SELECT count(*) AS n FROM artifacts WHERE artifact_id = 'bible:world'").get().n
  afterRows.close()
  check('identical content is an idempotent no-op', repeat.version === world.version && worldRows === worldRowsAfter,
    JSON.stringify({ worldRows, worldRowsAfter }))

  const second = await b.writeBible(root, work, 'world', '# 世界观\n\n第二版。\n')
  const reverted = await b.writeBible(root, work, 'world', '# 世界观\n\n荒原上以前有过城。\n')
  check('reverting to an older text makes it current again',
    reverted.version === world.version && s.readBibleEntry(root, work, 'world').content.includes('荒原上以前有过城'))
  const oldRead = readTextArtifact(root, {
    work, artifactId: 'bible:world', kind: 'world', revisionId: second.version,
  })
  check('an older truth revision stays readable', oldRead.artifact.content.includes('第二版'), JSON.stringify(oldRead.artifact))

  const written = s.writeOutline(root, { work, mainline: '工程队在荒原立国。', volumes: '三卷。', ending: '开放。' })
  check('outline is written as an artifact',
    written.outline.revision !== undefined && s.readBibleEntry(root, work, 'plan').content.includes('工程队在荒原立国'))
  check('a written outline is unapproved',
    s.readManifest(root, work).outline?.approvedAt === undefined)
  s.approveOutline(root, { work })
  check('approval is recorded', s.readManifest(root, work).outline?.approvedAt !== undefined)
  s.writeOutline(root, { work, mainline: '改过的计划。' })
  check('rewriting the outline clears approval', s.readManifest(root, work).outline?.approvedAt === undefined)

  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '林澈', goal: '立国', obstacle: '荒原', cost: '代价', turn: '决定' })
  s.approveChapterPlan(root, { work, chapter: 1 })

  const brief = await b.assembleBrief(root, work, 1)
  const intentSection = brief.sections.find(section => section.name === 'intent')
  check('brief renders the intent artifact', intentSection?.content.includes('写立国') === true, JSON.stringify(intentSection?.content))
  check('the book outline is readable through the bible surface',
    s.readBibleEntry(root, work, 'plan').content.includes('改过的计划'))

  const hits = s.searchMemory(root, work, '荒原上以前有过城')
  check('truth artifacts are searchable', hits.some(item => item.kind === 'world'), JSON.stringify(hits.map(item => item.kind)))

  const exported = await s.exportWork(root, work, join(root, 'out'))
  const worldFile = await readFile(join(exported.directory, 'bible', 'world.md'), 'utf8')
  const outlineFile = await readFile(join(exported.directory, 'outline', 'plan.md'), 'utf8')
  let legacyPlanMissing = false
  try {
    await stat(join(exported.directory, 'bible', 'plan.md'))
  } catch {
    legacyPlanMissing = true
  }
  check('export projects truth artifacts', worldFile.includes('荒原上以前有过城') && outlineFile.includes('改过的计划'), JSON.stringify({ worldFile, outlineFile }))
  check('export no longer writes bible/plan.md', legacyPlanMissing)

  const characters = await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '林澈', role: '主角', want: '活下来', fear: '塌方', limit: '不拿人命换进度', voice: '短句' },
  ]))
  check('characters still use the six-field table contract',
    typeof characters.version === 'string' && JSON.parse(s.readBibleEntry(root, work, 'characters').content)[0].name === '林澈')

  throwsCode('writeBible refuses plan', 'approval-moved', () => s.writeBible(root, { work, name: 'plan', content: 'x' }))


} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
