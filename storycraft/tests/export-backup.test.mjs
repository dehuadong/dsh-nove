// Per-work export and backup: single-file units, fixed mtimes, integrity check.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

/** Every file of an export, with content and mtime, sorted by relative path. */
async function readTree(dir) {
  const files = []
  const walk = async (current, relative) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const next = relative === '' ? entry.name : join(relative, entry.name)
      const file = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(file, next)
        continue
      }
      files.push({
        path: next.replaceAll('\\', '/'),
        content: await readFile(file, 'utf8'),
        mtime: (await stat(file)).mtimeMs,
      })
    }
  }
  await walk(dir, '')
  return files.sort((left, right) => left.path.localeCompare(right.path))
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
  store.markProposalUsed(root, proposal.id, work)
  const material = await store.importMaterial(root, work, {
    name: '参考.md', purpose: 'setting', contentBase64: Buffer.from('作者的参考资料。', 'utf8').toString('base64'),
  })

  const defaulted = store.exportWork(root, work)
  check('default export lands under .storycraft/exports', defaulted.directory === join(root, '.storycraft', 'exports', work), defaulted.directory)

  const first = store.exportWork(root, work, join(root, 'out', 'one'))
  const manifest = JSON.parse(await readFile(join(first.directory, 'manifest.json'), 'utf8'))
  check('export manifest is the export copy', manifest.title === '导出测试' && manifest.wordRange?.min === 100
    && manifest.planApproval === 'required' && manifest.tags[0] === '短', JSON.stringify(manifest))
  check('manifest carries the settled chapter', manifest.chapters[0].stage === 'settled' && manifest.chapters[0].currentRevision === 2)
  check('manifest v5 carries the summary binding, material purpose and book',
    manifest.schemaVersion === 5 && manifest.chapters[0].summaryRevision === 2
    && manifest.chapters[0].summaryStale === false
    && manifest.materials.some(item => item.id === material.material.id && item.hash.length === 64 && item.purpose === 'setting')
    && manifest.book?.file === 'book.txt' && manifest.book?.format === 'txt',
  JSON.stringify({ chapter: manifest.chapters[0], materials: manifest.materials, book: manifest.book }))
  const book = await readFile(join(first.directory, 'book.txt'), 'utf8')
  const expectedBook = `导出测试\n\n第 1 章 第一章\n\n${'正文二。'.repeat(20)}\n`
  check('book.txt is byte-exact and current-revision only', book === expectedBook, JSON.stringify(book))
  check('book.txt is counted in the exported files', first.files === (await readTree(first.directory)).length, `${first.files}`)
  const empty = store.initWork(root, { title: '空书' }).workId
  const emptyExport = store.exportWork(root, empty)
  check('empty work writes a title-only book', await readFile(join(emptyExport.directory, 'book.txt'), 'utf8') === '空书\n')
  const planned = store.initWork(root, { title: '只有计划' }).workId
  store.writePlan(root, { work: planned, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  const plannedExport = store.exportWork(root, planned)
  check('planned-only work writes a title-only book', await readFile(join(plannedExport.directory, 'book.txt'), 'utf8') === '只有计划\n')
  const titled = store.initWork(root, { title: '标题测试' }).workId
  store.writePlan(root, { work: titled, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  store.approveChapterPlan(root, { work: titled, chapter: 1 })
  store.writeChapter(root, { work: titled, chapter: 1, title: '一\n章', body: '正文\r\n第二行。' })
  const titledExport = store.exportWork(root, titled)
  check('multiline title and CRLF body normalize',
    await readFile(join(titledExport.directory, 'book.txt'), 'utf8') === '标题测试\n\n第 1 章 一 章\n\n正文\n第二行。\n')
  const multi = store.initWork(root, { title: '多章' }).workId
  for (const number of [1, 2]) {
    store.writePlan(root, { work: multi, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    store.approveChapterPlan(root, { work: multi, chapter: number })
    store.writeChapter(root, { work: multi, chapter: number, title: number === 1 ? '一' : '   ', body: `第${number}章正文。` })
  }
  const multiExport = store.exportWork(root, multi)
  check('multiple chapters stay ordered and blank titles fall back',
    await readFile(join(multiExport.directory, 'book.txt'), 'utf8')
      === '多章\n\n第 1 章 一\n\n第1章正文。\n\n第 2 章\n\n第2章正文。\n')
  const mixed = store.initWork(root, { title: '混合' }).workId
  for (const number of [1, 2]) {
    store.writePlan(root, { work: mixed, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  }
  store.approveChapterPlan(root, { work: mixed, chapter: 1 })
  store.writeChapter(root, { work: mixed, chapter: 1, body: '已写。' })
  const mixedExport = store.exportWork(root, mixed)
  check('planned-only chapters do not appear', await readFile(join(mixedExport.directory, 'book.txt'), 'utf8') === '混合\n\n第 1 章\n\n已写。\n')
  const legacy = join(root, 'out', 'legacy')
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'manifest.json'), '{"schemaVersion":4}\n')
  await writeFile(join(legacy, 'legacy.txt'), 'old\n')
  check('legacy export is not backfilled', !existsSync(join(legacy, 'book.txt')))
  store.exportWork(root, work, legacy)
  check('re-export replaces legacy with v5 and book',
    JSON.parse(await readFile(join(legacy, 'manifest.json'), 'utf8')).schemaVersion === 5
    && existsSync(join(legacy, 'book.txt')))
  const materialFile = await readFile(join(first.directory, 'materials', `${material.material.id}.md`), 'utf8')
  check('export carries the material content', materialFile === '作者的参考资料。', materialFile)
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
  const firstTree = await readTree(first.directory)
  const secondTree = await readTree(second.directory)
  check('two exports have the same file tree', JSON.stringify(firstTree.map(file => file.path)) === JSON.stringify(secondTree.map(file => file.path)))
  check('two exports are byte-identical', JSON.stringify(firstTree) === JSON.stringify(secondTree))
  check('export mtimes are fixed', firstTree.every((file, index) => file.mtime === secondTree[index].mtime))

  // A backup is one SQLite file; integrity_check runs on the copy.
  const defaultBackup = await store.backupWork(root, work)
  check('default backup lands under .storycraft/backups', defaultBackup.file.startsWith(join(root, '.storycraft', 'backups', `${work}-`)), defaultBackup.file)
  const backup = await store.backupWork(root, work, join(root, '.storycraft', 'backups', 'one.db'))
  check('backup integrity is ok', backup.integrity === 'ok', backup.integrity)
  check('backup is a readable work database', (await stat(backup.file)).size > 0)
  const copy = openDatabase(backup.file)
  check('backup carries the same chapters', copy.prepare('SELECT count(*) AS n FROM chapters').get().n === 1)
  const backed = copy.prepare('SELECT * FROM materials').get()
  check('backup carries materials', backed?.id === material.material.id && backed.content === '作者的参考资料。', JSON.stringify(backed))
  copy.close()
  check('manifest origin differs from the export path',
    manifest.materials[0].origin.startsWith('materials/') && manifest.materials[0].origin !== `materials/${material.material.id}.md`,
    manifest.materials[0].origin)

  // A backup that cannot be written reports backup-failed, not a raw fs error.
  const blocked = join(root, 'blocked')
  await mkdir(blocked)
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
  check('rename keeps the exported file set', JSON.stringify((await readTree(third.directory)).map(file => file.path))
    === JSON.stringify(firstTree.map(file => file.path)))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
