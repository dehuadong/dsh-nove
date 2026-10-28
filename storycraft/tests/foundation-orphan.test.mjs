// Re-running the roles stage drops cards whose name left the index — every
// revision, its search document, and only major cards in the roles stage.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { dropRoleCardsOnDb, readRoleCard, writeRoleCard } from '../src/artifact-store.ts'
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
const index = names => ({ roles: names.map(name => ({ name, tier: 'major', role: '主角', want: 'w', fear: 'f', limit: 'l', voice: 'v' })) })
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
  const firstIndex = s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '乙']) } })
  const firstCards = s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲'), card('yi', '乙')] } })
  // A second revision of 乙: a delete-latest-only bug would leave this one readable.
  const secondYi = s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [{ ...card('yi', '乙'), markdown: '# 乙\n\n改过一版。' }] } })
  const yiOld = revisionOf(firstCards, 'role:yi')
  const yiNew = revisionOf(secondYi, 'role:yi')
  check('two revisions of the card exist before the re-run', yiOld !== undefined && yiNew !== undefined && yiOld !== yiNew,
    JSON.stringify([yiOld, yiNew]))
  const jiaRevision = readRoleCard(root, { work, slug: 'jia' }).artifact.revisionId

  // AC2: an identical re-run keeps every card revision and the index revision.
  const again = s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '乙']) } })
  check('an identical re-run keeps both cards at the same revision',
    readRoleCard(root, { work, slug: 'jia' }).artifact.revisionId === jiaRevision
    && readRoleCard(root, { work, slug: 'yi' }).artifact.revisionId === yiNew,
    JSON.stringify({ jia: jiaRevision, yi: yiNew }))
  check('an identical re-run keeps the same index revision',
    revisionOf(again, 'roles:index') === revisionOf(firstIndex, 'roles:index'),
    JSON.stringify([revisionOf(firstIndex, 'roles:index'), revisionOf(again, 'roles:index')]))

  // AC6: a minor card is not the roles stage's business.
  writeRoleCard(root, { work, content: card('bing', '丙', 'minor') })

  // Search positive control: 乙 is findable through the real search entry point.
  const beforeSearch = s.search(root, work, '乙', 5)
  check('the card is findable before deletion', JSON.stringify(beforeSearch).includes('role:yi'), JSON.stringify(beforeSearch))

  // AC1 + AC4 commit half: re-run roles without 乙, then read both revisions and search.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲']) } })
  let latest = ''
  try { readRoleCard(root, { work, slug: 'yi' }) } catch (error) { latest = error?.code ?? String(error) }
  const exec = { agent: { id: 'orphan-session', session: { header: { cwd: root } } } }
  const oldRead = await readTool.execute({ work, artifactId: 'role:yi', revisionId: yiOld }, exec)
  const newRead = await readTool.execute({ work, artifactId: 'role:yi', revisionId: yiNew }, exec)
  const oldCode = oldRead?.error?.code ?? ''
  const newCode = newRead?.error?.code ?? ''
  check('a dropped major card is gone by latest read', latest === 'artifact-not-found', latest)
  check('both old revisions are gone after the sync',
    oldCode === 'artifact-not-found' && newCode === 'artifact-not-found',
    JSON.stringify([oldCode, newCode]))
  let bogus = ''
  try { readRoleCard(root, { work, slug: 'jia', revisionId: 'missing' }) } catch (error) { bogus = error?.code ?? String(error) }
  check('a missing revision of an existing card stays revision-not-found', bogus === 'revision-not-found', bogus)
  check('a deleted card keeps the actionable next on the explicit-revision path',
    String(oldRead?.error?.next ?? '').includes('jia'), JSON.stringify(oldRead?.error))
  check('a minor card survives the sync', readRoleCard(root, { work, slug: 'bing' }).artifact.kind === 'role_card')
  const afterSearch = s.search(root, work, '乙', 5)
  check('the dropped card no longer hits the search entry point',
    !JSON.stringify(afterSearch).includes('role:yi'), JSON.stringify(afterSearch))

  // AC4 rollback: inside the caller's transaction, a throw keeps both tables.
  const db = openWork(root, work)
  try {
    try {
      transaction(db, () => {
        dropRoleCardsOnDb(db, new Set())
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

  // AC3: partial card submissions do not delete the other cards.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '乙', '丙']) } })
  s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲'), card('yi', '乙')] } })
  s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('bing', '丙')] } })
  check('a partial card submission keeps the earlier cards',
    readRoleCard(root, { work, slug: 'jia' }).artifact.kind === 'role_card'
    && readRoleCard(root, { work, slug: 'yi' }).artifact.kind === 'role_card')

  // AC5: the export has the kept card and no entry for the dropped one.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '丙']) } })
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
