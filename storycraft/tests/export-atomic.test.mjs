// Panel export: staging, backup swap, rollback, cleanup and serialization.
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { exportsDir, openWork } from '../dist/db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

async function countFiles(dir) {
  let count = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(join(dir, entry.name)) : 1
  }
  return count
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-atomic-'))
const token = work => createHash('sha256').update(String(work)).digest('hex').slice(0, 12)
try {
  const work = (await s.initWork(root, { title: '原子导出' })).workId
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '一', body: '正文。'.repeat(30) })
  const target = join(exportsDir(root), work)

  const first = await s.exportWorkAtomic(root, work)
  check('atomic export writes the target', first.directory === target && first.files > 0, JSON.stringify(first))
  const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'))
  check('atomic export writes manifest v6, book and epub', manifest.schemaVersion === 6
    && manifest.book?.file === 'book.txt' && manifest.epub?.file === 'book.epub'
    && first.files === await countFiles(target), JSON.stringify(manifest.epub))
  check('atomic export writes book.txt and book.epub',
    (await readFile(join(target, 'book.txt'), 'utf8')).startsWith('原子导出\n\n第 1 章 一')
    && (await readFile(join(target, 'book.epub'))).subarray(0, 2).toString() === 'PK')
  const firstBody = await readFile(join(target, 'chapters', 'ch-0001.md'), 'utf8')
  check('atomic export leaves no staging or backup',
    (await readdir(exportsDir(root))).filter(name => name.startsWith('.tmp-') || name.startsWith('.bak-')).length === 0)

  const second = await s.exportWorkAtomic(root, work)
  const secondBody = await readFile(join(target, 'chapters', 'ch-0001.md'), 'utf8')
  check('repeat export replaces the same target', second.directory === target && secondBody === firstBody)

  let calls = 0
  let blocked
  try {
    await s.exportWorkAtomic(root, work, {
      rename: (from, to) => {
        calls += 1
        if (calls === 1) throw new Error('target busy')
        renameSync(from, to)
      },
    })
  } catch (error) {
    blocked = error.code
  }
  const afterBlocked = await readFile(join(target, 'manifest.json'), 'utf8')
  check('a failed old-target backup leaves the old export',
    blocked === 'export-failed' && afterBlocked === JSON.stringify(manifest, null, 2) + '\n', String(blocked))

  calls = 0
  let swapFailed
  try {
    await s.exportWorkAtomic(root, work, {
      rename: (from, to) => {
        calls += 1
        if (calls === 2) throw new Error('swap busy')
        renameSync(from, to)
      },
    })
  } catch (error) {
    swapFailed = error.code
  }
  const afterSwap = await readFile(join(target, 'manifest.json'), 'utf8')
  check('a failed swap restores the old export', swapFailed === 'export-failed'
    && afterSwap === JSON.stringify(manifest, null, 2) + '\n', String(swapFailed))

  const broken = (await s.initWork(root, { title: '缺正文版本' })).workId
  s.writePlan(root, { work: broken, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: broken, chapter: 1 })
  s.writeChapter(root, { work: broken, chapter: 1, body: '正文。' })
  const brokenDb = openWork(root, broken)
  brokenDb.prepare('DELETE FROM chapter_versions WHERE number = 1').run()
  brokenDb.close()
  let missingVersion
  try {
    await s.exportWorkAtomic(root, broken)
  } catch (error) {
    missingVersion = error.code
  }
  check('missing current version fails as export-failed', missingVersion === 'export-failed', String(missingVersion))

  const fresh = (await s.initWork(root, { title: '首次失败' })).workId
  let freshFailed
  try {
    await s.exportWorkAtomic(root, fresh, {
      rename: () => { throw new Error('no swap') },
    })
  } catch (error) {
    freshFailed = error.code
  }
  check('a first-export swap failure is export-failed', freshFailed === 'export-failed', String(freshFailed))
  check('a first-export failure leaves no target', !(await readdir(exportsDir(root))).includes(fresh))

  let treeFailed
  try {
    await s.exportWorkAtomic(root, work, { exportTree: () => { throw new Error('write failed') } })
  } catch (error) {
    treeFailed = error.code
  }
  const afterTree = await readFile(join(target, 'manifest.json'), 'utf8')
  check('a write failure keeps the old export', treeFailed === 'export-failed'
    && afterTree === JSON.stringify(manifest, null, 2) + '\n', String(treeFailed))
  check('a write failure cleans its staging directory',
    (await readdir(exportsDir(root))).filter(name => name.startsWith('.tmp-')).length === 0)

  const withRemoveFailure = await s.exportWorkAtomic(root, work, {
    remove: () => { throw new Error('backup busy') },
  })
  check('backup cleanup failure still reports success', withRemoveFailure.directory === target,
    JSON.stringify(withRemoveFailure))
  check('backup cleanup failure leaves the backup for diagnostics',
    (await readdir(exportsDir(root))).some(name => name.startsWith('.bak-')))
  await rm(join(exportsDir(root)), { recursive: true, force: true })

  const concurrent = await Promise.all([s.exportWorkAtomic(root, work), s.exportWorkAtomic(root, work)])
  check('concurrent exports serialize', concurrent.every(item => item.directory === target)
    && (await readdir(exportsDir(root))).filter(name => name.startsWith('.tmp-') || name.startsWith('.bak-')).length === 0,
  JSON.stringify(concurrent))

  const recoveredWork = (await s.initWork(root, { title: '恢复' })).workId
  s.writeOutline(root, { work: recoveredWork, mainline: '线' })
  s.approveOutline(root, { work: recoveredWork })
  s.writePlan(root, { work: recoveredWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: recoveredWork, chapter: 1 })
  await s.exportWorkAtomic(root, recoveredWork)
  s.writeChapter(root, { work: recoveredWork, chapter: 1, body: '恢复正文。'.repeat(20) })
  const recoveredTarget = join(exportsDir(root), recoveredWork)
  const oldManifest = await readFile(join(recoveredTarget, 'manifest.json'), 'utf8')
  renameSync(recoveredTarget, join(exportsDir(root), `.bak-${token(recoveredWork)}-crash`))
  let recoveryFailure
  try {
    await s.exportWorkAtomic(root, recoveredWork, { exportTree: () => { throw new Error('write failed') } })
  } catch (error) {
    recoveryFailure = error.code
  }
  const recoveredManifest = await readFile(join(recoveredTarget, 'manifest.json'), 'utf8')
  check('a missing target is recovered from its backup',
    recoveryFailure === 'export-failed' && recoveredManifest === oldManifest, JSON.stringify({ recoveryFailure }))

  let rollbackCalls = 0
  let rollbackFailed
  try {
    await s.exportWorkAtomic(root, recoveredWork, {
      rename: (from, to) => {
        rollbackCalls += 1
        if (rollbackCalls >= 2) throw new Error('swap and restore busy')
        renameSync(from, to)
      },
    })
  } catch (error) {
    rollbackFailed = error.code
  }
  check('a failed restore reports export-rollback-failed', rollbackFailed === 'export-rollback-failed', String(rollbackFailed))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
