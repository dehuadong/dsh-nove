// E13: read-only work self-check.
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { openWork, workFile } from '../src/db.ts'
import { selfCheck } from '../src/self-check.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-self-check-'))
function makeWork(title) {
  const { workId } = s.initWork(root, { title })
  s.writeOutline(root, { work: workId, mainline: '一条主线' })
  s.approveOutline(root, { work: workId })
  s.writePlan(root, { work: workId, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: workId, chapter: 1 })
  s.writeChapter(root, { work: workId, chapter: 1, title: '一', body: '甲推开门。' })
  return workId
}
try {
  const clean = makeWork('自检正常')
  const cleanReport = selfCheck(root, clean)
  check('clean work has no errors', cleanReport.ok === true && cleanReport.issues.every(item => item.severity === 'warning'), JSON.stringify(cleanReport))
  check('checked reports fixed groups', cleanReport.checked === 4, String(cleanReport.checked))

  const missing = makeWork('自检缺版本')
  const missingDb = openWork(root, missing)
  missingDb.prepare('DELETE FROM chapter_versions WHERE number = 1 AND revision = 1').run()
  missingDb.close()
  const missingReport = selfCheck(root, missing)
  check('missing current version is reported', missingReport.issues.some(item => item.code === 'chapter-version-missing' && item.chapter === 1), JSON.stringify(missingReport.issues))

  const empty = makeWork('自检空正文')
  const emptyDb = openWork(root, empty)
  emptyDb.prepare('UPDATE chapter_versions SET body = ? WHERE number = 1 AND revision = 1').run('   ')
  emptyDb.close()
  const emptyReport = selfCheck(root, empty)
  check('empty current body is reported', emptyReport.issues.some(item => item.code === 'chapter-body-empty' && item.chapter === 1), JSON.stringify(emptyReport.issues))

  const settled = makeWork('自检定稿状态')
  const settledDb = openWork(root, settled)
  settledDb.prepare("UPDATE chapters SET stage = 'settled', state_ready_revision = 0 WHERE number = 1").run()
  settledDb.close()
  const settledReport = selfCheck(root, settled)
  check('settled state revision mismatch is reported', settledReport.issues.some(item => item.code === 'settled-state-mismatch' && item.chapter === 1), JSON.stringify(settledReport.issues))

  const draft = makeWork('自检草案')
  s.writeStateDraft(root, { work: draft, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好钥匙' }] }, ready: false })
  const draftReport = selfCheck(root, draft)
  check('pending state draft is a warning', draftReport.ok === true && draftReport.issues.some(item => item.code === 'state-draft-pending' && item.severity === 'warning'), JSON.stringify(draftReport.issues))

  const emptyWork = s.initWork(root, { title: '空自检' }).workId
  const noChapterReport = selfCheck(root, emptyWork)
  check('empty work has no errors', noChapterReport.ok === true && noChapterReport.issues.length === 0, JSON.stringify(noChapterReport))

  const search = makeWork('自检缺索引')
  const searchDb = openWork(root, search)
  searchDb.exec('DELETE FROM search_docs')
  searchDb.close()
  const searchReport = selfCheck(root, search)
  check('missing search docs are reported', searchReport.issues.some(item => item.code === 'search-index-missing'), JSON.stringify(searchReport.issues))

  const ready = makeWork('自检已接受草案')
  s.writeStateDraft(root, { work: ready, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好钥匙' }] }, ready: true })
  const readyReport = selfCheck(root, ready)
  check('accepted draft is not called pending', !readyReport.issues.some(item => item.code === 'state-draft-pending'), JSON.stringify(readyReport.issues))

  const before = await stat(workFile(root, clean))
  selfCheck(root, clean)
  const after = await stat(workFile(root, clean))
  check('self-check leaves the work database unchanged', before.size === after.size && before.mtimeMs === after.mtimeMs, before.mtimeMs + '/' + after.mtimeMs)

  const stale = makeWork('自检版本不符')
  const staleDb = openWork(root, stale)
  staleDb.exec('PRAGMA user_version = 99')
  staleDb.close()
  const staleReport = selfCheck(root, stale)
  check('schema mismatch is an issue, not a throw', staleReport.ok === false && staleReport.issues.some(item => item.code === 'schema-version-mismatch') && staleReport.checked === 1, JSON.stringify(staleReport))

  check('self-check still reads the clean work', s.readManifest(root, clean).chapters.length === 1)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')

