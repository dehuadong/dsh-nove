// Stage machine and action gates (A1a).
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'

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
  check('next suggests settle for chapter 2', next.action === 'story_state', JSON.stringify(next))

  // A fresh work with no chapters points at chapter 1 plan.
  const empty = await s.initWork(root, { title: '空作品' })
  next = await s.nextStep(root, empty.workId)
  check('empty work next is chapter 1 plan', next.action === 'story_plan' && next.chapter === 1, JSON.stringify(next))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
