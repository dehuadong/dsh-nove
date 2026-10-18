// Work operations: rename, delete to trash, restore, list filtering.
import { mkdir, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { openStage } from '../stage.js'

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
  // The trash listing reports only well-formed entries.
  const trashed = await s.listTrash(root)
  check('trash lists the deleted work', trashed.some(item => item.workId === 'gamma'), JSON.stringify(trashed))
  check('trash carries the timestamp', trashed.every(item => Number.isInteger(item.trashedAt)), JSON.stringify(trashed))


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

  // A stage that never commits leaves the real tree untouched.
  const workDir = join(root, 'works', 'gamma')
  const crash = await openStage(workDir, 'crash')
  crash.put('chapters/ch-0099.md', '未提交的内容\n')
  await crash.materialize()
  check('staged file stays out of the work', await stat(join(workDir, 'chapters', 'ch-0099.md')).then(() => false).catch(() => true))
  await crash.commit()
  check('commit lands the staged file', (await readFile(join(workDir, 'chapters', 'ch-0099.md'), 'utf8')).includes('未提交'))

  const discarded = await openStage(workDir, 'discard')
  discarded.put('chapters/ch-0098.md', '丢弃\n')
  await discarded.materialize()
  await discarded.discard()
  check('discarded stage leaves nothing', await stat(join(workDir, 'chapters', 'ch-0098.md')).then(() => false).catch(() => true))

  // A failure between staging and commit leaves the real tree untouched.
  let injected = false
  await s.commitFiles(root, 'gamma', 'inject', { 'chapters/ch-0002.md': 'x\n' }, {
    beforeCommit: () => { injected = true; throw new Error('injected failure') },
  }).then(() => check('injected failure surfaces', false), error => check('injected failure surfaces', /injected failure/.test(error.message)))
  check('injection ran', injected)
  check('failed commit leaves the work untouched', await stat(join(workDir, 'chapters', 'ch-0002.md')).then(() => false).catch(() => true))

  // The staged set is validated before anything lands.
  await s.commitFiles(root, 'gamma', 'escape', { '../escape.md': 'x\n' })
    .then(() => check('escaping path rejected', false), error => check('escaping path rejected', error.code === 'invalid-path'))
  await s.commitFiles(root, 'gamma', 'empty', { 'chapters/ch-0003.md': null })
    .then(() => check('non-string artifact rejected', false), error => check('non-string artifact rejected', error.code === 'invalid-artifact'))

  // Restoring `a` must not pick up `a-b`'s trashed copy.
  const shadow = await s.initWork(root, { title: '影子' })
  await s.deleteWork(root, { work: 'gamma' })
  await s.deleteWork(root, { work: shadow.workId })
  await s.restoreWork(root, { name: 'gamma' })
  check('restore matches the exact name', (await s.status(root, 'gamma')).workId === 'gamma')

  // Reserved identities are refused.
  await s.initWork(root, { title: '保留名' })
  await rejects('reserved id refused', 'invalid-work-id', () => s.renameWork(root, { work: '保留名', workId: '.trash' }))

  // Bookkeeping directories never look like works.
  await mkdir(join(root, 'works', '.staging', 'write-1'), { recursive: true })
  const withStaging = await s.listWorks(root)
  check('staging directory ignored', withStaging.length === 3, String(withStaging.length))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
