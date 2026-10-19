// Search projection + export/backup (S4/S5).
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../store-db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-s45-'))
try {
  const { workId: work } = store.initWork(root, { title: '检索测试' })
  store.writePlan(root, { work, chapter: 1, perspective: '周砚', goal: '摸井台', obstacle: '巡夜', cost: '暴露', turn: '第三人' })
  store.writeChapter(root, { work, chapter: 1, body: '周砚带人复摸井台，记下十六口人，井深二丈二尺。' })
  store.writeSummary(root, { work, chapter: 1, text: '周砚摸井台，发现第三人。' })
  store.foldState(root, { work, chapter: 1, events: [{ kind: 'entity', name: '周砚', fact: '摸过井台' }] })
  store.writeVolume(root, { work, id: 'v1', title: '第一卷', from: 1, to: 3, summary: '井台开局' })

  const byChapter = store.search(root, work, '井台', 5)
  check('chapter body is searchable', byChapter.some(hit => hit.kind === 'chapter'))
  const bySummary = store.search(root, work, '第三人', 5)
  check('summary is searchable', bySummary.some(hit => hit.kind === 'summary'))
  const byEvent = store.search(root, work, '周砚 摸过', 5)
  check('event is searchable', byEvent.some(hit => hit.kind === 'entity'))
  const byVolume = store.search(root, work, '开局', 5)
  check('volume is searchable', byVolume.some(hit => hit.kind === 'volume'))
  check('empty query returns nothing', store.search(root, work, '  ', 5).length === 0)

  const first = await store.exportWork(root, work, join(root, '.storycraft', 'exports', 'one'))
  const manifest = JSON.parse(await readFile(join(first.directory, 'manifest.json'), 'utf8'))
  check('export manifest has chapters', manifest.chapters.length === 1 && manifest.schemaVersion === 1)
  const chapters = await readdir(join(first.directory, 'chapters'))
  check('export keeps r1 as ch-0001.md', chapters.includes('ch-0001.md'), chapters.join(','))
  const events = await readFile(join(first.directory, 'state', 'events.jsonl'), 'utf8')
  check('export includes events', events.includes('周砚'))

  const second = await store.exportWork(root, work, join(root, '.storycraft', 'exports', 'two'))
  const again = JSON.parse(await readFile(join(second.directory, 'manifest.json'), 'utf8'))
  check('two exports share manifest content', JSON.stringify(again) === JSON.stringify(manifest))

  const backup = await store.backupStore(root, join(root, '.storycraft', 'backups', 'b.db'))
  check('backup integrity ok', backup.integrity === 'ok', backup.integrity)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
