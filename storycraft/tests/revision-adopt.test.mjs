// A12: chapter body/plan history and adoption-by-new-revision.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function codeOf(fn) {
  try { fn(); return '' } catch (error) { return error?.code ?? String(error) }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-adopt-'))
try {
  const makeWork = (title, body = true) => {
    const work = s.initWork(root, { title, wordRange: { min: 10, max: 5000 } }).workId
    s.writeOutline(root, { work, mainline: '主线' })
    s.approveOutline(root, { work })
    s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work, chapter: 1 })
    if (body) s.writeChapter(root, { work, chapter: 1, title: '第1章', body: '甲把账本收好。'.repeat(30) })
    return work
  }

  const work = makeWork('正文回滚')
  s.writeChapter(root, { work, chapter: 1, title: '第1章', body: '乙把钥匙收好。'.repeat(30), rewrite: true })
  const before = s.readChapterHistory(root, { work, chapter: 1 })
  check('history lists body revisions newest first', before.body.map(row => row.revision).join(',') === '2,1', JSON.stringify(before.body))
  check('history marks exactly one current body', before.body.filter(row => row.current).length === 1 && before.body[0].current === true, JSON.stringify(before.body))
  check('history lists the plan revision and its approval', before.plan.length === 1 && before.plan[0].approved === true, JSON.stringify(before.plan))

  s.writeStateDraft(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '乙', predicate: '状态', object: '收好钥匙' }] },
    ready: false,
  })
  const adopted = s.adoptChapterRevision(root, { work, chapter: 1, target: 'body', revision: 'r1', expectedCurrent: 'r2' })
  check('body adoption appends a new revision', adopted.newRevision === 'r3', JSON.stringify(adopted))
  const after = s.readChapterHistory(root, { work, chapter: 1 })
  check('adoption moves the current marker', after.currentRevision === 'r3' && after.body[0].current === true && after.body[0].revision === 3, JSON.stringify(after))
  check('adoption restores the selected body', after.body[0].revision === 3 && after.stage === 'written')
  check('adoption selects exactly one current revision', after.body.filter(row => row.current).length === 1)
  check('adoption restores the selected body bytes', String(s.readChapter(root, { work, chapter: 1 }).content).startsWith('甲把账本收好。'), s.readChapter(root, { work, chapter: 1 }).content.slice(0, 20))
  check('adoption invalidates the state draft', s.readStateDraft(root, { work, chapter: 1 }) === undefined)
  check('adoption sends the chapter back to review', s.nextStep(root, work).action === 'story_review', s.nextStep(root, work).action)
  check('adoption removes the old body from search', s.search(root, work, '钥匙').length === 0, JSON.stringify(s.search(root, work, '钥匙')))
  check('adoption indexes the restored body', s.search(root, work, '账本').some(hit => hit.id === 'chapter:1:r3'), JSON.stringify(s.search(root, work, '账本')))
  const exported = s.exportWork(root, work, join(root, 'adopt-export'))
  const exportedManifest = JSON.parse(readFileSync(join(exported.directory, 'manifest.json'), 'utf8'))
  check('export manifest follows the adopted current revision', Number(exportedManifest.chapters?.find(chapter => chapter.number === 1)?.currentRevision) === 3, JSON.stringify(exportedManifest.chapters))
  const events = s.readEvents(root, work)
  check('adoption records a revision-adopt event', events.some(event => event.kind === 'revision-adopt' && event.chapter === 1), JSON.stringify(events.map(event => event.kind)))

  check('a stale expected current is refused', codeOf(() => s.adoptChapterRevision(root, { work, chapter: 1, target: 'body', revision: 'r1', expectedCurrent: 'r2' })) === 'revision-conflict')
  check('the current revision is refused', codeOf(() => s.adoptChapterRevision(root, { work, chapter: 1, target: 'body', revision: 'r3', expectedCurrent: 'r3' })) === 'revision-current')
  check('an unknown body revision is refused', codeOf(() => s.adoptChapterRevision(root, { work, chapter: 1, target: 'body', revision: 'r99', expectedCurrent: 'r3' })) === 'revision-not-found')
  check('an invalid target is refused', codeOf(() => s.adoptChapterRevision(root, { work, chapter: 1, target: 'review', revision: 'r1', expectedCurrent: 'r3' })) === 'revision-target-invalid')

  const unapproved = makeWork('章纲未批准', true)
  s.writeChapter(root, { work: unapproved, chapter: 1, title: '第1章', body: '丙把门锁好。'.repeat(30), rewrite: true })
  s.writePlan(root, { work: unapproved, chapter: 1, perspective: '丙', goal: 'g3', obstacle: 'o3', cost: 'c3', turn: 't3' })
  check('body adoption needs a currently approved plan', codeOf(() => s.adoptChapterRevision(root, { work: unapproved, chapter: 1, target: 'body', revision: 'r1', expectedCurrent: 'r2' })) === 'plan-not-approved')

  const older = makeWork('旧章回滚', false)
  s.writePlan(root, { work: older, chapter: 2, perspective: '乙', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  check('a non-latest chapter is refused', codeOf(() => s.adoptChapterRevision(root, { work: older, chapter: 1, target: 'plan', revision: 'x', expectedCurrent: 'y' })) === 'chapter-not-current')

  const planWork = makeWork('章纲回滚', false)
  s.writePlan(root, { work: planWork, chapter: 1, perspective: '甲', goal: 'g2', obstacle: 'o2', cost: 'c2', turn: 't2' })
  const planHistory = s.readChapterHistory(root, { work: planWork, chapter: 1 })
  check('history lists both plan revisions', planHistory.plan.length === 2, JSON.stringify(planHistory.plan))
  const oldPlan = planHistory.plan.find(row => !row.current)
  const newPlan = planHistory.plan.find(row => row.current)
  s.approveChapterPlan(root, { work: planWork, chapter: 1 })
  const planAdopted = s.adoptChapterRevision(root, { work: planWork, chapter: 1, target: 'plan', revision: oldPlan.revisionId, expectedCurrent: newPlan.revisionId })
  check('plan adoption creates an adopt: revision', String(planAdopted.newRevision).startsWith('adopt:'), JSON.stringify(planAdopted))
  const planAfter = s.readChapterHistory(root, { work: planWork, chapter: 1 })
  check('plan adoption moves the current marker', planAfter.plan[0].revisionId === planAdopted.newRevision && planAfter.plan[0].current === true, JSON.stringify(planAfter.plan))
  check('plan adoption clears approval', planAfter.plan.every(row => row.approved === false), JSON.stringify(planAfter.plan))
  check('plan adoption keeps the chapter planned', planAfter.stage === 'planned')

  check('plan adoption on a chapter with body is refused', codeOf(() => s.adoptChapterRevision(root, { work, chapter: 1, target: 'plan', revision: 'x', expectedCurrent: 'y' })) === 'chapter-exists')

  const settledWork = makeWork('定稿回滚', true)
  s.writeChapter(root, { work: settledWork, chapter: 1, title: '第1章', body: '丁把灯关好。'.repeat(30), rewrite: true })
  s.writeReview(root, { work: settledWork, chapter: 1, observations: [] })
  s.writeSummary(root, { work: settledWork, chapter: 1, text: '摘要' })
  s.settleState(root, { work: settledWork, chapter: 1, newHooks: [{ text: '备用钥匙' }] })
  check('a settled chapter refuses body adoption', codeOf(() => s.adoptChapterRevision(root, { work: settledWork, chapter: 1, target: 'body', revision: 'r1', expectedCurrent: 'r2' })) === 'chapter-settled')

  const empty = makeWork('空历史', false)
  const emptyHistory = s.readChapterHistory(root, { work: empty, chapter: 1 })
  check('a chapter without body still returns its plan', emptyHistory.body.length === 0 && emptyHistory.plan.length === 1, JSON.stringify(emptyHistory))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
