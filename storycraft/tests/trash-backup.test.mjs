// Trash lifecycle and backup file creation.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { openCatalog } from '../db.js'

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
