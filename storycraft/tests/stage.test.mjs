// Stage machine and action gates (A1a).
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import * as s from '../storage.js'
import * as b from '../bible.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function rejects(name, code, fn) {
  try {
    await fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-stage-'))
const plan = { work: '', chapter: 1, perspective: '林澈', goal: '救人', obstacle: '塌方', cost: '设备', turn: '北上' }
try {
  const created = await s.initWork(root, { title: '闸门测试' })
  const work = created.workId
  plan.work = work

  // planned → written: no plan means write is refused.
  await rejects('write without plan refused', 'plan-not-found', () => s.writeChapter(root, { work, chapter: 1, body: '正文'.repeat(50) }))
  await s.writePlan(root, plan)
  let status = await s.status(root, work)
  check('stage is planned after plan', status.chapters[0].stage === 'planned', JSON.stringify(status.chapters[0]))

  // review before body is refused.
  await rejects('review without body refused', 'body-not-found', () => s.writeReview(root, { work, chapter: 1, problems: [{ problem: 'x' }] }))

  await s.writeChapter(root, { work, chapter: 1, body: '他站在雨里。'.repeat(40) })
  status = await s.status(root, work)
  check('stage is written after body', status.chapters[0].stage === 'written', JSON.stringify(status.chapters[0]))

  // Settling without a review is refused.
  await rejects('settle without review refused', 'review-required', () => s.foldState(root, {
    work, chapter: 1, hooks: [{ text: '合同是假的', state: 'opened' }],
  }))

  const review = await s.writeReview(root, {
    work, chapter: 1,
    problems: [{ location: '开头', problem: '视角乱', suggestion: '统一视角' }, { location: '结尾', problem: '收得太快', suggestion: '补一拍' }],
  })
  status = await s.status(root, work)
  check('stage is reviewed after review', status.chapters[0].stage === 'reviewed', JSON.stringify(status.chapters[0]))

  // Open items block settling, and the message names them.
  let settleError
  try {
    await s.foldState(root, { work, chapter: 1, hooks: [{ text: '合同是假的', state: 'opened' }] })
  } catch (error) {
    settleError = error
  }
  check('open items block settle', settleError?.code === 'review-required', String(settleError?.code))
  check('blocked settle names the items', /Q1/.test(settleError?.message ?? ''), settleError?.message)

  await s.reviseChapter(root, { work, chapter: 1, body: '改后正文。'.repeat(40), problemIds: ['Q1', 'Q2'] })
  status = await s.status(root, work)
  check('stage is revised after revise', status.chapters[0].stage === 'revised', JSON.stringify(status.chapters[0]))

  await s.foldState(root, {
    work, chapter: 1,
    entities: [{ name: '林澈', facts: ['欠房租'] }],
    hooks: [{ text: '合同是假的', state: 'opened' }],
  })
  status = await s.status(root, work)
  check('stage is settled after settle', status.chapters[0].stage === 'settled', JSON.stringify(status.chapters[0]))

  // Settled chapters refuse plan edits and un-flagged rewrites.
  await rejects('settled chapter refuses plan edit', 'chapter-settled', () => s.writePlan(root, plan))
  await rejects('settled chapter refuses rewrite without reopen', 'chapter-settled', () => s.writeChapter(root, { work, chapter: 1, body: '乱改', rewrite: true }))

  // Reopen: body back to written, event appended, old settlement void.
  await s.writeChapter(root, { work, chapter: 1, body: '重写的一版。'.repeat(40), rewrite: true, reopen: true })
  status = await s.status(root, work)
  check('reopen returns to written', status.chapters[0].stage === 'written', JSON.stringify(status.chapters[0]))
  const events = await readFile(join(root, 'works', work, 'state', 'events.jsonl'), 'utf8')
  check('reopen event appended', events.includes('"kind":"reopen"'), events.split('\n').filter(Boolean).slice(-2).join(' | '))

  const folded = s.foldEvents(events)
  check('old settlement void after reopen', folded.hooks.length === 0, JSON.stringify(folded.hooks))

  // story_next drives the machine.
  let next = await s.nextStep(root, work)
  check('next suggests review after reopen write', next.action === 'story_review' && next.chapter === 1, JSON.stringify(next))

  // New chapter: next suggests plan, then write, then review, then settle.
  await s.writePlan(root, { ...plan, chapter: 2 })
  next = await s.nextStep(root, work)
  check('next suggests write for chapter 2', next.action === 'story_write' && next.chapter === 2, JSON.stringify(next))
  await s.writeChapter(root, { work, chapter: 2, body: '第二章正文。'.repeat(40) })
  next = await s.nextStep(root, work)
  check('next suggests review for chapter 2', next.action === 'story_review' && next.chapter === 2, JSON.stringify(next))
  await s.writeReview(root, { work, chapter: 2, problems: [{ problem: '节奏慢' }] })
  next = await s.nextStep(root, work)
  check('next suggests revise for chapter 2', next.action === 'story_revise' && next.missing.join(',') === 'Q1', JSON.stringify(next))
  await s.reviseChapter(root, { work, chapter: 2, body: '改过的第二章。'.repeat(40), problemIds: ['Q1'] })
  next = await s.nextStep(root, work)
  check('next asks for the summary before settling', next.action === 'story_summarize' && next.chapter === 2, JSON.stringify(next))
  await b.writeSummary(root, work, 2, '第二章摘要')
  next = await s.nextStep(root, work)
  check('next suggests settle for chapter 2', next.action === 'story_state', JSON.stringify(next))

  // Settle chapter 2 first, then reopen it alone (no rewrite flag).
  await s.foldState(root, {
    work, chapter: 2,
    entities: [{ name: '林澈', facts: ['找到旧墙'] }],
    hooks: [{ text: '旧墙上的字', state: 'opened' }],
  })
  const settledTwo = await s.status(root, work)
  check('chapter 2 settled', settledTwo.chapters[1].stage === 'settled', JSON.stringify(settledTwo.chapters[1]))
  // Reopen alone voids the settlement without touching the body, then the full
  // cycle runs again on the same body.
  const reopened2 = await s.reopenChapter(root, { work, chapter: 2 })
  check('reopen keeps the body and returns to written', reopened2.entry.stage === 'written' && reopened2.entry.currentRevision === 2, JSON.stringify(reopened2.entry))
  await rejects('reopen on an unsettled chapter refused', 'not-settled', () => s.reopenChapter(root, { work, chapter: 2 }))
  const newReview = await s.writeReview(root, { work, chapter: 2, problems: [{ problem: '补审一处' }] })
  const reviewedAgain = await s.status(root, work)
  check('review after reopen advanced the stage', reviewedAgain.chapters[1].stage === 'reviewed', JSON.stringify(reviewedAgain.chapters[1]))
  await s.reviseChapter(root, { work, chapter: 2, body: '重开后改的第二版。'.repeat(30), problemIds: ['Q1'] })
  await s.foldState(root, { work, chapter: 2, hooks: [{ text: '重开后的伏笔', state: 'opened' }] })
  const settledAgain = await s.status(root, work)
  check('settle after reopen works', settledAgain.chapters[1].stage === 'settled', JSON.stringify(settledAgain.chapters[1]))
  check('review round grew', newReview.artifact.path.includes('r2'), newReview.artifact.path)

  await rejects('settled chapter refuses plain write', 'chapter-settled', () => s.writeChapter(root, { work, chapter: 2, body: 'x' }))
  await s.writeChapter(root, { work, chapter: 2, body: '重开的第二章。'.repeat(40), reopen: true })
  const reopened = await s.status(root, work)
  check('reopen without rewrite flag works', reopened.chapters[1].stage === 'written', JSON.stringify(reopened.chapters[1]))

  // Legacy manifests without a stage field infer it from artifacts on read.
  const legacyWork = (await s.initWork(root, { title: '旧清单' })).workId
  await s.writePlan(root, { ...plan, work: legacyWork, chapter: 1 })
  await s.writeChapter(root, { work: legacyWork, chapter: 1, body: '旧清单正文。'.repeat(40) })
  await s.writeReview(root, { work: legacyWork, chapter: 1, problems: [{ problem: '一处小问题' }] })
  await s.reviseChapter(root, { work: legacyWork, chapter: 1, body: '旧清单改稿。'.repeat(40), problemIds: ['Q1'] })
  await s.foldState(root, { work: legacyWork, chapter: 1, hooks: [{ text: '旧墙', state: 'opened' }] })
  const legacyFile = join(root, 'works', legacyWork, 'manifest.json')
  const legacy = JSON.parse(await readFile(legacyFile, 'utf8'))
  delete legacy.chapters[0].stage
  delete legacy.chapters[0].status
  await writeFile(legacyFile, `${JSON.stringify(legacy, null, 2)}\n`)
  const inferred = await s.status(root, legacyWork)
  check('legacy settled chapter infers settled', inferred.chapters[0].stage === 'settled', JSON.stringify(inferred.chapters[0]))

  // State facts: one string is accepted; a bad record names the person.
  const factsWork = (await s.initWork(root, { title: '事实容错' })).workId
  await s.writePlan(root, { ...plan, work: factsWork, chapter: 1 })
  await s.writeChapter(root, { work: factsWork, chapter: 1, body: '事实正文。'.repeat(40) })
  await s.writeReview(root, { work: factsWork, chapter: 1, problems: [{ problem: '一处' }] })
  await s.reviseChapter(root, { work: factsWork, chapter: 1, body: '事实改稿。'.repeat(40), problemIds: ['Q1'] })
  const factsFolded = await s.foldState(root, {
    work: factsWork, chapter: 1, entities: [{ name: '林澈', facts: '欠三个月房租' }],
  })
  check('single-string facts accepted', factsFolded.counts.entities === 1, JSON.stringify(factsFolded.counts))
  await rejects('bad facts name the person', 'invalid-entity', () => s.foldState(root, {
    work: factsWork, chapter: 1, entities: [{ name: '沈彻' }],
  }))

  // Staging: a successful write leaves nothing behind, and an old leftover is
  // cleaned on the next write instead of being mistaken for a commit.
  const stagedWork = (await s.initWork(root, { title: '暂存验证' })).workId
  await s.writePlan(root, { ...plan, work: stagedWork, chapter: 1 })
  await s.writeChapter(root, { work: stagedWork, chapter: 1, body: '暂存正文。'.repeat(30) })
  const stagingDir = join(root, 'works', stagedWork, '.staging')
  check('no staging residue after a write', !existsSync(stagingDir) || readdirSync(stagingDir).length === 0)

  const leftover = join(stagingDir, 'write-1')
  mkdirSync(leftover, { recursive: true })
  await writeFile(join(leftover, 'x.md'), 'old\n')
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  await utimes(leftover, old, old)
  await s.writeChapter(root, { work: stagedWork, chapter: 1, body: '第二版。'.repeat(30), rewrite: true })
  check('stale staging cleaned on the next write', !existsSync(leftover), leftover)

  // A settled chapter without a summary asks for the summary first.
  const noSummaryWork = (await s.initWork(root, { title: '无摘要' })).workId
  await s.writeOutline(root, { work: noSummaryWork, mainline: '一条主线' })
  await s.approveOutline(root, { work: noSummaryWork })
  await s.writePlan(root, { ...plan, work: noSummaryWork, chapter: 1 })
  await s.writeChapter(root, { work: noSummaryWork, chapter: 1, body: '正文。'.repeat(40) })
  await s.writeReview(root, { work: noSummaryWork, chapter: 1, problems: [{ problem: '一处' }] })
  await s.reviseChapter(root, { work: noSummaryWork, chapter: 1, body: '改稿。'.repeat(40), problemIds: ['Q1'], mode: 'rewrite' })
  await s.foldState(root, { work: noSummaryWork, chapter: 1, hooks: [{ text: '一处伏笔', state: 'opened' }] })
  const afterSettle = await s.nextStep(root, noSummaryWork)
  check('next asks for a missing summary', afterSettle.action === 'story_summarize' && afterSettle.chapter === 1, JSON.stringify(afterSettle))
  await b.writeSummary(root, noSummaryWork, 1, '第一章摘要')
  const afterSummary = await s.nextStep(root, noSummaryWork)
  check('next moves on once the summary exists', afterSummary.action === 'story_plan' && afterSummary.chapter === 2, JSON.stringify(afterSummary))

  // A fresh work with no chapters points at chapter 1 plan.
  const empty = await s.initWork(root, { title: '空作品' })
  next = await s.nextStep(root, empty.workId)
  check('empty work starts with the book outline', next.action === 'story_outline' && next.chapter === 1, JSON.stringify(next))
  await s.writeOutline(root, { work: empty.workId, mainline: '一条主线' })
  next = await s.nextStep(root, empty.workId)
  check('written outline still waits for approval', next.action === 'story_outline' && /确认/.test(next.reason), JSON.stringify(next))
  await s.approveOutline(root, { work: empty.workId })
  next = await s.nextStep(root, empty.workId)
  check('approved outline moves to chapter 1 plan', next.action === 'story_plan' && next.chapter === 1, JSON.stringify(next))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
