// Performance fixture: 200 chapters load and append (#18 acceptance 6).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as bible from '../bible.js'
import * as store from '../store-db.js'
import { select } from '../retrieval.js'

const root = await mkdtemp(join(tmpdir(), 'storycraft-perf-'))
let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
try {
  const { workId: work } = store.initWork(root, { title: '性能夹具' })
  await bible.writeBible(root, work, 'world', '# 世界观\n\n井台。\n')
  await bible.writeBible(root, work, 'style', '# 文风\n\n短句。\n')
  await bible.writeBible(root, work, 'intent', '# 意图\n\n找钥匙。\n')
  store.writeOutline(root, { work, mainline: '长篇。' })
  await bible.writeBible(root, work, 'characters', '[]')
  for (let number = 1; number <= 200; number += 1) {
    store.writePlan(root, {
      work, chapter: number, perspective: '周砚', goal: `目标${number}`,
      obstacle: '阻力', cost: '代价', turn: `变化${number}`,
    })
    store.approveChapterPlan(root, { work, chapter: number })
  }
  let started = performance.now()
  for (let number = 1; number <= 200; number += 1) {
    store.writeChapter(root, { work, chapter: number, body: `第 ${number} 章正文：周砚摸井台。` })
  }
  const appendAll = performance.now() - started

  started = performance.now()
  const manifest = store.readManifest(root, work)
  const load = performance.now() - started
  check('200 chapters load under 100ms', load < 100, `${load.toFixed(1)}ms`)
  check('manifest has 200 chapters', manifest.chapters.length === 200, String(manifest.chapters.length))

  started = performance.now()
  store.writePlan(root, { work, chapter: 201, perspective: '周砚', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  store.approveChapterPlan(root, { work, chapter: 201 })
  store.writeChapter(root, { work, chapter: 201, body: '第 201 章正文。' })
  const appendOne = performance.now() - started
  check('append one chapter under 50ms', appendOne < 50, `${appendOne.toFixed(1)}ms`)
  check('bulk append stays reasonable', appendAll < 5000, `${appendAll.toFixed(0)}ms`)

  for (let number = 1; number <= 200; number += 1) {
    store.writeSummary(root, { work, chapter: number, text: `第 ${number} 章摘要：周砚在井台边找到一把旧钥匙。` })
  }
  for (let number = 1; number <= 20; number += 1) {
    store.writeReview(root, { work, chapter: number, problems: [] })
    store.foldState(root, { work, chapter: number, hooks: [{ text: '旧钥匙', state: 'opened' }] })
  }
  store.reopenChapter(root, { work, chapter: 10 })
  started = performance.now()
  const candidates = store.searchMemory(root, work, '井台 旧钥匙', { beforeChapter: 201 })
  const picked = select(candidates, { excludeIds: [], limit: 5, budget: 1200 })
  const retrieval = performance.now() - started
  check('200-chapter retrieval fits 400ms', retrieval < 400, `${retrieval.toFixed(1)}ms`)
  check('retrieval returns five bounded hits', picked.hits.filter(hit => hit.sent).length <= 5
    && picked.chars <= 1200 && candidates.length > 0, `${candidates.length}/${picked.chars}`)

  const prefix = Buffer.from('专属素材词\n', 'utf8')
  const big = Buffer.concat([prefix, Buffer.from('水'.repeat(Math.floor((512 * 1024 - prefix.length) / 3)), 'utf8')])
  for (let index = 0; index < 3; index += 1) {
    await store.importMaterial(root, work, {
      name: `perf-${index}.md`,
      purpose: 'setting',
      contentBase64: (index === 0 ? big : Buffer.from(`专属素材词 第${index}份`, 'utf8')).toString('base64'),
    })
  }
  started = performance.now()
  const materialCandidates = store.searchMemory(root, work, '专属素材词', { beforeChapter: 201 })
  const materialPicked = select(materialCandidates, { excludeIds: [], limit: 5, budget: 1200 })
  const materialRetrieval = performance.now() - started
  check('material retrieval with a 512KB file fits 400ms', materialRetrieval < 400, `${materialRetrieval.toFixed(1)}ms`)
  check('material snippets stay bounded', materialCandidates.some(item => item.kind === 'material')
    && materialCandidates.filter(item => item.kind === 'material').every(item => [...item.text].length <= 400)
    && materialPicked.hits.filter(hit => hit.sent).length <= 2
    && materialPicked.chars <= 1200, JSON.stringify(materialCandidates.map(item => [item.id, item.text.length])))

  store.writePlan(root, { work, chapter: 200, perspective: '周砚', goal: '专属素材词', obstacle: 'o', cost: 'c', turn: 't' })
  started = performance.now()
  const brief = await bible.assembleBrief(root, work, 200)
  const briefTime = performance.now() - started
  check('full brief with 512KB material fits 400ms', briefTime < 400, `${briefTime.toFixed(1)}ms`)
  check('brief includes material within budget', brief.retrieval.enabled === true
    && brief.retrieval.hits.some(hit => hit.kind === 'material' && hit.sent === true)
    && brief.budget.used <= 8192, JSON.stringify(brief.retrieval))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
