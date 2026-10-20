// SQLite foundation: catalog vs work schemas, version checks, transaction, backup.
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CATALOG_SCHEMA_VERSION, WORK_SCHEMA_VERSION, backupTo, catalogFile, createWorkDatabase, integrityCheck,
  openCatalog, openDatabase, openWork, sqliteAvailable, transaction, workFile,
} from '../db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-db-'))
try {
  check('node:sqlite is available', sqliteAvailable() === true)
  check('an absent catalog reads as missing', openCatalog(root, { create: false }) === undefined)

  const catalog = openCatalog(root)
  check('catalog schema version recorded', Number(catalog.prepare('PRAGMA user_version').get().user_version) === CATALOG_SCHEMA_VERSION)
  const tables = catalog.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name)
  check('catalog holds only metadata tables', tables.join(',') === 'proposals,session_current,works', tables.join(','))
  check('catalog WAL mode', String(catalog.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase() === 'wal')

  const now = new Date().toISOString()
  transaction(catalog, () => {
    catalog.prepare(`INSERT INTO works (work_id, title, form, schema_version, created_at, updated_at)
      VALUES ('测试书', '测试书', 'longform', ?, ?, ?)`).run(WORK_SCHEMA_VERSION, now, now)
  })
  check('catalog row written', catalog.prepare('SELECT count(*) AS n FROM works').get().n === 1)
  catalog.close()

  // A work database only exists after creation; opening one never creates it.
  check('openWork refuses an unknown id', (() => {
    try {
      openWork(root, '不存在')
      return false
    } catch (error) {
      return error?.code === 'work-not-found'
    }
  })())
  check('openWork did not create a file', await stat(workFile(root, '不存在')).then(() => false).catch(() => true))

  createWorkDatabase(root, '测试书', {
    workId: '测试书', title: '测试书', form: 'longform', tags: null, createdAt: now, updatedAt: now,
  })
  const db = openWork(root, '测试书')
  const workTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name)
  const expected = ['bible', 'chapter_plans', 'chapter_versions', 'chapters', 'events', 'meta', 'reviews',
    'search_docs', 'search_fts', 'summaries', 'volumes']
  check('all work tables exist', expected.every(name => workTables.includes(name)), workTables.join(','))
  check('work schema version recorded', Number(db.prepare('PRAGMA user_version').get().user_version) === WORK_SCHEMA_VERSION)
  check('work database has no work id column', db.prepare("SELECT count(*) AS n FROM pragma_table_info('chapters') WHERE name = 'work_id'").get().n === 0)

  db.prepare('INSERT INTO chapters (number, updated_at) VALUES (?, ?)').run(1, now)
  db.prepare('INSERT INTO chapter_versions (number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(1, 1, '正文', 2, now)
  db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
    .run(1, now, 1, 'hook', '{}')
  check('foreign keys are enabled', db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1)
  db.prepare('DELETE FROM chapters WHERE number = 1').run()
  check('deleting a chapter cascades to versions', db.prepare('SELECT count(*) AS n FROM chapter_versions').get().n === 0)

  // A failed transaction leaves nothing behind.
  try {
    transaction(db, () => {
      db.prepare('INSERT INTO chapters (number, updated_at) VALUES (?, ?)').run(9, now)
      throw new Error('boom')
    })
  } catch {
    // expected
  }
  check('failed transaction rolls back', db.prepare('SELECT count(*) AS n FROM chapters WHERE number = 9').get().n === 0)
  check('integrity check passes', integrityCheck(db) === 'ok', integrityCheck(db))

  const destination = join(root, '.storycraft', 'backups', 'test.db')
  await backupTo(db, destination)
  check('backup file written', (await stat(destination)).size > 0)
  const copy = openDatabase(destination)
  check('backup is a readable work database', Number(copy.prepare('PRAGMA user_version').get().user_version) === WORK_SCHEMA_VERSION)
  check('backup carries the meta row', copy.prepare('SELECT count(*) AS n FROM meta').get().n === 1)
  copy.close()
  db.close()

  // A second writer must see work-busy, not a masked rollback.
  const holder = openWork(root, '测试书')
  const contender = openWork(root, '测试书')
  holder.exec('BEGIN IMMEDIATE')
  contender.exec('PRAGMA busy_timeout = 50')
  try {
    transaction(contender, () => contender.prepare('INSERT INTO chapters (number, updated_at) VALUES (?, ?)')
      .run(7, new Date().toISOString()))
    check('second writer gets work-busy', false, 'wrote')
  } catch (error) {
    check('second writer gets work-busy', error?.code === 'work-busy', error?.code)
  } finally {
    holder.exec('ROLLBACK')
    holder.close()
    contender.close()
  }

  // A newer schema must be refused, not silently downgraded.
  const newer = openWork(root, '测试书')
  newer.exec('PRAGMA user_version = 99')
  newer.close()
  try {
    openWork(root, '测试书')
    check('newer work schema refused', false, 'opened')
  } catch (error) {
    check('newer work schema refused', error?.code === 'schema-version-mismatch', error?.code)
  }
  const reset = openDatabase(workFile(root, '测试书'))
  reset.exec(`PRAGMA user_version = ${WORK_SCHEMA_VERSION}`)
  reset.close()

  // A non-database file reports db-corrupt.
  const corruptRoot = await mkdtemp(join(tmpdir(), 'storycraft-corrupt-'))
  try {
    await mkdir(join(corruptRoot, '.storycraft', 'works'), { recursive: true })
    await writeFile(workFile(corruptRoot, '坏的'), 'not a database')
    try {
      openWork(corruptRoot, '坏的')
      check('corrupt work file refused', false, 'opened')
    } catch (error) {
      check('corrupt work file refused', error?.code === 'db-corrupt', error?.code)
    }
    await mkdir(join(corruptRoot, '.storycraft'), { recursive: true })
    await writeFile(catalogFile(corruptRoot), 'not a database')
    try {
      openCatalog(corruptRoot)
      check('corrupt catalog refused', false, 'opened')
    } catch (error) {
      check('corrupt catalog refused', error?.code === 'db-corrupt', error?.code)
    }
  } finally {
    await rm(corruptRoot, { recursive: true, force: true }).catch(() => {})
  }

  // A newer catalog version is refused too.
  const newerCatalogRoot = await mkdtemp(join(tmpdir(), 'storycraft-cat-'))
  try {
    const fresh = openCatalog(newerCatalogRoot)
    fresh.exec('PRAGMA user_version = 99')
    fresh.close()
    try {
      openCatalog(newerCatalogRoot)
      check('newer catalog refused', false, 'opened')
    } catch (error) {
      check('newer catalog refused', error?.code === 'schema-version-mismatch', error?.code)
    }
  } finally {
    await rm(newerCatalogRoot, { recursive: true, force: true }).catch(() => {})
  }
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

