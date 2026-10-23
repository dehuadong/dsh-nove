/**
 * SQLite layout: one small `catalog.db` for the workspace, one database per work.
 *
 * The catalog is metadata only (title, form, tags, schema version, lifecycle
 * stamps); a work's content lives in `.storycraft/works/<workId>.db`. Work
 * identity is carried by the file, so no query can cross works. Connections are
 * opened per operation (`node:sqlite` is synchronous), writes run in
 * `BEGIN IMMEDIATE`, and `openWork` never creates a database: only `initWork`
 * does.
 */

import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { StoryError, isWorkId } from './domain.js'

let DatabaseSync
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch {
  // Missing node:sqlite is a supported deployment state: every action reports
  // `sqlite-unavailable` instead of the plugin failing to load.
  DatabaseSync = undefined
}

/** Directory (inside the workspace) that holds the catalog, works, trash. */
export const STORE_DIR = '.storycraft'

/** Schema version of the workspace catalog. */
export const CATALOG_SCHEMA_VERSION = 1

/** Schema version of one work database. */
export const WORK_SCHEMA_VERSION = 6

/** Final material table with purpose, used by new databases. */
const MATERIALS_SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  origin TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  content TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'reference' CHECK (purpose IN ('setting','character','scene','style','reference'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_hash ON materials(hash);
`

/** Catalog schema. Metadata only: no chapter content is ever stored here. */
const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS works (
  work_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  form TEXT NOT NULL,
  tags TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT,
  missing_at TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  form TEXT NOT NULL,
  premise TEXT NOT NULL,
  characters TEXT,
  conflict TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_work_id TEXT
);

CREATE TABLE IF NOT EXISTS session_current (
  session_id TEXT PRIMARY KEY,
  work_id TEXT,
  updated_at TEXT NOT NULL
);
`

/** v6 artifact registry: canonical artifacts with immutable revisions. */
const ARTIFACT_SCHEMA = `
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope_chapter INTEGER,
  content_type TEXT NOT NULL CHECK (content_type IN ('json', 'text')),
  content TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('generated', 'imported', 'edited')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, revision_id)
);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
`

/** One work's schema. `meta` is the single row holding the export copy. */
const WORK_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  work_id TEXT NOT NULL,
  title TEXT NOT NULL,
  form TEXT NOT NULL,
  tags TEXT,
  plan_approval TEXT NOT NULL DEFAULT 'required',
  word_min INTEGER,
  word_max INTEGER,
  outline_written_at TEXT,
  outline_approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  number INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  stage TEXT NOT NULL DEFAULT 'planned',
  current_revision INTEGER NOT NULL DEFAULT 0,
  words INTEGER NOT NULL DEFAULT 0,
  plan_approved_at TEXT,
  last_revise_mode TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_versions (
  number INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  words INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (number, revision),
  FOREIGN KEY (number) REFERENCES chapters(number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapter_plans (
  number INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  written_at TEXT NOT NULL,
  FOREIGN KEY (number) REFERENCES chapters(number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS summaries (
  number INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  revision INTEGER,
  written_at TEXT NOT NULL,
  FOREIGN KEY (number) REFERENCES chapters(number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  number INTEGER NOT NULL,
  round INTEGER NOT NULL,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (number, round),
  FOREIGN KEY (number) REFERENCES chapters(number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  from_ch INTEGER NOT NULL,
  to_ch INTEGER NOT NULL,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS bible (
  name TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

${MATERIALS_SCHEMA_V4}

${ARTIFACT_SCHEMA}

CREATE TABLE IF NOT EXISTS search_docs (
  doc_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  chapter INTEGER,
  body TEXT NOT NULL,
  tokens TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(tokens, content='search_docs', content_rowid='rowid');

CREATE INDEX IF NOT EXISTS idx_versions_number ON chapter_versions(number);
CREATE INDEX IF NOT EXISTS idx_reviews_number ON reviews(number);
CREATE INDEX IF NOT EXISTS idx_events_chapter ON events(chapter);
CREATE INDEX IF NOT EXISTS idx_search_chapter ON search_docs(chapter);
`

/**
 * Absolute catalog path of one workspace.
 * @param {string} root - workspace directory.
 * @returns {string} `<root>/.storycraft/catalog.db`.
 */
export function catalogFile(root) {
  return join(root, STORE_DIR, 'catalog.db')
}

/** Absolute directory holding every work database. */
export function worksDir(root) {
  return join(root, STORE_DIR, 'works')
}

/** Absolute directory holding trashed work databases. */
export function trashDir(root) {
  return join(root, STORE_DIR, 'trash')
}

/** Absolute directory holding exports. */
export function exportsDir(root) {
  return join(root, STORE_DIR, 'exports')
}

/** Absolute directory holding managed material copies. */
export function materialsDir(root) {
  return join(root, STORE_DIR, 'materials')
}

/** Absolute directory holding backups. */
export function backupsDir(root) {
  return join(root, STORE_DIR, 'backups')
}

/**
 * Absolute path of one work database.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {string} `<root>/.storycraft/works/<workId>.db`.
 */
export function workFile(root, workId) {
  const id = String(workId)
  if (!isWorkId(id)) {
    throw new StoryError('invalid-work-id', `作品 id 不合法：${id}`)
  }
  return join(worksDir(root), `${id}.db`)
}

/** Absolute path of one trashed work database. */
export function trashFile(root, workId) {
  const id = String(workId)
  if (!isWorkId(id)) throw new StoryError('invalid-work-id', `作品 id 不合法：${id}`)
  return join(trashDir(root), `${id}.db`)
}

/** Whether `node:sqlite` can be loaded in this runtime. */
export function sqliteAvailable() {
  return DatabaseSync !== undefined
}

/** Refuse storage work when the runtime has no SQLite. */
export function assertSqlite() {
  if (DatabaseSync === undefined) {
    throw new StoryError('sqlite-unavailable', '当前运行时没有 node:sqlite：作品库不可用，请升级 DSH')
  }
}

/** Map an open/exec failure to the store's error codes. */
function mapDatabaseError(error, message) {
  if (error instanceof StoryError) return error
  if (error?.code === 'SQLITE_BUSY' || error?.code === 'EBUSY'
    || /database is locked|SQLITE_BUSY|resource busy or locked|EBUSY/iu.test(String(error?.message))) {
    return new StoryError('work-busy', '作品库正被另一个动作写入，请稍后重试')
  }
  if (/not a database|file is not a database|SQLITE_NOTADB|malformed/iu.test(String(error?.message))) {
    return new StoryError('db-corrupt', `${message}：${error.message}`)
  }
  return error
}

/**
 * Open one SQLite file with the store's pragmas.
 * @param {string} file - absolute database path.
 * @param {string} message - failure prefix for `db-corrupt`.
 * @param {{readOnly?: boolean, busyTimeout?: number}} [options] - `readOnly` opens a snapshot without WAL setup.
 * @returns {import('node:sqlite').DatabaseSync} open handle.
 */
export function openDatabase(file, message = '作品库无法打开', options = {}) {
  assertSqlite()
  let db
  try {
    db = new DatabaseSync(file, options.readOnly === true ? { readOnly: true } : {})
    if (options.readOnly !== true) {
      // Set the wait before touching the journal: a diagnostic pass can ask for 0.
      db.exec(`PRAGMA busy_timeout = ${Number.isInteger(options.busyTimeout) ? options.busyTimeout : 5000}`)
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA foreign_keys = ON')
    }
  } catch (error) {
    try {
      db?.close()
    } catch {
      // The handle never became usable.
    }
    throw mapDatabaseError(error, message)
  }
  return db
}

/** Read `PRAGMA user_version`. */
function userVersion(db) {
  try {
    return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  } catch (error) {
    throw mapDatabaseError(error, '作品库损坏或不是数据库')
  }
}

/**
 * Open the workspace catalog, initializing it when absent.
 * @param {string} root - workspace directory.
 * @param {{create?: boolean, busyTimeout?: number}} [options] - `create: false` returns undefined instead of creating.
 * @returns {import('node:sqlite').DatabaseSync|undefined} open handle.
 */
export function openCatalog(root, options = {}) {
  assertSqlite()
  const file = catalogFile(root)
  if (!existsSync(file)) {
    if (options.create === false) return undefined
    mkdirSync(dirname(file), { recursive: true })
  }
  const db = openDatabase(file, '作品目录无法打开', options)
  try {
    const version = userVersion(db)
    if (version !== 0 && version !== CATALOG_SCHEMA_VERSION) {
      throw new StoryError('schema-version-mismatch',
        `作品目录版本 ${version} 与支持的 ${CATALOG_SCHEMA_VERSION} 不一致：请升级插件`)
    }
    if (version === 0) {
      db.exec(CATALOG_SCHEMA)
      db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION}`)
    }
  } catch (error) {
    db.close()
    throw mapDatabaseError(error, '作品目录损坏或不是数据库')
  }
  return db
}

/**
 * Open an existing work database. Never creates one: an id that was never
 * initialized is reported as `work-not-found`.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {import('node:sqlite').DatabaseSync} open handle.
 */
export function openWork(root, workId) {
  assertSqlite()
  const file = workFile(root, workId)
  if (!existsSync(file)) throw new StoryError('work-not-found', `没有作品：${String(workId)}`)
  const db = openDatabase(file)
  try {
    const version = userVersion(db)
    if (version !== WORK_SCHEMA_VERSION) {
      throw new StoryError('schema-version-mismatch',
        `作品 ${workId} 的库版本 ${version} 不是支持的 ${WORK_SCHEMA_VERSION}：测试作品请删除重建，不做兼容迁移`)
    }
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

/**
 * Create one work database with its schema and metadata row.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {object} meta - meta row fields.
 * @returns {string} the created file.
 */
export function createWorkDatabase(root, workId, meta) {
  assertSqlite()
  const file = workFile(root, workId)
  if (existsSync(file)) throw new StoryError('work-exists', `作品已存在：${workId}`)
  mkdirSync(dirname(file), { recursive: true })
  let db
  try {
    db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(WORK_SCHEMA)
    db.prepare(`INSERT INTO meta (id, work_id, title, form, tags, plan_approval, word_min, word_max, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, 'required', ?, ?, ?, ?)`).run(
      meta.workId, meta.title, meta.form, meta.tags,
      meta.wordMin ?? null, meta.wordMax ?? null, meta.createdAt, meta.updatedAt,
    )
    db.exec(`PRAGMA user_version = ${WORK_SCHEMA_VERSION}`)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    return file
  } catch (error) {
    try {
      db?.close()
    } catch {
      // Nothing to release.
    }
    removeDatabaseFiles(file)
    throw mapDatabaseError(error, '作品库无法创建')
  }
}

/**
 * Remove one database together with its WAL sidecars.
 * @param {string} file - database path.
 */
export function removeDatabaseFiles(file) {
  // Guard every unlink: this Node build aborts on some `rmSync(force)` calls for
  // absent non-ASCII paths, and a missing file is already the desired state.
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${file}${suffix}`
    if (existsSync(target)) unlinkSync(target)
  }
}

/**
 * Checkpoint a database so its file is self-contained before a move.
 * @param {import('node:sqlite').DatabaseSync} db - open handle.
 */
export function checkpoint(db) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (error) {
    throw mapDatabaseError(error, '作品库无法检查点')
  }
}

/**
 * Move a database file and its WAL sidecars.
 * @param {string} from - current path.
 * @param {string} to - target path.
 */
export function moveDatabaseFiles(from, to) {
  renameSync(from, to)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${from}${suffix}`)) renameSync(`${from}${suffix}`, `${to}${suffix}`)
  }
}

/**
 * Run one write transaction (`BEGIN IMMEDIATE`).
 * @param {import('node:sqlite').DatabaseSync} db - open handle.
 * @param {() => any} fn - callback.
 * @returns {any} callback result.
 */
export function transaction(db, fn) {
  try {
    db.exec('BEGIN IMMEDIATE')
  } catch (error) {
    throw mapDatabaseError(error, '作品库正忙')
  }
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The transaction may already be gone; the original error matters.
    }
    throw mapDatabaseError(error, '作品库写入失败')
  }
}

/**
 * Run `PRAGMA integrity_check`.
 * @param {import('node:sqlite').DatabaseSync} db - open handle.
 * @returns {string} `ok` or the first error line.
 */
export function integrityCheck(db) {
  return db.prepare('PRAGMA integrity_check').get()?.integrity_check ?? 'unknown'
}

/**
 * Copy a database through SQLite's backup API (WAL-safe).
 * @param {import('node:sqlite').DatabaseSync} db - open handle.
 * @param {string} destination - target file.
 * @returns {Promise<string>} destination.
 */
export async function backupTo(db, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination)) rmSync(destination, { force: true })
  if (typeof db.backup === 'function') {
    await db.backup(destination)
    return destination
  }
  // Older node:sqlite builds lack backup(); VACUUM INTO is a WAL-safe snapshot.
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`)
  return destination
}

/**
 * Run one callback with an open work database.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {(db: import('node:sqlite').DatabaseSync) => any} fn - callback.
 * @returns {any} callback result.
 */
export function withWork(root, workId, fn) {
  const db = openWork(root, workId)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}
