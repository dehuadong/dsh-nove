// Chapter-level store: plans, versions, reviews, summaries, events, volumes.
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
  throws('plan blocks unapproved write', 'plan-not-approved', () => store.writeChapter(root, { work, chapter: 1, body: '正文一', requirePlanApproval: true }))
  store.approveChapterPlan(root, { work, chapter: 1 })
  const written = store.writeChapter(root, { work, chapter: 1, title: '第一章', body: '周砚摸井台，井深二丈二尺。', requirePlanApproval: true })
  check('approved write lands', written.revision === 1 && written.words > 0, JSON.stringify(written))
  check('plan artifact is virtual', written.artifact.path === `works/${work}/chapters/ch-0001.md`, written.artifact.path)
  check('current body readable', store.readChapter(root, { work, chapter: 1 }).content.includes('井深'))
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
  const revised = store.reviseChapter(root, { work, chapter: 1, body: '修订版正文，多一拍。', problemIds: ['Q1'], mode: 'rewrite' })
  check('revision r3 and item closed', revised.revision === 3 && store.latestReview(root, work, 1).items[0].done === true)

  store.writeSummary(root, { work, chapter: 1, text: '周砚摸井台，发现第三人。' })
  check('summary roundtrip', store.readSummary(root, work, 1).includes('第三人'))
  throws('summary required', 'empty-summary', () => store.writeSummary(root, { work, chapter: 1, text: ' ' }))
  throws('delegated summary refuses an existing one', 'summary-exists',
    () => store.writeSummary(root, { work, chapter: 1, text: '覆盖', ifAbsent: true }))
  store.writeSummary(root, { work, chapter: 1, text: '手动覆盖。' })
  check('manual summary overwrites', store.readSummary(root, work, 1).includes('手动覆盖'))
  const capped = store.writeSummary(root, { work, chapter: 1, text: '长'.repeat(401) })
  check('summary caps at 400 code points', capped.truncated === true && [...store.readSummary(root, work, 1).trim()].length === 400
    && capped.chars === 401, JSON.stringify(capped))

  const state = store.foldState(root, {
    work, chapter: 1,
    entities: [{ name: '周砚', facts: ['摸过井台'] }],
    hooks: [{ text: '第三人是谁', state: 'opened' }],
  })
  check('events appended', state.appended === 2 && state.seq === 3, JSON.stringify({ appended: state.appended, seq: state.seq }))
  const events = store.readEvents(root, work, 1)
  check('events readable', events.length === 3 && events[0].name === '周砚', JSON.stringify(events))

  for (let number = 2; number <= 5; number += 1) {
    store.writePlan(root, { work, chapter: number, perspective: '周砚', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    store.writeChapter(root, { work, chapter: number, body: `第 ${number} 章正文。` })
  }
  const volume = store.writeVolume(root, { work, id: 'v1', title: '第一卷', from: 1, to: 5, summary: '开局' })
  check('volume written', volume.volume.id === 'v1' && store.readVolumes(root, work).length === 1)
  throws('unknown revise mode refused', 'revise-mode-violation',
    () => store.reviseChapter(root, { work, chapter: 1, body: '再来一版正文。', mode: 'nope' }))
  throws('patch mode needs problems', 'missing-problems',
    () => store.reviseChapter(root, { work, chapter: 1, body: '再来一版正文。', mode: 'patch' }))
  throws('resolving an unknown hook refused', 'hook-not-open',
    () => store.foldState(root, { work, chapter: 1, hooks: [{ text: '不存在', state: 'used' }] }))
  throws('empty state refused', 'empty-state', () => store.foldState(root, { work, chapter: 2 }))
  throws('volume range invalid', 'volume-invalid', () => store.writeVolume(root, { work, id: 'v2', from: 5, to: 2 }))
  throws('volume chapter must exist', 'chapter-not-found', () => store.writeVolume(root, { work, id: 'v2', from: 6, to: 7 }))

  // The current version and the revision history stay separate.
  check('revision 1 is still readable', store.readChapter(root, { work, chapter: 1, revision: 1 }).content.includes('井深'))
  check('review round is visible', store.readReview(root, work, 1).round === 1)
  check('status reflects the settled chapter', store.status(root, work).chapters[0].stage === 'settled')
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
