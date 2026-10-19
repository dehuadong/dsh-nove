// Chapter-level SQLite store (S3): plans, versions, reviews, summaries, events, volumes.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../store-db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throws(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected error')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-chapter-'))
try {
  const { workId: work } = store.initWork(root, { title: '章节测试' })
  const plan = { work, chapter: 1, perspective: '周砚', goal: '摸清井台', obstacle: '巡夜', cost: '暴露', turn: '发现第三人' }
  store.writePlan(root, plan)
  check('plan blocks unapproved write', (() => {
    try {
      store.writeChapter(root, { work, chapter: 1, body: '正文一', requirePlanApproval: true })
      return false
    } catch (error) { return error.code === 'plan-not-approved' }
  })())
  store.approveChapterPlan(root, { work, chapter: 1 })
  const written = store.writeChapter(root, { work, chapter: 1, title: '第一章', body: '周砚摸井台，井深二丈二尺。', requirePlanApproval: true })
  check('approved write lands', written.revision === 1 && written.words > 0, JSON.stringify(written))
  check('current body readable', store.readChapter(root, { work, chapter: 1 }).body.includes('井深'))
  throws('second write without rewrite refused', 'chapter-exists', () => store.writeChapter(root, { work, chapter: 1, body: '另一版' }))
  const rewritten = store.writeChapter(root, { work, chapter: 1, body: '另一版正文', rewrite: true })
  check('rewrite creates r2', rewritten.revision === 2)

  const review = store.writeReview(root, {
    work, chapter: 1,
    problems: [{ location: '井台', problem: '节奏太快', suggestion: '加一拍' }],
  })
  check('review round 1', review.round === 1)
  const latest = store.latestReview(root, work, 1)
  check('latest review has one open item', latest.items.length === 1 && latest.items[0].done === false)
  throws('unknown problem refused', 'problem-not-found', () => store.reviseChapter(root, { work, chapter: 1, body: '修订版', problemIds: ['Q9'] }))
  throws('identical revision refused', 'unchanged-body', () => store.reviseChapter(root, { work, chapter: 1, body: '另一版正文', problemIds: ['Q1'] }))
  const revised = store.reviseChapter(root, { work, chapter: 1, body: '修订版正文，多一拍。', problemIds: ['Q1'] })
  check('revision r3 and item closed', revised.revision === 3 && store.latestReview(root, work, 1).items[0].done === true)

  store.writeSummary(root, { work, chapter: 1, text: '周砚摸井台，发现第三人。' })
  check('summary roundtrip', store.readSummary(root, work, 1).text.includes('第三人'))
  throws('summary required', 'empty-summary', () => store.writeSummary(root, { work, chapter: 1, text: ' ' }))

  const state = store.foldState(root, {
    work, chapter: 1,
    events: [
      { kind: 'entity', name: '周砚', fact: '摸过井台' },
      { kind: 'hook', id: 'H1', text: '第三人是谁', state: 'open' },
    ],
  })
  check('events appended', state.appended === 2 && state.seq === 2)
  const events = store.readEvents(root, work, 1)
  check('events readable', events.length === 2 && events[0].name === '周砚')

  const volume = store.writeVolume(root, { work, id: 'v1', title: '第一卷', from: 1, to: 5, summary: '开局' })
  check('volume written', volume.volume.id === 'v1' && store.readVolumes(root, work).length === 1)
  throws('volume range invalid', 'volume-invalid', () => store.writeVolume(root, { work, id: 'v2', from: 5, to: 2 }))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
