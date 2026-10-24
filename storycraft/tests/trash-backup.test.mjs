// Trash lifecycle and backup file creation.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../dist/storage.js'
import { openCatalog, openDatabase, openWork, workFile } from '../dist/db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-trash-'))
try {
  const work = (await s.initWork(root, { title: '回收站测试' })).workId
  await s.deleteWork(root, { work })
  check('delete moves the work to trash', (await s.listTrash(root)).some(item => item.workId === work))
  await s.restoreWork(root, { name: work })
  check('restore returns it to works', (await s.listWorks(root)).some(item => item.workId === work)
    && (await s.listTrash(root)).length === 0)
  const backup = await s.backupWork(root, work)
  check('backup writes a readable copy', backup.integrity === 'ok')
  await s.deleteWork(root, { work })
  await s.purgeTrash(root, { work })
  check('purge clears trash and catalog', (await s.listTrash(root)).length === 0
    && !(await s.listWorks(root)).some(item => item.workId === work))

  const retention = (await s.initWork(root, { title: '备份保留' })).workId
  for (let index = 0; index < 12; index += 1) await s.createBackup(root, retention, 10)
  check('retention keeps the newest 10', (await s.listBackups(root, retention)).length === 10)
  const oldest = (await s.listBackups(root, retention)).at(-1)
  await s.deleteBackup(root, retention, oldest.backupId)
  check('one backup can be deleted', (await s.listBackups(root, retention)).length === 9)

  const restore = (await s.initWork(root, { title: '备份恢复' })).workId
  s.writeBible(root, { work: restore, name: 'world', content: '# 旧世界\n' })
  await s.createBackup(root, restore, 10)
  s.writeBible(root, { work: restore, name: 'world', content: '# 新世界\n' })
  const saved = (await s.listBackups(root, restore))[0]
  await s.restoreBackup(root, restore, saved.backupId)
  const restored = openWork(root, restore)
  try {
    check('restore brings back the backup content', restored.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:world' ORDER BY rowid DESC LIMIT 1").get().content === '# 旧世界\n')
  } finally {
    restored.close()
  }

  const legacy = (await s.initWork(root, { title: '旧库备份' })).workId
  s.writeBible(root, { work: legacy, name: 'world', content: '# 当前世界\n' })
  await s.createBackup(root, legacy, 10)
  const legacySaved = (await s.listBackups(root, legacy))[0]
  const legacyDb = openDatabase(legacySaved.file)
  legacyDb.exec('PRAGMA user_version = 5')
  legacyDb.close()
  let legacyError
  try {
    await s.restoreBackup(root, legacy, legacySaved.backupId)
  } catch (error) {
    legacyError = error
  }
  check('non-v6 backup is refused before swap', legacyError?.code === 'backup-invalid', String(legacyError?.code))
  const legacyCurrent = openWork(root, legacy)
  try {
    check('refused backup leaves the current work intact',
      legacyCurrent.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:world' ORDER BY rowid DESC LIMIT 1").get().content === '# 当前世界\n')
  } finally {
    legacyCurrent.close()
  }

  const corrupt = (await s.initWork(root, { title: '损坏恢复' })).workId
  s.writeBible(root, { work: corrupt, name: 'world', content: '# 损坏前\n' })
  const corruptBackup = (await s.createBackup(root, corrupt, 10)).file
  const corruptId = `backup:${corrupt}:${corruptBackup.split('-').at(-1).replace(/\.db$/u, '')}`
  await writeFile(workFile(root, corrupt), 'not sqlite')
  await s.restoreBackup(root, corrupt, corruptId)
  const recovered = openWork(root, corrupt)
  try {
    check('corrupt current can be restored', recovered.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:world' ORDER BY rowid DESC LIMIT 1").get().content === '# 损坏前\n')
  } finally {
    recovered.close()
  }

  const hyphen = (await s.initWork(root, { title: 'a1-2' })).workId
  const plain = (await s.initWork(root, { title: 'a1' })).workId
  await s.createBackup(root, hyphen, 10)
  await s.createBackup(root, plain, 10)
  check('works with prefix names do not share backups',
    (await s.listBackups(root, plain)).length === 1 && (await s.listBackups(root, hyphen)).length === 1)
  const catalog = openCatalog(root, { create: false })
  try {
    check('purged catalog row is gone', catalog.prepare('SELECT count(*) AS n FROM works WHERE work_id = ?').get(work).n === 0)
  } finally {
    catalog.close()
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
