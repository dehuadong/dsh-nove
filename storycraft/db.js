/**
 * SQLite store: one database per workspace, one work per row graph.
 *
 * The store is the single source of truth for works. Connections are opened per
 * operation (node:sqlite is synchronous), writes run in `BEGIN IMMEDIATE`, and
 * every query starts from `work_id` so one work can never read another's rows.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Schema version written to `PRAGMA user_version`. */
export const SCHEMA_VERSION = 1

/** Directory that holds the database, backups and exports. */
export const STORE_DIR = '.storycraft'

/**
 * Database path for one workspace.
 * @param {string} root - workspace directory.
 * @returns {string} absolute database path.
 */
export function databasePath(root) {
  return join(root, STORE_DIR, 'works.db')
}

/** Schema for version 1. */
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS works (
  work_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  form TEXT NOT NULL,
  tags TEXT,
  plan_approval TEXT NOT NULL DEFAULT 'required',
  word_min INTEGER,
  word_max INTEGER,
  outline_written_at TEXT,
  outline_approved_at TEXT,
  trashed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON UPDATE CASCADE ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  stage TEXT NOT NULL DEFAULT 'planned',
  current_revision INTEGER NOT NULL DEFAULT 0,
  words INTEGER NOT NULL DEFAULT 0,
  plan_approved_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, number)
);

CREATE TABLE IF NOT EXISTS chapter_versions (
  work_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  words INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, number, revision),
  FOREIGN KEY (work_id, number) REFERENCES chapters(work_id, number) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapter_plans (
  work_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  text TEXT NOT NULL,
  written_at TEXT NOT NULL,
  PRIMARY KEY (work_id, number),
  FOREIGN KEY (work_id, number) REFERENCES chapters(work_id, number) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS summaries (
  work_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  text TEXT NOT NULL,
  written_at TEXT NOT NULL,
  PRIMARY KEY (work_id, number),
  FOREIGN KEY (work_id, number) REFERENCES chapters(work_id, number) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  work_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  round INTEGER NOT NULL,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, number, round),
  FOREIGN KEY (work_id, number) REFERENCES chapters(work_id, number) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON UPDATE CASCADE ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (work_id, seq)
);

CREATE TABLE IF NOT EXISTS volumes (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON UPDATE CASCADE ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  from_ch INTEGER NOT NULL,
  to_ch INTEGER NOT NULL,
  summary TEXT,
  PRIMARY KEY (work_id, id)
);

CREATE TABLE IF NOT EXISTS bible (
  work_id TEXT NOT NULL REFERENCES works(work_id) ON UPDATE CASCADE ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, name)
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

CREATE TABLE IF NOT EXISTS search_docs (
  work_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  chapter INTEGER,
  body TEXT NOT NULL,
  tokens TEXT NOT NULL,
  PRIMARY KEY (work_id, doc_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(tokens);

CREATE INDEX IF NOT EXISTS idx_chapters_work ON chapters(work_id);
CREATE INDEX IF NOT EXISTS idx_versions_work ON chapter_versions(work_id, number);
CREATE INDEX IF NOT EXISTS idx_reviews_work ON reviews(work_id, number);
CREATE INDEX IF NOT EXISTS idx_events_work ON events(work_id, chapter);
CREATE INDEX IF NOT EXISTS idx_search_work ON search_docs(work_id, chapter);
`

/**
 * Open the workspace store, creating the schema on first use.
 * @param {string} root - workspace directory.
 * @returns {DatabaseSync} open database handle.
 */
export function openStore(root) {
  const file = databasePath(root)
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA foreign_keys = ON')
  } catch (error) {
    db.close()
    const corrupt = new Error(`作品库无法打开：${error.message}`)
    corrupt.code = 'db-corrupt'
    throw corrupt
  }
  let version
  try {
    version = db.prepare('PRAGMA user_version').get()?.user_version ?? 0
  } catch (error) {
    db.close()
    const corrupt = new Error(`作品库损坏或不是数据库：${error.message}`)
    corrupt.code = 'db-corrupt'
    throw corrupt
  }
  if (version > SCHEMA_VERSION) {
    db.close()
    const error = new Error(`作品库版本 ${version} 高于支持的 ${SCHEMA_VERSION}：请升级插件`)
    error.code = 'schema-version-mismatch'
    throw error
  }
  if (version === 0) {
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

/**
 * Run one callback with an open store.
 * @param {string} root - workspace directory.
 * @param {(db: DatabaseSync) => any} fn - callback.
 * @returns {any} callback result.
 */
export function withStore(root, fn) {
  const db = openStore(root)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

/**
 * Run one write transaction (`BEGIN IMMEDIATE`).
 * @param {DatabaseSync} db - open store.
 * @param {() => any} fn - callback.
 * @returns {any} callback result.
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Run `PRAGMA integrity_check`.
 * @param {DatabaseSync} db - open store.
 * @returns {string} `ok` or the first error line.
 */
export function integrityCheck(db) {
  return db.prepare('PRAGMA integrity_check').get()?.integrity_check ?? 'unknown'
}

/**
 * Copy the database through SQLite's backup API (WAL-safe).
 * @param {DatabaseSync} db - open store.
 * @param {string} destination - target file.
 * @returns {Promise<string>} destination.
 */
export async function backupTo(db, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  if (typeof db.backup === 'function') {
    await db.backup(destination)
    return destination
  }
  // Older node:sqlite builds lack backup(); VACUUM INTO is a WAL-safe snapshot.
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`)
  return destination
}
