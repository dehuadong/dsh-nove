// Work operations: rename, delete to trash, restore, list filtering.
import { mkdir, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'

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

const root = await mkdtemp(join(tmpdir(), 'storycraft-ops-'))
try {
  const created = await s.initWork(root, { title: '甲作品' })
  const work = created.workId
  const plan = { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' }
  await s.writePlan(root, plan)
  await s.writeChapter(root, { work, chapter: 1, body: '正文。'.repeat(40) })

  // Rename the title only: the directory stays.
  const titled = await s.renameWork(root, { work, title: '乙作品' })
  check('title renamed', titled.title === '乙作品' && titled.workId === work, JSON.stringify(titled))
  check('directory kept on title rename', (await stat(join(root, 'works', work, 'manifest.json'))).isFile())

  // Rename the identity: directory and manifest follow.
  const renamed = await s.renameWork(root, { work, workId: 'gamma' })
  check('id renamed', renamed.workId === 'gamma', JSON.stringify(renamed))
  check('old directory gone', await stat(join(root, 'works', work)).then(() => false).catch(() => true))
  check('new directory exists', (await stat(join(root, 'works', 'gamma', 'manifest.json'))).isFile())
  const renamedManifest = JSON.parse(await readFile(join(root, 'works', 'gamma', 'manifest.json'), 'utf8'))
  check('manifest workId follows', renamedManifest.workId === 'gamma', renamedManifest.workId)
  const bodyAfter = await s.readChapter(root, { work: 'gamma', chapter: 1 })
  check('content readable after rename', bodyAfter.content.includes('正文'))
  await rejects('old id no longer resolves', 'work-not-found', () => s.status(root, work))

  // A second work may not take an existing identity.
  await s.initWork(root, { title: '丙作品' })
  await rejects('rename onto an existing id refused', 'work-exists', () => s.renameWork(root, { work: 'gamma', workId: '丙作品' }))

  // Delete moves to trash and out of the list.
  const before = await s.listWorks(root)
  check('list has two works before delete', before.length === 2, String(before.length))
  const deleted = await s.deleteWork(root, { work: 'gamma' })
  check('delete moved into trash', deleted.path.includes('.trash'), deleted.path)
  const afterDelete = await s.listWorks(root)
  check('deleted work leaves the list', !afterDelete.some(item => item.workId === 'gamma'), JSON.stringify(afterDelete.map(item => item.workId)))

  // Restore brings it back with its manifest identity fixed.
  const restored = await s.restoreWork(root, { name: 'gamma' })
  check('restore returns the work', restored.workId === 'gamma', JSON.stringify(restored))
  const restoredManifest = JSON.parse(await readFile(join(root, 'works', 'gamma', 'manifest.json'), 'utf8'))
  check('restored manifest workId matches', restoredManifest.workId === 'gamma', restoredManifest.workId)
  const restoredBody = await s.readChapter(root, { work: 'gamma', chapter: 1 })
  check('restored content intact', restoredBody.content.includes('正文'))
  const afterRestore = await s.listWorks(root)
  check('restored work is back in the list', afterRestore.some(item => item.workId === 'gamma'))

  // The projection is derived: it exists after a write, rebuilds when deleted,
  // and never disagrees with the manifest's stamp.
  const projectionFile = join(root, 'works', 'gamma', 'state', 'projection.json')
  const first = await s.readProjection(root, 'gamma')
  check('projection written after a write', (await stat(projectionFile)).isFile())
  check('projection counts the chapter', first.writtenChapters === 1 && first.openProblems === 0, JSON.stringify(first))
  await unlink(projectionFile)
  const rebuilt = await s.readProjection(root, 'gamma')
  check('deleted projection rebuilds', rebuilt.manifestUpdatedAt === first.manifestUpdatedAt, JSON.stringify(rebuilt.manifestUpdatedAt))
  check('rebuild keeps the same counts', rebuilt.writtenChapters === first.writtenChapters && rebuilt.openProblems === first.openProblems)

  // Bookkeeping directories never look like works.
  await mkdir(join(root, 'works', '.staging', 'write-1'), { recursive: true })
  const withStaging = await s.listWorks(root)
  check('staging directory ignored', withStaging.length === 2, String(withStaging.length))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
