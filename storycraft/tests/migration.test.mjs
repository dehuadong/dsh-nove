// v1 -> v2 work schema migration: backfill, idempotency, rollback, refusal.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, openWork, workFile, WORK_SCHEMA_VERSION } from '../db.js'
import * as s from '../storage.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}
function rawVersion(db) {
  return Number(db.prepare('PRAGMA user_version').get().user_version)
}
function hasMaterials(db) {
  return db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'materials'").get().n === 1
}

function hasRevision(db) {
  return db.prepare('PRAGMA table_info(summaries)').all().some(column => column.name === 'revision')
}

async function fixture(root, title) {
  const { workId } = s.initWork(root, { title, wordRange: { min: 50, max: 200 } })
  s.writeOutline(root, { work: workId, mainline: '一条主线' })
  s.approveOutline(root, { work: workId })
  s.writePlan(root, { work: workId, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: workId, chapter: 1 })
  s.writeChapter(root, { work: workId, chapter: 1, title: '一', body: '正文。'.repeat(60) })
  s.writeSummary(root, { work: workId, chapter: 1, text: '第一章摘要。' })
  return workId
}

/** Turn a current work database back into a v1 shape. */
function downgrade(root, workId, { dropRevision = true, dropChapters = false, dropMaterials = false } = {}) {
  const db = openDatabase(workFile(root, workId))
  try {
    if (dropMaterials) db.exec('DROP TABLE materials')
    if (dropRevision) db.exec('ALTER TABLE summaries DROP COLUMN revision')
    if (dropChapters) {
      db.exec('PRAGMA foreign_keys = OFF')
      db.exec('DROP TABLE chapters')
    }
    db.exec('PRAGMA user_version = 1')
  } finally {
    db.close()
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-migration-'))
try {
  const work = await fixture(root, '迁移测试')
  downgrade(root, work)
  const migrated = openWork(root, work)
  try {
    check('migration adds revision and materials', hasRevision(migrated) && hasMaterials(migrated))
    check('migration sets the current version', rawVersion(migrated) === WORK_SCHEMA_VERSION, String(rawVersion(migrated)))
    check('migration backfills current revision',
      migrated.prepare('SELECT revision FROM summaries WHERE number = 1').get().revision === 1)
    check('migration preserves chapters and body',
      migrated.prepare('SELECT count(*) AS n FROM chapters').get().n === 1
      && migrated.prepare('SELECT body FROM chapter_versions WHERE number = 1').get().body.includes('正文'))
  } finally {
    migrated.close()
  }
  const state = s.readSummaryState(root, work, 1)
  check('migrated summary is current', state.state === 'current' && state.revision === 1, JSON.stringify(state))
  const again = openWork(root, work)
  try {
    check('second open is a no-op', rawVersion(again) === WORK_SCHEMA_VERSION
      && again.prepare('SELECT revision FROM summaries WHERE number = 1').get().revision === 1)
  } finally {
    again.close()
  }

  const half = await fixture(root, '半迁移')
  downgrade(root, half, { dropRevision: false })
  const halfDb = openDatabase(workFile(root, half))
  halfDb.prepare('UPDATE summaries SET revision = NULL WHERE number = 1').run()
  halfDb.close()
  const halfOpened = openWork(root, half)
  try {
    check('half-migration fills NULL without rebinding',
      halfOpened.prepare('SELECT revision FROM summaries WHERE number = 1').get().revision === 1)
  } finally {
    halfOpened.close()
  }

  const v2 = await fixture(root, 'v2 素材迁移')
  downgrade(root, v2, { dropRevision: false, dropMaterials: true })
  const v2Db = openDatabase(workFile(root, v2))
  v2Db.exec('PRAGMA user_version = 2')
  v2Db.close()
  const v2Opened = openWork(root, v2)
  try {
    check('v2 migration adds materials and keeps content',
      hasMaterials(v2Opened) && rawVersion(v2Opened) === WORK_SCHEMA_VERSION
      && v2Opened.prepare('SELECT count(*) AS n FROM chapters').get().n === 1)
  } finally {
    v2Opened.close()
  }

  const v3 = await fixture(root, 'v3 素材迁移')
  await s.importMaterial(root, v3, { name: '旧参考.md', contentBase64: Buffer.from('旧参考。', 'utf8').toString('base64') })
  const v3Db = openDatabase(workFile(root, v3))
  v3Db.exec('PRAGMA foreign_keys = OFF')
  v3Db.exec(`CREATE TABLE materials_v3 (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL, origin TEXT NOT NULL,
    bytes INTEGER NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL, content TEXT NOT NULL
  )`)
  v3Db.exec(`INSERT INTO materials_v3 (id, title, format, origin, bytes, hash, created_at, content)
    SELECT id, title, format, origin, bytes, hash, created_at, content FROM materials`)
  v3Db.exec('DROP TABLE materials')
  v3Db.exec('ALTER TABLE materials_v3 RENAME TO materials')
  v3Db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_hash ON materials(hash)')
  v3Db.exec('PRAGMA user_version = 3')
  v3Db.close()
  const v3Opened = openWork(root, v3)
  try {
    check('v3 migration adds purpose and stamps v5', rawVersion(v3Opened) === WORK_SCHEMA_VERSION
      && v3Opened.prepare('PRAGMA table_info(materials)').all().some(column => column.name === 'purpose')
      && v3Opened.prepare('SELECT purpose FROM materials').get().purpose === 'reference')
  } finally {
    v3Opened.close()
  }

  const v4 = await fixture(root, 'v4 标题索引')
  const oldMaterial = await s.importMaterial(root, v4, {
    name: '旧标题.md',
    title: '紫电河',
    contentBase64: Buffer.from('旧井边的正文。', 'utf8').toString('base64'),
  })
  const bigMaterial = await s.importMaterial(root, v4, {
    name: '大标题.md',
    title: '大标题词',
    contentBase64: Buffer.from('水'.repeat(174_700), 'utf8').toString('base64'),
  })
  const v4Db = openDatabase(workFile(root, v4))
  v4Db.prepare('DELETE FROM search_docs WHERE doc_id = ?').run(`material:${oldMaterial.material.id}`)
  v4Db.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
  for (const doc of v4Db.prepare("SELECT doc_id, body FROM search_docs WHERE kind = 'material'").all()) {
    v4Db.prepare('UPDATE search_docs SET tokens = ? WHERE doc_id = ?').run(s.searchTokens(doc.body), doc.doc_id)
  }
  v4Db.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
  v4Db.exec('PRAGMA user_version = 4')
  v4Db.close()
  const migrationStarted = performance.now()
  const v4Opened = openWork(root, v4)
  const migrationMs = performance.now() - migrationStarted
  try {
    check('v4 migration stamps v5 and indexes the title', rawVersion(v4Opened) === WORK_SCHEMA_VERSION
      && s.search(root, v4, '紫电河').some(item => item.id === `material:${oldMaterial.material.id}`)
      && s.search(root, v4, '旧井边').some(item => item.id === `material:${oldMaterial.material.id}`))
    check('v4 migration with 512KB material fits 400ms', migrationMs < 400
      && s.search(root, v4, '大标题词').some(item => item.id === `material:${bigMaterial.material.id}`), `${migrationMs.toFixed(1)}ms`)
  } finally {
    v4Opened.close()
  }

  const failV5 = await fixture(root, 'v5 回滚')
  await s.importMaterial(root, failV5, { name: '回滚.md', contentBase64: Buffer.from('回滚正文。', 'utf8').toString('base64') })
  const failDb = openDatabase(workFile(root, failV5))
  failDb.exec('DROP TABLE search_fts')
  failDb.exec('PRAGMA user_version = 4')
  failDb.close()
  throwsCode('v5 migration failure is reported', 'schema-migration-failed', () => openWork(root, failV5))
  const failAfter = openDatabase(workFile(root, failV5))
  try {
    check('failed v5 migration keeps version 4', rawVersion(failAfter) === 4, String(rawVersion(failAfter)))
  } finally {
    failAfter.close()
  }

  const bad = await fixture(root, '坏素材表')
  downgrade(root, bad, { dropRevision: false, dropMaterials: true })
  const badDb = openDatabase(workFile(root, bad))
  badDb.exec('CREATE TABLE materials (id TEXT PRIMARY KEY)')
  badDb.exec('PRAGMA user_version = 2')
  badDb.close()
  throwsCode('incompatible materials shape fails', 'schema-migration-failed', () => openWork(root, bad))
  const badAfter = openDatabase(workFile(root, bad))
  try {
    check('failed v2 migration keeps version 2', rawVersion(badAfter) === 2, String(rawVersion(badAfter)))
  } finally {
    badAfter.close()
  }

  const broken = await fixture(root, '回滚测试')
  downgrade(root, broken, { dropChapters: true })
  throwsCode('broken v1 migration fails with a code', 'schema-migration-failed', () => openWork(root, broken))
  const after = openDatabase(workFile(root, broken))
  try {
    check('failed migration rolled back the column', !hasRevision(after))
    check('failed migration kept user_version 1', rawVersion(after) === 1, String(rawVersion(after)))
  } finally {
    after.close()
  }

  const newer = await fixture(root, '新版本')
  const newerDb = openDatabase(workFile(root, newer))
  newerDb.exec('PRAGMA user_version = 99')
  newerDb.close()
  throwsCode('unknown newer version is refused', 'schema-version-mismatch', () => openWork(root, newer))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
