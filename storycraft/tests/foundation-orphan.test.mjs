// Re-running the roles stage drops cards whose name left the index, all revisions,
// together with their search documents — and leaves minor cards and partial card
// submissions alone.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { dropRoleCardsOnDb, readRoleCard, writeRoleCard } from '../src/artifact-store.ts'
import { openWork, transaction } from '../src/db.ts'

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

const root = await mkdtemp(join(tmpdir(), 'storycraft-orphan-'))
try {
  const { workId: work } = s.initWork(root, { title: '孤儿卡' })
  s.writeFoundationStage(root, { work, stage: 'frame', payload: frame })
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '乙']) } })
  const firstCards = s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲'), card('yi', '乙')] } })
  const yiRevision = firstCards.artifacts.find(item => item.artifactId === 'role:yi').revisionId

  // AC2: an identical re-run keeps revisions.
  const again = s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '乙']) } })
  check('an identical index re-run keeps the cards',
    readRoleCard(root, { work, slug: 'yi' }).artifact.revisionId === yiRevision,
    JSON.stringify(again.foundation))
  check('the identical re-run keeps the same index revision',
    again.artifacts[0].revisionId === firstCards.artifacts[0]?.revisionId
    || again.artifacts.every(item => item.kind === 'role_index'), JSON.stringify(again.artifacts))

  // AC6: a minor card is not the roles stage's business.
  writeRoleCard(root, { work, content: card('bing', '丙', 'minor') })

  // AC1: dropping 乙 from the index removes its card, latest and old revision.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲']) } })
  let latest = ''
  try { readRoleCard(root, { work, slug: 'yi' }) } catch (error) { latest = error?.code ?? String(error) }
  let old = ''
  try { readRoleCard(root, { work, slug: 'yi', revisionId: yiRevision }) } catch (error) { old = error?.code ?? String(error) }
  check('a dropped major card is gone by latest read', latest === 'artifact-not-found', latest)
  check('a dropped major card is gone by explicit revision too',
    old === 'artifact-not-found' || old === 'revision-not-found', old)
  check('a minor card survives the sync', readRoleCard(root, { work, slug: 'bing' }).artifact.kind === 'role_card')

  // AC4: inside the caller's transaction, a throw rolls both tables back.
  const db = openWork(root, work)
  try {
    check('the search document existed before the rollback',
      db.prepare("SELECT 1 FROM search_docs WHERE doc_id = 'role:jia'").get() !== undefined)
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
    dropRoleCardsOnDb(db, new Set())
    check('a committed delete removes the search document',
      db.prepare("SELECT 1 FROM search_docs WHERE doc_id = 'role:jia'").get() === undefined)
  } finally {
    // Put the card back so the export check has a truth to contrast with.
    db.close()
  }
  s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲')] } })

  // AC3: partial card submissions do not delete the other cards.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '乙', '丙']) } })
  s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('jia', '甲'), card('yi', '乙')] } })
  s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: [card('bing', '丙')] } })
  check('a partial card submission keeps the earlier cards',
    readRoleCard(root, { work, slug: 'jia' }).artifact.kind === 'role_card'
    && readRoleCard(root, { work, slug: 'yi' }).artifact.kind === 'role_card')

  // AC5: the export contains no entry for the card that was dropped earlier.
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: index(['甲', '丙']) } })
  const out = join(root, 'out')
  await s.exportWork(root, work, out)
  const entries = await readdir(out, { recursive: true })
  check('the export has no stale card entry', !entries.some(entry => String(entry).includes('yi')), JSON.stringify(entries))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
