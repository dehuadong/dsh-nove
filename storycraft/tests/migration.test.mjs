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
function downgrade(root, workId, { dropRevision = true, dropChapters = false } = {}) {
  const db = openDatabase(workFile(root, workId))
  try {
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
    check('migration adds revision', hasRevision(migrated))
    check('migration sets user_version 2', rawVersion(migrated) === WORK_SCHEMA_VERSION, String(rawVersion(migrated)))
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
