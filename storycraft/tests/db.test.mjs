// SQLite store foundation: schema version, tables, cascade, transaction, backup.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SCHEMA_VERSION, backupTo, databasePath, integrityCheck, openStore, transaction, withStore,
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
  const db = openStore(root)
  check('schema version recorded', Number(db.prepare('PRAGMA user_version').get().user_version) === SCHEMA_VERSION)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name)
  const expected = ['bible', 'chapter_plans', 'chapter_versions', 'chapters', 'events', 'proposals', 'reviews',
    'search_docs', 'search_fts', 'session_current', 'summaries', 'volumes', 'works']
  check('all tables exist', expected.every(name => tables.includes(name)), tables.join(','))
  check('WAL mode', String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase() === 'wal')

  const now = new Date().toISOString()
  db.prepare('INSERT INTO works (work_id, title, form, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('测试书', '测试书', 'longform', now, now)
  db.prepare('INSERT INTO chapters (work_id, number, updated_at) VALUES (?, ?, ?)').run('测试书', 1, now)
  db.prepare('INSERT INTO chapter_versions (work_id, number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('测试书', 1, 1, '正文', 2, now)
  db.prepare('INSERT INTO events (work_id, seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run('测试书', 1, now, 1, 'hook', '{}')

  check('foreign key cascade is enabled', db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1)
  db.prepare('DELETE FROM works WHERE work_id = ?').run('测试书')
  check('deleting a work cascades to chapters', db.prepare('SELECT count(*) AS n FROM chapters').get().n === 0)
  check('deleting a work cascades to events', db.prepare('SELECT count(*) AS n FROM events').get().n === 0)

  // A failed transaction leaves nothing behind.
  try {
    transaction(db, () => {
      db.prepare('INSERT INTO works (work_id, title, form, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('回滚书', '回滚书', 'longform', now, now)
      throw new Error('boom')
    })
  } catch {
    // expected
  }
  check('failed transaction rolls back', db.prepare("SELECT count(*) AS n FROM works WHERE work_id = '回滚书'").get().n === 0)
  check('integrity check passes', integrityCheck(db) === 'ok', integrityCheck(db))

  const destination = join(root, '.storycraft', 'backups', 'test.db')
  await backupTo(db, destination)
  check('backup file written', (await stat(destination)).size > 0)
  const copy = openStore(root)
  check('backup is a readable database', copy.prepare('SELECT count(*) AS n FROM works').get().n === 0)
  copy.close()
  db.close()

  withStore(root, handle => {
    check('withStore closes the handle', handle.prepare('SELECT 1 AS one').get().one === 1)
  })
  check('database path is under .storycraft', databasePath(root).includes('.storycraft'))

  // A newer schema must be refused, not silently downgraded.
  const newer = openStore(root)
  newer.exec('PRAGMA user_version = 99')
  newer.close()
  try {
    openStore(root)
    check('newer schema refused', false, 'opened')
  } catch (error) {
    check('newer schema refused', error?.code === 'schema-version-mismatch', error?.code)
  }

  // A non-database file reports db-corrupt.
  const corruptRoot = await mkdtemp(join(tmpdir(), 'storycraft-corrupt-'))
  try {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(corruptRoot, '.storycraft'), { recursive: true })
    await writeFile(join(corruptRoot, '.storycraft', 'works.db'), 'not a database')
    try {
      openStore(corruptRoot)
      check('corrupt file refused', false, 'opened')
    } catch (error) {
      check('corrupt file refused', error?.code === 'db-corrupt', error?.code)
    }
  } finally {
    await rm(corruptRoot, { recursive: true, force: true }).catch(() => {})
  }
} finally {
  // Windows may keep WAL files briefly; a leftover temp dir is harmless here.
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
