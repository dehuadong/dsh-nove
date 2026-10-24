// Chapter delete/reorder: rank mapping, references, search index and rollback.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { backupsDir, openWork } from '../db.js'
import { chapterRemap } from '../chapter-edit.js'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const mapOf = (keys, operation) => JSON.stringify([...chapterRemap(keys, operation)])
check('remap delete keeps rank order', mapOf([1, 2, 3, 4], { type: 'delete', chapter: 2 }) === '[[1,1],[3,2],[4,3]]')
check('remap handles holes', mapOf([1, 3], { type: 'move', from: 3, to: 1 }) === '[[1,2],[3,1]]')
check('remap no-op is empty', chapterRemap([1, 2], { type: 'move', from: 1, to: 1 }).size === 0)

const root = await mkdtemp(join(tmpdir(), 'storycraft-chapter-edit-'))
async function seed() {
  const work = (await s.initWork(root, { title: '章节编辑' })).workId
  await s.writeOutline(root, { work, mainline: '一条线' })
  await s.approveOutline(root, { work })
  for (const number of [1, 2, 3, 4]) {
    await s.writePlan(root, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work, chapter: number })
    await s.writeChapter(root, { work, chapter: number, title: `第${number}章`, body: `正文${number}。`.repeat(20) })
    await reviewFixture(root, { work, chapter: number, observations: [] })
    await s.writeSummary(root, { work, chapter: number, text: `摘要${number}。` })
    await s.settleState(root, { work, chapter: number, newHooks: [{ text: `钩子${number}` }] })
  }
  await s.writeVolume(root, { work, id: 'v1', title: '卷一', from: 1, to: 4, summary: '整卷。' })
  return work
}

try {
  const work = await seed()
  const beforeMeta = openWork(root, work).prepare('SELECT updated_at FROM meta WHERE id = 1').get().updated_at
  const reset = openWork(root, work)
  try {
    reset.exec("UPDATE chapters SET stage = 'written', status = 'written'")
  } finally {
    reset.close()
  }
  const deleted = await s.deleteChapter(root, work, 2, { confirm: true })
  check('delete returns changed and survivors', deleted.changed === true && deleted.chapters.join(',') === '1,2,3', JSON.stringify(deleted))
  check('delete backs up the work', (await readdir(backupsDir(root))).some(name => name.startsWith(`${work}-`)))
  check('delete leaves no search result for the removed body', s.search(root, work, '正文2').every(item => !String(item.body).startsWith('正文2。')),
    JSON.stringify(s.search(root, work, '正文2')))
  const db = openWork(root, work)
  try {
    const headers = db.prepare('SELECT number, title, current_revision FROM chapters ORDER BY number').all()
    check('chapters renumber by rank', headers.map(row => `${row.number}:${row.title}:${row.current_revision}`).join(',')
      === '1:第1章:1,2:第3章:1,3:第4章:1', JSON.stringify(headers))
    check('reviews and summaries follow chapters',
      [1, 2, 3].map(chapter => s.readSummary(root, work, chapter)?.trim()).join('|') === '摘要1。|摘要3。|摘要4。'
      && db.prepare("SELECT count(*) AS n FROM artifacts WHERE kind = 'review' AND scope_chapter = 2").get().n === 1)
    check('events follow chapters',
      db.prepare("SELECT chapter FROM events WHERE kind = 'hook' AND payload LIKE '%钩子3%'").get()?.chapter === 2)
    check('search docs follow chapters',
      db.prepare("SELECT chapter FROM search_docs WHERE doc_id LIKE 'chapter:2:%'").get()?.chapter === 2
      && db.prepare("SELECT count(*) AS n FROM search_docs WHERE doc_id LIKE 'event:%' AND chapter = 2").get().n === 1)
    check('delete marker keeps seq above old max',
      db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'chapter-edit'").get().n === 1)
    check('delete updates meta', db.prepare('SELECT updated_at FROM meta WHERE id = 1').get().updated_at !== beforeMeta)
    check('stale volume is reported and its search doc is untouched', deleted.staleVolumes.includes('v1')
      && db.prepare("SELECT chapter FROM search_docs WHERE doc_id = 'volume:v1'").get()?.chapter === 1,
    JSON.stringify(deleted.staleVolumes))
  } finally {
    db.close()
  }

  const moved = await s.moveChapter(root, work, 3, 2)
  check('move swaps adjacent ranks', moved.changed === true && moved.chapters.join(',') === '1,2,3', JSON.stringify(moved))
  check('moved body follows the chapter', (await s.readChapter(root, { work, chapter: 2, view: 'body' })).content.startsWith('正文4。'),
    JSON.stringify(await s.readChapter(root, { work, chapter: 2, view: 'body' })))
  const same = await s.moveChapter(root, work, 1, 1)
  check('same-number move is a no-op', same.changed === false && same.chapters.join(',') === '1,2,3', JSON.stringify(same))
  await s.moveChapter(root, work, 2, 3)
  check('moving down restores the original body order',
    (await s.readChapter(root, { work, chapter: 2, view: 'body' })).content.startsWith('正文3。')
    && (await s.readChapter(root, { work, chapter: 3, view: 'body' })).content.startsWith('正文4。'))

  let unconfirmed
  try {
    await s.deleteChapter(root, work, 1)
  } catch (error) {
    unconfirmed = error.code
  }
  check('delete requires confirmation', unconfirmed === 'chapter-delete-unconfirmed', String(unconfirmed))
  let nonAdjacent
  try {
    await s.moveChapter(root, work, 1, 3)
  } catch (error) {
    nonAdjacent = error.code
  }
  check('non-adjacent move is rejected', nonAdjacent === 'chapter-edit-target-invalid', String(nonAdjacent))

  const snapshot = openWork(root, work)
  const snapshotMeta = snapshot.prepare('SELECT updated_at FROM meta WHERE id = 1').get().updated_at
  const snapshotChapters = snapshot.prepare('SELECT number, title FROM chapters ORDER BY number').all()
  const snapshotDocs = snapshot.prepare('SELECT doc_id, chapter FROM search_docs ORDER BY doc_id').all()
  const snapshotEvents = snapshot.prepare('SELECT seq, chapter, kind FROM events ORDER BY seq').all()
  snapshot.close()
  let moveRolledBack
  try {
    await s.moveChapter(root, work, 1, 2, { beforeCommit: () => { throw new Error('move-injected') } })
  } catch (error) {
    moveRolledBack = error instanceof Error ? error.message : String(error)
  }
  const afterMoveFailure = openWork(root, work)
  try {
    check('failed move rolls back references and search docs', moveRolledBack === 'move-injected'
      && JSON.stringify(afterMoveFailure.prepare('SELECT number, title FROM chapters ORDER BY number').all()) === JSON.stringify(snapshotChapters)
      && JSON.stringify(afterMoveFailure.prepare('SELECT doc_id, chapter FROM search_docs ORDER BY doc_id').all()) === JSON.stringify(snapshotDocs)
      && JSON.stringify(afterMoveFailure.prepare('SELECT seq, chapter, kind FROM events ORDER BY seq').all()) === JSON.stringify(snapshotEvents))
  } finally {
    afterMoveFailure.close()
  }
  let rolledBack
  try {
    await s.deleteChapter(root, work, 1, { confirm: true, beforeCommit: () => { throw new Error('injected') } })
  } catch (error) {
    rolledBack = error instanceof Error ? error.message : String(error)
  }
  const after = openWork(root, work)
  try {
    check('failed edit rolls back', rolledBack === 'injected'
      && JSON.stringify(after.prepare('SELECT number, title FROM chapters ORDER BY number').all()) === JSON.stringify(snapshotChapters)
      && after.prepare('SELECT updated_at FROM meta WHERE id = 1').get().updated_at === snapshotMeta)
  } finally {
    after.close()
  }

  const holes = (await s.initWork(root, { title: '空洞章节' })).workId
  for (const number of [1, 3]) {
    await s.writePlan(root, { work: holes, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work: holes, chapter: number })
    await s.writeChapter(root, { work: holes, chapter: number, body: `空洞${number}。` })
  }
  const holesDb = openWork(root, holes)
  try {
    holesDb.exec('DELETE FROM artifacts')
  } finally {
    holesDb.close()
  }
  const holeDelete = await s.deleteChapter(root, holes, 3, { confirm: true })
  check('holey chapters renumber by rank', holeDelete.chapters.join(',') === '1', JSON.stringify(holeDelete))
  const zero = await s.deleteChapter(root, holes, 1, { confirm: true })
  check('deleting the last chapter leaves an empty work', zero.changed === true && zero.chapters.length === 0)
  const exported = s.exportWork(root, holes)
  check('empty edited work still exports title-only book', exported.files > 0)} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
