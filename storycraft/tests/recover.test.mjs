// A10: read-only recover scans, rebuildable search projection, WAL crash safety.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCatalog, openWork, workFile } from '../src/db.ts'
import { syncSearchDoc } from '../src/search-index.ts'
import { rebuildSearchIndex, scanWork, scanWorkspace } from '../src/recovery.ts'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
const codes = report => report.issues.map(issue => issue.code)

const root = await mkdtemp(join(tmpdir(), 'storycraft-recover-'))
try {
  const { workId: work } = s.initWork(root, { title: '恢复扫描', wordRange: { min: 10, max: 5000 } })
  s.writeOutline(root, { work, mainline: '主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '第1章', body: '甲把账本收好。'.repeat(30) })
  s.appendStateEvent(root, { work, chapter: 1, kind: 'fact', payload: { ops: [{ op: 'upsert', fact: { subject: '甲', predicate: '状态', object: '收好账本' } }] } })
  s.writeSummary(root, { work, chapter: 1, text: '甲收好账本。' })

  const dbFixture = openWork(root, work)
  try {
    dbFixture.prepare("INSERT INTO materials (id, title, format, origin, bytes, hash, created_at, content, purpose) VALUES ('mat-test', '标题', 'txt', 'test', 4, 'hash-test', '2026-10-30T00:00:00.000Z', '素材正文', 'reference')").run()
    syncSearchDoc(dbFixture, 'material:mat-test', 'material', 'materials/mat-test', 0, '素材正文', '标题 素材正文')
    syncSearchDoc(dbFixture, 'custom:1', 'custom_kind', 'custom/source', 0, '自定义投影')
  } finally { dbFixture.close() }

  const clean = scanWork(root, work)
  check('a clean work scans clean', clean.issues.length === 0, JSON.stringify({ issues: clean.issues, counts: clean.counts }))
  check('a clean work reports its projection source', clean.projection === 'event-log')

  const db = openWork(root, work)
  try { db.prepare("DELETE FROM search_docs WHERE kind = 'chapter'").run() } finally { db.close() }
  const broken = scanWork(root, work)
  check('missing index documents are reported', codes(broken).some(code => code === 'search-index-missing' || code === 'search-index-drift'), JSON.stringify(codes(broken)))
  const rebuilt = rebuildSearchIndex(root, work)
  check('rebuild reports indexed documents', (rebuilt.counts.chapter ?? 0) > 0 && (rebuilt.counts.summary ?? 0) > 0, JSON.stringify(rebuilt.counts))
  check('rebuild preserves an unknown kind', rebuilt.unknownKinds.includes('custom_kind'), JSON.stringify(rebuilt.unknownKinds))
  const after = scanWork(root, work)
  check('rebuild makes the work scan clean again', after.issues.length === 0, JSON.stringify(after.issues))
  const checkDb = openWork(root, work)
  try {
    const hits = checkDb.prepare("SELECT d.doc_id AS docId FROM search_fts f JOIN search_docs d ON d.rowid = f.rowid WHERE f.tokens MATCH '账本'").all()
    check('the rebuilt FTS finds chapter text', hits.length > 0, JSON.stringify(hits))
    const material = checkDb.prepare("SELECT body FROM search_docs WHERE doc_id = 'material:mat-test'").get()
    check('rebuild keeps the material body as content, not the index text', material?.body === '素材正文', JSON.stringify(material))
    check('the preserved unknown kind is still present', checkDb.prepare("SELECT doc_id FROM search_docs WHERE doc_id = 'custom:1'").get() !== undefined)
  } finally { checkDb.close() }

  const fresh = s.initWork(root, { title: '全新作品' }).workId
  const freshScan = scanWork(root, fresh)
  check('a fresh work with the default unindexed outline scans clean', freshScan.issues.length === 0, JSON.stringify({ issues: freshScan.issues, counts: freshScan.counts }))
  const freshFile = workFile(root, fresh)
  renameSync(freshFile, `${freshFile}.bak`)
  check('a missing work DB is reported', codes(scanWork(root, fresh)).includes('db-missing'))
  renameSync(`${freshFile}.bak`, freshFile)

  const workspace = scanWorkspace(root)
  check('a clean workspace scans clean', workspace.issues.length === 0, JSON.stringify(workspace.issues))

  writeFileSync(join(root, '.storycraft', 'works', 'orphan.db'), '')
  check('an orphan work file is reported', codes(scanWorkspace(root)).includes('orphan-db'))
  mkdirSync(join(root, '.storycraft', 'exports', '.tmp-stale'), { recursive: true })
  check('export staging is reported as a warning', codes(scanWorkspace(root)).includes('export-temp'))

  const catalog = openCatalog(root, { create: false })
  try {
    catalog.prepare('INSERT INTO session_current (session_id, work_id, updated_at) VALUES (?, ?, ?)')
      .run('ghost-session', '不存在的作品', new Date().toISOString())
  } finally { catalog.close() }
  check('a stale session is reported', codes(scanWorkspace(root)).includes('stale-session'))

  // A child process dies inside an open transaction; WAL must roll it back.
  const file = workFile(root, work)
  const script = `const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.argv[1])
db.exec("PRAGMA journal_mode = WAL")
db.exec("BEGIN IMMEDIATE")
db.exec("INSERT INTO events (seq, at, chapter, kind, payload) VALUES (999, 'x', 1, 'fact', '{}')")
process.exit(7)`
  const child = spawnSync(process.execPath, ['-e', script, file], { stdio: 'ignore', timeout: 20000 })
  check('the crash child exits before commit', child.status === 7, String(child.status))
  const reopened = openWork(root, work)
  try {
    check('the uncommitted row did not survive', reopened.prepare('SELECT seq FROM events WHERE seq = 999').get() === undefined)
    check('the work is still intact', reopened.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok')
    check('the committed chapter survived', Number(reopened.prepare('SELECT current_revision FROM chapters WHERE number = 1').get()?.current_revision) === 1)
  } finally { reopened.close() }
  check('the work DB file still exists', existsSync(file))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
