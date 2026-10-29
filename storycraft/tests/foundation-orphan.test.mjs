// Re-running the roles stage drops stale cards across both tiers: every
// revision and its search document. Cards are 1:1 with the index.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { dropRoleCardsOnDb, readRoleCard } from '../src/artifact-store.ts'
import { openWork, transaction } from '../src/db.ts'
import * as tools from '../src/tools.ts'
import { setCurrent } from '../src/current.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const frame = {
  storyFrame: '# 故事框架\n\n## 前提\n甲在修表。\n\n## 核心冲突\n旧账。\n\n## 主角动机\n还账。\n\n## 约束\n不骗人。\n\n## 因果解决\n归零。\n',
  volumeMap: '## 第一卷\n- 卷目标：查账。\n- 起止章：1–3。\n- 关键节拍：翻账。\n- 卷末承诺：选择。\n',
  currentFocus: '# 当前焦点\n\n先查甲。',
}
const index = roles => ({ roles })
const card = (slug, name, tier = 'major') => ({ slug, name, tier, motivation: 'm', knowledge: 'k', relationshipPressure: 'r', limits: 'l', arc: 'a', markdown: `# ${name}` })
const revisionOf = (result, artifactId) => result.artifacts.find(item => item.artifactId === artifactId)?.revisionId

const registered = []
const ctx = {
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {} },
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
}
tools.apply(ctx, { mode: 'longform' })
const readTool = registered.find(definition => definition.name === 'story_read')

const root = await mkdtemp(join(tmpdir(), 'storycraft-orphan-'))
try {
  const { workId: work } = s.initWork(root, { title: '孤儿卡' })
  setCurrent('orphan-session', work)
  s.writeFoundationStage(root, { work, stage: 'frame', payload: frame })
  const firstIndex = s.writeFoundationStage(root, {
    work, stage: 'roles', payload: { rolesIndex: index([{ name: '甲', tier: 'major' }, { name: '乙', tier: 'minor' }]) },
  })
  const firstCards = s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲'), card('yi', '乙', 'minor')] } })
  const jiaRevision = readRoleCard(root, { work, slug: 'jia' }).artifact.revisionId
  const yiOld = revisionOf(firstCards, 'role:yi')

  // An identical roles re-run keeps the index and both cards.
  const again = s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index([{ name: '甲', tier: 'major' }, { name: '乙', tier: 'minor' }]) } })
  check('an identical re-run keeps the index revision', revisionOf(again, 'roles:index') === revisionOf(firstIndex, 'roles:index'))
  check('an identical re-run keeps both cards',
    readRoleCard(root, { work, slug: 'jia' }).artifact.revisionId === jiaRevision
    && readRoleCard(root, { work, slug: 'yi' }).artifact.revisionId === yiOld)

  // Cards are 1:1: a submission that omits an index person is refused.
  let partial = ''
  try {
    s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲')] } })
  } catch (error) { partial = error?.code ?? String(error) }
  check('a partial card submission is refused', partial === 'artifact-invalid', partial)

  // A changed card keeps the same identity and adds a revision.
  const changedCards = s.writeFoundationStage(root, {
    work, stage: 'cards', payload: { roleCards: [card('jia', '甲'), { ...card('yi', '乙', 'minor'), markdown: '# 乙\n\n改过一版。' }] },
  })
  const yiNew = revisionOf(changedCards, 'role:yi')
  check('a changed card adds a revision', yiNew !== undefined && yiNew !== yiOld, JSON.stringify([yiOld, yiNew]))
  check('the other card keeps its revision', readRoleCard(root, { work, slug: 'jia' }).artifact.revisionId === jiaRevision)

  const beforeSearch = s.search(root, work, '乙', 5)
  check('the minor card is findable before deletion', JSON.stringify(beforeSearch).includes('role:yi'), JSON.stringify(beforeSearch))

  // Dropping a minor person from the index removes the card and every revision.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index([{ name: '甲', tier: 'major' }]) } })
  let latest = ''
  try { readRoleCard(root, { work, slug: 'yi' }) } catch (error) { latest = error?.code ?? String(error) }
  const exec = { agent: { id: 'orphan-session', session: { header: { cwd: root } } } }
  const oldRead = await readTool.execute({ work, artifactId: 'role:yi', revisionId: yiOld }, exec)
  const newRead = await readTool.execute({ work, artifactId: 'role:yi', revisionId: yiNew }, exec)
  check('a dropped minor card is gone by latest read', latest === 'artifact-not-found', latest)
  check('both revisions are gone after the sync',
    (oldRead?.error?.code ?? '') === 'artifact-not-found' && (newRead?.error?.code ?? '') === 'artifact-not-found',
    JSON.stringify([oldRead?.error?.code, newRead?.error?.code]))
  check('the kept card survives', readRoleCard(root, { work, slug: 'jia' }).artifact.kind === 'role_card')
  const afterSearch = s.search(root, work, '乙', 5)
  check('the dropped card no longer hits search', !JSON.stringify(afterSearch).includes('role:yi'), JSON.stringify(afterSearch))

  // A rolled-back cleanup keeps artifact rows and search documents.
  const db = openWork(root, work)
  try {
    try {
      transaction(db, () => {
        dropRoleCardsOnDb(db, new Map())
        throw new Error('rollback')
      })
    } catch {
      // expected
    }
    check('a rolled back delete keeps the artifact', readRoleCard(root, { work, slug: 'jia' }).artifact.kind === 'role_card')
    check('a rolled back delete keeps the search document',
      db.prepare("SELECT 1 FROM search_docs WHERE doc_id = 'role:jia'").get() !== undefined)
  } finally {
    db.close()
  }

  // Export reflects the current index.
  const out = join(root, 'out')
  await s.exportWork(root, work, out)
  const entries = (await readdir(out, { recursive: true })).map(entry => String(entry).replace(/\\/gu, '/'))
  check('the export has the kept card', entries.some(entry => entry.includes('jia')), JSON.stringify(entries))
  check('the export has no stale card entry', !entries.some(entry => entry.includes('yi')), JSON.stringify(entries))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
