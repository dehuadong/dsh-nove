// Per-work export and backup: single-file units, fixed mtimes, integrity check.
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db.js'
import * as store from '../store-db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-export-'))
try {
  const { workId: work } = store.initWork(root, { title: '导出测试', wordRange: { min: 100, max: 500 }, tags: ['短'] })
  store.writeOutline(root, { work, mainline: '主线', ending: '结局' })
  store.approveOutline(root, { work })
  store.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  store.approveChapterPlan(root, { work, chapter: 1 })
  store.writeChapter(root, { work, chapter: 1, title: '第一章', body: '正文一。'.repeat(20) })
  store.writeReview(root, { work, chapter: 1, problems: [{ location: '开头', problem: '慢', suggestion: '快' }] })
  store.reviseChapter(root, { work, chapter: 1, body: '正文二。'.repeat(20), problemIds: ['Q1'], mode: 'rewrite' })
  store.writeSummary(root, { work, chapter: 1, text: '摘要一。' })
  store.foldState(root, { work, chapter: 1, entities: [{ name: '甲', facts: ['到场'] }], hooks: [{ text: '一个钩子', state: 'opened' }] })
  store.writeVolume(root, { work, id: 'v1', title: '第一卷', from: 1, to: 1, summary: '开局' })
  store.writeBible(root, { work, name: 'world', content: '# 世界观\n\n荒原。\n' })
  const proposal = store.createProposal(root, { title: '提案一', premise: '一句话' })

  const first = store.exportWork(root, work, join(root, 'out', 'one'))
  const manifest = JSON.parse(await readFile(join(first.directory, 'manifest.json'), 'utf8'))
  check('export manifest is the export copy', manifest.title === '导出测试' && manifest.wordRange?.min === 100
    && manifest.planApproval === 'required' && manifest.tags[0] === '短', JSON.stringify(manifest))
  check('manifest carries the settled chapter', manifest.chapters[0].stage === 'settled' && manifest.chapters[0].currentRevision === 2)
  const chapters = await readdir(join(first.directory, 'chapters'))
  check('r1 keeps the base name and r2 is versioned', chapters.includes('ch-0001.md') && chapters.includes('ch-0001.r2.md'), chapters.join(','))
  const reviews = await readdir(join(first.directory, 'reviews'))
  check('every review round is exported', reviews.includes('ch-0001.r1.md'), reviews.join(','))
  const bible = await readdir(join(first.directory, 'bible'))
  check('truth entries are exported', ['world.md', 'characters.json', 'style.md', 'plan.md', 'intent.md'].every(name => bible.includes(name)), bible.join(','))
  const proposals = await readdir(join(first.directory, 'proposals'))
  check('proposals are exported with the work', proposals.includes(`${proposal.id}.json`), proposals.join(','))
  check('volumes are exported', (await readFile(join(first.directory, 'volumes.json'), 'utf8')).includes('开局'))
  check('events are exported', (await readFile(join(first.directory, 'state', 'events.jsonl'), 'utf8')).includes('一个钩子'))

  // Two exports of unchanged content are byte-identical and share mtimes.
  const second = store.exportWork(root, work, join(root, 'out', 'two'))
  check('two exports share the manifest content',
    JSON.stringify(JSON.parse(await readFile(join(second.directory, 'manifest.json'), 'utf8'))) === JSON.stringify(manifest))
  check('export mtimes are fixed',
    (await stat(join(first.directory, 'manifest.json'))).mtimeMs === (await stat(join(second.directory, 'manifest.json'))).mtimeMs)

  // A backup is one SQLite file; integrity_check runs on the copy.
  const backup = await store.backupWork(root, work, join(root, '.storycraft', 'backups', 'one.db'))
  check('backup integrity is ok', backup.integrity === 'ok', backup.integrity)
  check('backup is a readable work database', (await stat(backup.file)).size > 0)
  const copy = openDatabase(backup.file)
  check('backup carries the same chapters', copy.prepare('SELECT count(*) AS n FROM chapters').get().n === 1)
  copy.close()

  // A backup that cannot be written reports backup-failed, not a raw fs error.
  const blocked = join(root, 'blocked')
  await (await import('node:fs/promises')).mkdir(blocked)
  let failedCode
  try {
    await store.backupWork(root, work, blocked)
  } catch (error) {
    failedCode = error.code
  }
  check('unwritable backup reports backup-failed', failedCode === 'backup-failed', String(failedCode))

  // Rename keeps exporting the same content under the new identity.
  const renamed = store.renameWork(root, { work, workId: '导出改名' })
  const third = store.exportWork(root, renamed.workId, join(root, 'out', 'three'))
  check('export follows the new identity',
    JSON.stringify(JSON.parse(await readFile(join(third.directory, 'manifest.json'), 'utf8'))) === JSON.stringify(manifest))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
