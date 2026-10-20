// Search projection + export/backup inside one work database.
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
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
  store.writeReview(root, { work, chapter: 1, problems: [{ location: '结尾', problem: '收得太快' }] })
  store.reviseChapter(root, { work, chapter: 1, body: '周砚带人复摸井台，记下十六口人，井深二丈二尺。又在井边停了一拍。', problemIds: ['Q1'], mode: 'rewrite' })
  store.writeSummary(root, { work, chapter: 1, text: '周砚摸井台，发现第三人。' })
  store.foldState(root, { work, chapter: 1, entities: [{ name: '周砚', facts: ['摸过井台'] }] })
  store.writeVolume(root, { work, id: 'v1', title: '第一卷', from: 1, to: 1, summary: '井台开局' })

  const byChapter = store.search(root, work, '井台', 5)
  check('chapter body is searchable', byChapter.some(hit => hit.kind === 'chapter'))
  const bySummary = store.search(root, work, '第三人', 5)
  check('summary is searchable', bySummary.some(hit => hit.kind === 'summary'))
  const byEvent = store.search(root, work, '周砚 摸过', 5)
  check('event is searchable', byEvent.some(hit => hit.kind === 'entity'))
  store.writeBible(root, { work, name: 'characters', content: '周砚：主角，摸井台的人。' })
  const byCard = store.search(root, work, '主角', 5)
  check('character card is searchable', byCard.some(hit => hit.kind === 'card'))
  store.writeBible(root, { work, name: 'world', content: '大朔，井台与河工。' })
  store.writeChapter(root, { work, chapter: 1, body: '完全改写：河工要银。', rewrite: true, reopen: true })
  const stale = store.search(root, work, '十六口人', 5)
  check('old revision leaves the search projection', !stale.some(hit => hit.kind === 'chapter'))
  const fresh = store.search(root, work, '河工', 5)
  check('new revision is searchable', fresh.some(hit => hit.kind === 'chapter'))
  store.writeReview(root, { work, chapter: 1, problems: [{ location: '结尾', problem: '收得太快' }] })
  const byVolume = store.search(root, work, '开局', 5)
  check('volume is searchable', byVolume.some(hit => hit.kind === 'volume'))
  check('empty query returns nothing', store.search(root, work, '  ', 5).length === 0)

  const first = store.exportWork(root, work, join(root, '.storycraft', 'exports', 'one'))
  const manifest = JSON.parse(await readFile(join(first.directory, 'manifest.json'), 'utf8'))
  check('export manifest has chapters', manifest.chapters.length === 1 && manifest.schemaVersion === 1)
  const chapters = await readdir(join(first.directory, 'chapters'))
  check('export keeps r1 as ch-0001.md', chapters.includes('ch-0001.md'), chapters.join(','))
  check('export keeps r2 as ch-0001.r2.md', chapters.includes('ch-0001.r2.md'), chapters.join(','))
  const reviews = await readdir(join(first.directory, 'reviews'))
  check('export includes review rounds', reviews.includes('ch-0001.r1.md'), reviews.join(','))
  const bible = await readdir(join(first.directory, 'bible'))
  check('export includes world and characters', bible.includes('world.md') && bible.includes('characters.json'), bible.join(','))
  const events = await readFile(join(first.directory, 'state', 'events.jsonl'), 'utf8')
  check('export includes events', events.includes('周砚'))

  const renamed = store.renameWork(root, { work, workId: '检索改名' })
  const afterRename = store.search(root, '检索改名', '河工', 5)
  check('search survives rename', afterRename.some(hit => hit.kind === 'chapter'))
  const second = store.exportWork(root, renamed.workId, join(root, '.storycraft', 'exports', 'two'))
  const again = JSON.parse(await readFile(join(second.directory, 'manifest.json'), 'utf8'))
  check('two manifest copies match', JSON.stringify(again) === JSON.stringify(manifest))
  const firstTime = (await stat(join(first.directory, 'manifest.json'))).mtimeMs
  const secondTime = (await stat(join(second.directory, 'manifest.json'))).mtimeMs
  check('manifest mtimes are normalized', firstTime === secondTime, `${firstTime} vs ${secondTime}`)

  const backup = await store.backupWork(root, renamed.workId, join(root, '.storycraft', 'backups', 'b.db'))
  check('backup integrity ok', backup.integrity === 'ok', backup.integrity)
  check('backup is one work file', (await stat(backup.file)).size > 0)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
