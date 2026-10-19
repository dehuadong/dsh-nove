// Performance fixture: 200 chapters load and append (#18 acceptance 6).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../store-db.js'

const root = await mkdtemp(join(tmpdir(), 'storycraft-perf-'))
let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
try {
  const { workId: work } = store.initWork(root, { title: '性能夹具' })
  for (let number = 1; number <= 200; number += 1) {
    store.writePlan(root, {
      work, chapter: number, perspective: '周砚', goal: `目标${number}`,
      obstacle: '阻力', cost: '代价', turn: `变化${number}`,
    })
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
  store.writeChapter(root, { work, chapter: 201, body: '第 201 章正文。' })
  const appendOne = performance.now() - started
  check('append one chapter under 50ms', appendOne < 50, `${appendOne.toFixed(1)}ms`)
  check('bulk append stays reasonable', appendAll < 5000, `${appendAll.toFixed(0)}ms`)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
