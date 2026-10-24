// Deterministic retrieval: query building, selection, FTS filters and budget.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mintHookId } from '../dist/state-projection.js'
import * as s from '../dist/storage.js'
import { openWork } from '../dist/db.js'
import { buildQuery, codePointLength, select, snippetFor } from '../dist/retrieval.js'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

check('query joins task, plan, hooks and instruction',
  buildQuery({
    taskText: '写第 5 章', chapterPlan: '- 目标：找旧井', openHooks: [{ text: '备用钥匙' }], instruction: '写紧一点',
  }) === '写第 5 章\n- 目标：找旧井\n备用钥匙\n写紧一点')
check('empty query stays empty', buildQuery({ taskText: ' ', openHooks: [] }) === '')
check('long instruction is clipped in the query', buildQuery({ instruction: '长'.repeat(800) }).length === 600)
check('code point length counts astral characters', codePointLength('a😀中') === 3)
check('snippet anchors on a strong token', snippetFor('开头的话。旧井边有钥匙。结尾。', ['旧井'], 12).includes('旧井'),
  snippetFor('开头的话。旧井边有钥匙。结尾。', ['旧井'], 12))
check('snippet is bounded', [...snippetFor('长'.repeat(1000), ['长'], 40)].length <= 40,
  String([...snippetFor('长'.repeat(1000), ['长'], 40)].length))

const candidates = [
  { id: 'summary:1', kind: 'summary', sourceIds: ['summary:1'], chapter: 1, text: '旧井的水位', score: 3 },
  { id: 'summary:2', kind: 'summary', sourceIds: ['summary:2'], chapter: 2, text: '第二章摘要', score: 3 },
  { id: 'event:9', kind: 'hook', sourceIds: ['state'], chapter: 3, text: '备用钥匙', score: 1 },
]
const picked = select(candidates)
check('selection orders by score then chapter', picked.hits.map(hit => hit.id).join(',') === 'summary:2,summary:1,event:9',
  picked.hits.map(hit => hit.id).join(','))
check('selection labels each sent fragment', picked.text.includes('〔summary:2〕第二章摘要') && picked.text.includes('〔event:9〕备用钥匙'), picked.text)
check('selection trace carries sourceIds', picked.hits.every(hit => Array.isArray(hit.sourceIds) && hit.sourceIds.length > 0), JSON.stringify(picked.hits))
const excluded = select(candidates, { excludeIds: ['summary:2'] })
check('excluded ids never enter', excluded.hits.every(hit => hit.id !== 'summary:2') && !excluded.text.includes('第二章摘要'), JSON.stringify(excluded.hits))
const tight = select(candidates, { budget: 5, limit: 5 })
check('selection drops whole items over budget', tight.hits.find(hit => hit.id === 'event:9')?.sent === false && tight.text === '〔summary:2〕第二章摘要', JSON.stringify(tight))
const limited = select(candidates, { limit: 1 })
check('selection limit caps sent hits', limited.hits.filter(hit => hit.sent).length === 1 && limited.text.includes('〔summary:2〕'), JSON.stringify(limited))
check('selection is deterministic', JSON.stringify(select(candidates)) === JSON.stringify(picked))
const many = Array.from({ length: 12 }, (_, index) => ({
  id: `summary:${index + 1}`, kind: 'summary', sourceIds: [`summary:${index + 1}`], chapter: index + 1, text: `第${index + 1}章`, score: 10 - index,
}))
const traced = select(many)
check('per-kind cap sends two and trace keeps ten', traced.hits.length === 10 && traced.hits.filter(hit => hit.sent).length === 2,
  JSON.stringify(traced.hits))
const hooks = Array.from({ length: 10 }, (_, index) => ({
  id: `event:${index + 1}`, kind: 'hook', sourceIds: ['state'], chapter: index + 1, text: `钩子${index + 1}`, score: 100 - index,
}))
const laterMaterial = { id: 'material:mat-1', kind: 'material', sourceIds: ['material:mat-1'], chapter: 0, text: '素材', score: 1 }
const mixed = select([...hooks, laterMaterial])
check('scan reaches a later material after the hook cap',
  mixed.hits.some(hit => hit.id === 'material:mat-1' && hit.sent === true)
  && mixed.hits.filter(hit => hit.kind === 'hook' && hit.sent).length === 2,
  JSON.stringify(mixed.hits))
const capped = select([...hooks, ...Array.from({ length: 2 }, (_, index) => ({
  id: `summary:${index + 1}`, kind: 'summary', sourceIds: [`summary:${index + 1}`], chapter: 1, text: '摘要', score: 9,
})), ...Array.from({ length: 2 }, (_, index) => ({
  id: `volume:${index + 1}`, kind: 'volume', sourceIds: [`volume:${index + 1}`], chapter: 1, text: '卷', score: 9,
})), ...Array.from({ length: 2 }, (_, index) => ({
  id: `material:${index + 1}`, kind: 'material', sourceIds: [`material:${index + 1}`], chapter: 0, text: '素材', score: 9,
}))], { limit: 8 })
check('limit above five stays within the bounded trace', capped.hits.length <= 15
  && capped.hits.filter(hit => hit.sent).length <= 5,
JSON.stringify(capped.hits))

const root = await mkdtemp(join(tmpdir(), 'storycraft-retrieval-'))
try {
  const work = (await s.initWork(root, { title: '检索测试', wordRange: { min: 100, max: 500 } })).workId
  await s.writeOutline(root, { work, mainline: '旧井与钥匙' })
  await s.approveOutline(root, { work })
  for (const number of [1, 2, 3, 4]) {
    await s.writePlan(root, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work, chapter: number })
    await s.writeChapter(root, { work, chapter: number, body: `第${number}章正文。`.repeat(20) })
    await s.writeSummary(root, { work, chapter: number, text: number === 1 ? '旧井边有一把备用钥匙。' : `第${number}章摘要。` })
  }
  await s.writePlan(root, { work, chapter: 5, perspective: '甲', goal: '找旧井', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work, chapter: 5 })
  await s.writeVolume(root, { work, id: 'v1', title: '第一卷', from: 1, to: 2, summary: '旧井第一次出现。' })
  await reviewFixture(root, { work, chapter: 1, observations: [] })
  await s.settleState(root, { work, chapter: 1, newHooks: [{ text: '旧井的水位' }] })
  await reviewFixture(root, { work, chapter: 2, observations: [] })
  await s.settleState(root, { work, chapter: 2, hookOps: { resolve: [mintHookId('旧井的水位')] } })
  await reviewFixture(root, { work, chapter: 3, observations: [] })
  await s.settleState(root, { work, chapter: 3, newHooks: [{ text: '备用钥匙' }] })
  // Mark chapter 2's summary stale; it must not be retrieved.
  const events = openWork(root, work)
  const summaryRow = events.prepare("SELECT artifact_id, revision_id, content FROM artifacts WHERE artifact_id = 'summary:2' ORDER BY rowid DESC LIMIT 1").get()
  const summaryContent = JSON.parse(summaryRow.content)
  summaryContent.bodyRevision = 0
  events.prepare('UPDATE artifacts SET content = ? WHERE artifact_id = ? AND revision_id = ?')
    .run(JSON.stringify(summaryContent), summaryRow.artifact_id, summaryRow.revision_id)
  events.close()

  const { searchMemory } = await import('../dist/store-db.js')
  const hook = searchMemory(root, work, '备用钥匙', { beforeChapter: 5 })
  check('unresolved hook is retrieved', hook.some(item => item.kind === 'hook' && item.text.startsWith('备用钥匙') && item.sourceIds[0] === 'state'), JSON.stringify(hook))
  const resolved = searchMemory(root, work, '旧井的水位', { beforeChapter: 5 })
  check('resolved hook is excluded', resolved.every(item => item.id !== 'event:1' && item.id !== 'event:2'), JSON.stringify(resolved))
  const stale = searchMemory(root, work, '第2章摘要', { beforeChapter: 5 })
  check('stale summary is excluded', stale.every(item => item.id !== 'summary:2'), JSON.stringify(stale))
  const volume = searchMemory(root, work, '旧井第一次出现', { beforeChapter: 5 })
  check('volume is retrieved with its artifact id', volume.some(item => item.id === 'volume:v1' && item.sourceIds[0] === 'volume:v1'), JSON.stringify(volume))
  const volumeBefore = searchMemory(root, work, '旧井第一次出现', { beforeChapter: 2 })
  check('volume to_ch excludes a volume that reaches the target', volumeBefore.every(item => item.kind !== 'volume'), JSON.stringify(volumeBefore))
  const future = searchMemory(root, work, '旧井', { beforeChapter: 2 })
  check('target chapter and later docs are excluded', future.every(item => item.chapter < 2), JSON.stringify(future))
  const all = searchMemory(root, work, '备用钥匙')
  check('work-scope search has no target filter', all.some(item => item.kind === 'hook' && item.text.startsWith('备用钥匙')), JSON.stringify(all))
  await s.reopenChapter(root, { work, chapter: 3 })
  const reopened = searchMemory(root, work, '备用钥匙', { beforeChapter: 5 })
  check('hook events before the latest reopen are excluded', reopened.every(item => item.kind !== 'hook'), JSON.stringify(reopened))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
