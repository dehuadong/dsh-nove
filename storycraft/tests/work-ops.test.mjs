// Work lifecycle: rename, trash, restore and reconciliation against the files.
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { trashDir, trashFile, workFile } from '../dist/db.js'
import * as s from '../dist/storage.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function rejects(name, code, fn) {
  try {
    await fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}
const exists = path => stat(path).then(() => true).catch(() => false)

const root = await mkdtemp(join(tmpdir(), 'storycraft-ops-'))
try {
  const created = await s.initWork(root, { title: '甲作品' })
  const work = created.workId
  const plan = { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' }
  await s.writePlan(root, plan)
  await s.approveChapterPlan(root, { work, chapter: 1 })
  await s.writeChapter(root, { work, chapter: 1, body: '正文。'.repeat(40) })

  // Rename the title only: the identity and file stay.
  const titled = await s.renameWork(root, { work, title: '乙作品' })
  check('title renamed', titled.title === '乙作品' && titled.workId === work, JSON.stringify(titled))
  check('work file kept on title rename', await exists(workFile(root, work)))
  check('content readable after title rename', (await s.readChapter(root, { work, chapter: 1 })).content.includes('正文'))

  // Rename the identity: the database file and meta follow.
  const renamed = await s.renameWork(root, { work, workId: 'gamma' })
  check('id renamed', renamed.workId === 'gamma', JSON.stringify(renamed))
  check('old work file gone', (await exists(workFile(root, work))) === false)
  check('new work file exists', await exists(workFile(root, 'gamma')))
  check('content readable after rename', (await s.readChapter(root, { work: 'gamma', chapter: 1 })).content.includes('正文'))
  await rejects('old id no longer resolves', 'work-not-found', () => s.status(root, work))

  // A second work may not take an existing identity.
  await s.initWork(root, { title: '丙作品' })
  await rejects('rename onto an existing id refused', 'work-exists', () => s.renameWork(root, { work: 'gamma', workId: '丙作品' }))

  // Delete moves the file to trash and out of the list.
  const before = await s.listWorks(root)
  check('list has two works before delete', before.length === 2, String(before.length))
  const deleted = await s.deleteWork(root, { work: 'gamma' })
  check('delete moved into trash', deleted.path === '.storycraft/trash/gamma.db', deleted.path)
  check('trashed database file exists', await exists(trashFile(root, 'gamma')))
  const afterDelete = await s.listWorks(root)
  check('deleted work leaves the list', !afterDelete.some(item => item.workId === 'gamma'), JSON.stringify(afterDelete.map(item => item.workId)))
  const trashed = await s.listTrash(root)
  check('trash lists the deleted work', trashed.some(item => item.workId === 'gamma'), JSON.stringify(trashed))
  check('trash entries are virtual paths', trashed.every(item => item.path.startsWith('.storycraft/trash/')), JSON.stringify(trashed))

  // Restore brings it back.
  const restored = await s.restoreWork(root, { name: 'gamma' })
  check('restore returns the work', restored.workId === 'gamma', JSON.stringify(restored))
  const restoredBody = await s.readChapter(root, { work: 'gamma', chapter: 1 })
  check('restored content intact', restoredBody.content.includes('正文'))
  const afterRestore = await s.listWorks(root)
  check('restored work is back in the list', afterRestore.some(item => item.workId === 'gamma'))

  // A chapter without a summary says so; the page uses this to gate 定稿.
  const beforeSummary = (await s.readWork(root, 'gamma')).chapters[0]
  check('chapters report whether they have a summary', beforeSummary.hasSummary === false, String(beforeSummary.hasSummary))

  // Restoring `gamma` must not pick up another work's trashed copy.
  const shadow = await s.initWork(root, { title: '影子' })
  await s.deleteWork(root, { work: 'gamma' })
  await s.deleteWork(root, { work: shadow.workId })
  await s.restoreWork(root, { name: 'gamma' })
  check('restore matches the exact name', (await s.status(root, 'gamma')).workId === 'gamma')
  check('the other work stays in the trash', (await s.listTrash(root)).some(item => item.workId === shadow.workId))

  // Reserved identities are refused.
  await s.initWork(root, { title: '保留名' })
  await rejects('reserved id refused', 'invalid-work-id', () => s.renameWork(root, { work: '保留名', workId: '.trash' }))

  // Startup reconciliation: a missing database is skipped until it comes back.
  const disappearing = (await s.initWork(root, { title: '会消失' })).workId
  await rm(workFile(root, disappearing), { force: true })
  const report = s.reconcileWorks(root)
  check('reconciliation reports the missing work', report.missing.includes(disappearing), JSON.stringify(report))
  check('missing work leaves the list', !(await s.listWorks(root)).some(item => item.workId === disappearing))
  await copyFile(workFile(root, 'gamma'), workFile(root, disappearing))
  s.reconcileWorks(root)
  check('recovered work returns to the list', (await s.listWorks(root)).some(item => item.workId === disappearing))

  // Deleting onto a pre-existing orphan trash file preserves it instead of
  // erasing the only copy.
  const collision = (await s.initWork(root, { title: '碰撞' })).workId
  await mkdir(trashDir(root), { recursive: true })
  await writeFile(trashFile(root, collision), 'orphan')
  await s.deleteWork(root, { work: collision })
  const aside = (await readdir(trashDir(root))).filter(name => name.startsWith(`${collision}-`))
  check('delete preserves the displaced trash file', aside.length === 1, aside.join(','))
  check('the preserved file keeps its content', (await readFile(join(trashDir(root), aside[0]), 'utf8')) === 'orphan')
  check('the new work file is in the trash', (await stat(trashFile(root, collision))).size > 0)

  // Initializing an id that is sitting in the trash is refused, not shadowed.
  await s.deleteWork(root, { work: 'gamma' })
  await rejects('initializing a trashed id is refused', 'work-exists', () => s.initWork(root, { title: 'gamma' }))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

