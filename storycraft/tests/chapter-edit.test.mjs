// Chapter delete: only the latest chapter is deletable; move is unsupported.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { backupsDir, openWork } from '../src/storage/db.ts'
import { chapterRemap } from '../src/chapter-edit.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function codeOf(fn) {
  try {
    await fn()
    return 'none'
  } catch (error) {
    return error?.code ?? String(error)
  }
}
const mapOf = (keys, operation) => JSON.stringify([...chapterRemap(keys, operation)])
check('remap delete keeps rank order', mapOf([1, 2, 3, 4], { type: 'delete', chapter: 2 }) === '[[1,1],[3,2],[4,3]]')
check('remap handles holes', mapOf([1, 3], { type: 'move', from: 3, to: 1 }) === '[[1,2],[3,1]]')

const root = await mkdtemp(join(tmpdir(), 'storycraft-chapter-edit-'))
async function seed() {
  const work = (await s.initWork(root, { title: '章节编辑' })).workId
  await s.writeOutline(root, { work, mainline: '一条线' })
  await s.approveOutline(root, { work })
  for (const number of [1, 2, 3, 4]) {
    await s.writePlan(root, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work, chapter: number })
    await s.writeChapter(root, { work, chapter: number, title: `第${number}章`, body: `正文${number}。`.repeat(20) })
  }
  const db = openWork(root, work)
  try {
    db.exec("UPDATE chapters SET stage = 'written', status = 'written'")
  } finally {
    db.close()
  }
  return work
}

try {
  const work = await seed()
  const beforeMeta = openWork(root, work).prepare('SELECT updated_at FROM meta WHERE id = 1').get().updated_at
  check('move is unsupported', await codeOf(() => s.moveChapter(root, work, 1, 2)) === 'chapter-move-unsupported')
  check('deleting a middle chapter is refused',
    await codeOf(() => s.deleteChapter(root, work, 2, { confirm: true })) === 'chapter-delete-latest-only')

  const deleted = await s.deleteChapter(root, work, 4, { confirm: true })
  check('delete removes the latest chapter', deleted.changed === true && deleted.chapters.join(',') === '1,2,3', JSON.stringify(deleted))
  check('delete backs up the work', (await readdir(backupsDir(root))).some(name => name.startsWith(`${work}-`)))
  check('delete leaves no search result for the removed body', s.search(root, work, '正文4').every(item => !String(item.body).startsWith('正文4。')),
    JSON.stringify(s.search(root, work, '正文4')))
  check('earlier chapter numbers do not change', (await s.readChapter(root, { work, chapter: 3, view: 'body' })).content.startsWith('正文3。'))
  check('delete updates meta', openWork(root, work).prepare('SELECT updated_at FROM meta WHERE id = 1').get().updated_at !== beforeMeta)

  check('delete requires confirmation', await codeOf(() => s.deleteChapter(root, work, 3)) === 'chapter-delete-unconfirmed')
  let rolledBack
  try {
    await s.deleteChapter(root, work, 3, { confirm: true, beforeCommit: () => { throw new Error('injected') } })
  } catch (error) {
    rolledBack = error instanceof Error ? error.message : String(error)
  }
  check('failed delete rolls back', rolledBack === 'injected' && s.readManifest(root, work).chapters.some(chapter => chapter.number === 3))

  const holes = (await s.initWork(root, { title: '空洞章节' })).workId
  for (const number of [1, 3]) {
    await s.writePlan(root, { work: holes, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work: holes, chapter: number })
    await s.writeChapter(root, { work: holes, chapter: number, body: `空洞${number}。` })
  }
  const holeDelete = await s.deleteChapter(root, holes, 3, { confirm: true })
  check('holey latest chapter deletes without renumbering', holeDelete.chapters.join(',') === '1', JSON.stringify(holeDelete))
  const zero = await s.deleteChapter(root, holes, 1, { confirm: true })
  check('deleting the last chapter leaves an empty work', zero.changed === true && zero.chapters.length === 0)
  const exported = s.exportWork(root, holes)
  check('empty edited work still exports title-only book', exported.files > 0)
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
