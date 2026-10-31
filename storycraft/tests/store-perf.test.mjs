// F13: 250-chapter load, consumers, export and memory budgets.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as bible from '../src/bible.ts'
import * as store from '../src/store-db.ts'
import { exportsDir } from '../src/db.ts'
import { select } from '../src/retrieval.ts'
import { readAnalysis } from '../src/analysis.ts'
import { selfCheck } from '../src/self-check.ts'
import { buildPerfFixture } from './perf-fixture.mjs'

const root = await mkdtemp(join(tmpdir(), 'storycraft-perf-'))
let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function median(fn, before, samples = 3) {
  if (before !== undefined) await before()
  await fn()
  const times = []
  for (let index = 0; index < samples; index += 1) {
    if (before !== undefined) await before()
    const started = performance.now()
    await fn()
    times.push(performance.now() - started)
  }
  return times.sort((left, right) => left - right)[Math.floor(times.length / 2)]
}
async function budget(name, fn, limit) {
  const ms = await median(fn)
  check(`${name} under ${limit}ms`, ms < limit, `${ms.toFixed(1)}ms`)
}
try {
  const fixture = await buildPerfFixture(root, { chapters: 250, smallWorks: 20, smallChapters: 10 })
  const { work } = fixture

  const manifest = store.readManifest(root, work)
  check('manifest has 250 chapters', manifest.chapters.length === 250, String(manifest.chapters.length))
  check('fixture has 21 works', store.listWorks(root).length === 21, String(store.listWorks(root).length))
  await budget('250-chapter readManifest', () => store.readManifest(root, work), 100)
  await budget('250-chapter readWork', () => store.readWork(root, work), 150)
  await budget('250-chapter status', () => store.status(root, work), 300)
  const selfCheckStarted = performance.now()
  const selfCheckReport = selfCheck(root, work)
  const selfCheckMs = performance.now() - selfCheckStarted
  check('250-chapter self-check under 1000ms', selfCheckMs < 1000, selfCheckMs.toFixed(1) + 'ms')
  check('250-chapter self-check has no body text', !JSON.stringify(selfCheckReport).includes('周砚'))
  const analysisStarted = performance.now()
  const analysis = await readAnalysis(root, work)
  const analysisMs = performance.now() - analysisStarted
  const analysisJson = JSON.stringify(analysis)
  check('250-chapter analysis under 300ms', analysisMs < 300, analysisMs.toFixed(1) + 'ms')
  check('250-chapter analysis carries counts only', !analysisJson.includes('"observations"') && !analysisJson.includes('"summary"') && !analysisJson.includes('周砚'), analysisJson.slice(0, 200))
  await budget('250-chapter listWorks (21 works)', () => store.listWorks(root), 500)
  await budget('chapter-250 assembleBrief', () => bible.assembleBrief(root, work, 250), 400)

  check('bulk append 250 chapters stays reasonable', fixture.bulkAppendMs < 5000, `${fixture.bulkAppendMs.toFixed(0)}ms`)

  let appendOne = Number.POSITIVE_INFINITY
  for (const chapter of [251, 252, 253]) {
    const started = performance.now()
    store.writePlan(root, { work, chapter, perspective: '周砚', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    store.approveChapterPlan(root, { work, chapter })
    store.writeChapter(root, { work, chapter, body: `第 ${chapter} 章正文。` })
    appendOne = Math.min(appendOne, performance.now() - started)
  }
  check('append one chapter under 50ms', appendOne < 50, `${appendOne.toFixed(1)}ms`)

  const retrieval = await median(() => {
    const candidates = store.searchMemory(root, work, '井台 旧钥匙', { beforeChapter: 251 })
    return select(candidates, { excludeIds: [], limit: 5, budget: 1200 })
  })
  check('250-chapter retrieval fits 400ms', retrieval < 400, `${retrieval.toFixed(1)}ms`)
  const retrievalHits = select(store.searchMemory(root, work, '井台 旧钥匙', { beforeChapter: 251 }), { excludeIds: [], limit: 5, budget: 1200 })
  check('retrieval stays bounded', retrievalHits.hits.filter(hit => hit.sent).length <= 5 && retrievalHits.chars <= 1200, JSON.stringify({ hits: retrievalHits.hits.length, chars: retrievalHits.chars }))

  const prefix = Buffer.from('专属素材词\n', 'utf8')
  const big = Buffer.concat([prefix, Buffer.from('水'.repeat(Math.floor((512 * 1024 - prefix.length) / 3)), 'utf8')])
  for (let index = 0; index < 3; index += 1) {
    await store.importMaterial(root, work, {
      name: `perf-${index}.md`,
      purpose: 'setting',
      contentBase64: (index === 0 ? big : Buffer.from(`专属素材词 第${index}份`, 'utf8')).toString('base64'),
    })
  }
  const materialRetrieval = await median(() => {
    const candidates = store.searchMemory(root, work, '专属素材词', { beforeChapter: 251 })
    return select(candidates, { excludeIds: [], limit: 5, budget: 1200 })
  })
  check('material retrieval with a 512KB file fits 400ms', materialRetrieval < 400, `${materialRetrieval.toFixed(1)}ms`)
  const materialHits = store.searchMemory(root, work, '专属素材词', { beforeChapter: 251 })
  check('material snippets stay bounded', materialHits.filter(item => item.kind === 'material').every(item => [...item.text].length <= 400), JSON.stringify(materialHits.map(item => [item.id, item.text.length])))

  const briefWithMaterialMs = await median(() => bible.assembleBrief(root, work, 250))
  check('full brief with 512KB material under 400ms', briefWithMaterialMs < 400, `${briefWithMaterialMs.toFixed(1)}ms`)
  const briefWithMaterial = await bible.assembleBrief(root, work, 250)
  check('brief with material stays within its token budget', briefWithMaterial.budget.used <= 8192, String(briefWithMaterial.budget.used))
  check('brief includes material within budget', briefWithMaterial.retrieval.enabled === true && briefWithMaterial.retrieval.hits.some(hit => hit.kind === 'material' && hit.sent === true), JSON.stringify(briefWithMaterial.retrieval))

  const exportTarget = join(exportsDir(root), work)
  const exportMs = await median(() => store.exportWorkAtomic(root, work), () => rmSync(exportTarget, { recursive: true, force: true }))
  check('250-chapter atomic export under 3000ms', exportMs < 3000, `${exportMs.toFixed(0)}ms`)

  const probePath = join(import.meta.dirname, 'perf-memory-probe.mjs')
  const probes = []
  for (let index = 0; index < 3; index += 1) {
    probes.push(spawnSync(process.execPath, [probePath, root, work], { encoding: 'utf8' }))
  }
  const memory = probes.map(probe => {
    if (probe.status !== 0) return { error: probe.stderr || probe.stdout }
    try { return JSON.parse(probe.stdout.trim().split('\n').at(-1)) } catch { return { error: probe.stdout } }
  }).sort((left, right) => Number(left.maxRSSKB ?? Infinity) - Number(right.maxRSSKB ?? Infinity))[1]
  check('memory probe runs', memory.error === undefined, JSON.stringify(memory))
  check('250-chapter read memory stays under 256MB',
    Number(memory.maxRSSKB) > 0 && Number(memory.maxRSSKB) <= 256 * 1024,
    JSON.stringify(memory))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
