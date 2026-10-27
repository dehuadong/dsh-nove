// Catalog invariants: metadata only, per-work schema versions, reconciliation, rollback.
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORK_SCHEMA_VERSION, openCatalog, openWork, trashDir, trashFile, workFile } from '../src/db.ts'
import * as store from '../src/store-db.ts'

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

const root = await mkdtemp(join(tmpdir(), 'storycraft-catalog-'))
try {
  const a = store.initWork(root, { title: '甲库', tags: ['实验'] })
  const b = store.initWork(root, { title: '乙库' })

  // The catalog is metadata only; each work carries its own schema version.
  const catalog = openCatalog(root, { create: false })
  const tables = catalog.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name).sort()
  check('catalog tables are metadata only', tables.join(',') === 'proposals,session_current,works', tables.join(','))
  const row = catalog.prepare('SELECT * FROM works WHERE work_id = ?').get(a.workId)
  check('catalog records the work schema version', row.schema_version === WORK_SCHEMA_VERSION, String(row.schema_version))
  check('catalog keeps title/form/tags', row.title === '甲库' && row.form === 'longform' && row.tags === '["实验"]', JSON.stringify(row))
  catalog.close()
  check('work content lives in its own file', await exists(workFile(root, a.workId)))
  const versionDb = openWork(root, a.workId)
  const version = Number(versionDb.prepare('PRAGMA user_version').get().user_version)
  versionDb.close()
  check('each work records its own user_version', version === WORK_SCHEMA_VERSION)

  // A locked catalog leaves reconciliation retryable instead of caching failure.
  const retry = store.initWork(root, { title: '重试' }).workId
  await rm(workFile(root, retry), { force: true })
  const lock = openCatalog(root)
  lock.exec('BEGIN IMMEDIATE')
  store.ensureReconciled(root)
  lock.exec('ROLLBACK')
  lock.close()
  const beforeRetry = openCatalog(root, { create: false })
  check('a locked reconcile does not stamp missing', beforeRetry.prepare('SELECT missing_at FROM works WHERE work_id = ?').get(retry).missing_at === null)
  beforeRetry.close()
  store.ensureReconciled(root)
  const afterRetry = openCatalog(root, { create: false })
  check('the next read reconciles the retried root', afterRetry.prepare('SELECT missing_at FROM works WHERE work_id = ?').get(retry).missing_at !== null)
  afterRetry.close()

  // Reconciliation diagnostics: row without file, file without row, trash file.
  await rm(workFile(root, b.workId), { force: true })
  const report = store.reconcileWorks(root)
  check('missing work reported', report.missing.includes(b.workId), JSON.stringify(report))
  check('missing work skipped by the list', !store.listWorks(root).some(item => item.workId === b.workId))
  await copyFile(workFile(root, a.workId), workFile(root, '孤儿'))
  await mkdir(trashDir(root), { recursive: true })
  await writeFile(trashFile(root, '孤儿'), '')
  const orphanReport = store.reconcileWorks(root)
  check('orphan work file reported', orphanReport.orphans.includes('孤儿.db'), JSON.stringify(orphanReport))
  check('orphan trash file reported', orphanReport.trash.includes('孤儿.db'), JSON.stringify(orphanReport))
  await rm(workFile(root, '孤儿'), { force: true })
  await rm(trashFile(root, '孤儿'), { force: true })

  // A catalog write failure after the file move rolls the move and the meta back.
  const beforeFile = workFile(root, a.workId)
  const holder = openCatalog(root)
  holder.exec('BEGIN IMMEDIATE')
  try {
    await rejects('rename under a catalog lock reports work-busy', 'work-busy',
      () => store.renameWork(root, { work: a.workId, workId: '改不成' }))
  } finally {
    holder.exec('ROLLBACK')
    holder.close()
  }
  check('rollback keeps the old file', await exists(beforeFile))
  check('rollback removes the new file', (await exists(workFile(root, '改不成'))) === false)
  const afterRollback = openCatalog(root, { create: false })
  check('rollback keeps the old catalog row', afterRollback.prepare('SELECT work_id FROM works WHERE work_id = ?').get(a.workId)?.work_id === a.workId)
  afterRollback.close()
  const meta = openWork(root, a.workId)
  check('rollback restores the meta id', meta.prepare('SELECT work_id FROM meta WHERE id = 1').get().work_id === a.workId)
  meta.close()

  // The host reconciles its known workspaces at startup.
  const startupRoot = await mkdtemp(join(tmpdir(), 'storycraft-startup-'))
  try {
    const startupWork = store.initWork(startupRoot, { title: '启动对账' }).workId
    await rm(workFile(startupRoot, startupWork), { force: true })
    const { apply } = await import('../src/index.ts')
    apply({
      get: name => (name === 'workspaceRegistry' ? { list: () => [{ path: startupRoot }] } : undefined),
      webServer: { register: () => () => {} },
      effect: fn => { const dispose = fn(); return () => dispose?.() },
    })
    const startupCatalog = openCatalog(startupRoot, { create: false })
    check('the host startup reconciles known workspaces',
      startupCatalog.prepare('SELECT missing_at FROM works WHERE work_id = ?').get(startupWork).missing_at !== null)
    startupCatalog.close()
  } finally {
    await rm(startupRoot, { recursive: true, force: true }).catch(() => {})
  }
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1


