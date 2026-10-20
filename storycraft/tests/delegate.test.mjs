// Host-side role delegation: preflight, fake child runs, landing and receipts.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { delegateRole } from '../delegate.js'
import * as s from '../storage.js'
import { writeBible } from '../bible.js'

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

/** A subagents service that returns queued results and records the specs. */
function fakeService(results) {
  const specs = []
  return {
    specs,
    startActivation(spec) {
      specs.push(spec)
      const result = results.shift()
      if (result === undefined) throw new Error('no fake result queued')
      if (result.error !== undefined) throw result.error
      return {
        result: Promise.resolve(result.value),
        dispose: async () => {},
      }
    },
  }
}

const completed = value => ({ value: { ...value, stopReason: 'completed' } })
const signal = new AbortController().signal
const agent = { id: 'parent' }

const root = await mkdtemp(join(tmpdir(), 'storycraft-delegate-'))
try {
  const { workId: work } = s.initWork(root, { title: '委派测试' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  await writeBible(root, work, 'characters', JSON.stringify([
    { name: '甲', role: '主视角', want: 'w', fear: 'f', limit: 'l', voice: 'v' },
  ]))

  // Before the body exists, the next step points at the writer and advertises a delegate.
  const before = s.nextStep(root, work)
  check('nextStep advertises writer delegation', before.action === 'story_write' && before.delegate?.role === 'writer', JSON.stringify(before))

  const writerService = fakeService([completed({
    output: [{ type: 'text', text: '<<<TITLE 第一章 TITLE>>>\n<<<CHAPTER 甲推开门，雨声进来了。TITLE 不算正文。CHAPTER>>>' }],
  })])
  const writer = await delegateRole(root, { work, chapter: 1, role: 'writer' }, { service: writerService, agent, signal })
  check('writer delegates and lands r1', writer.ok === true && writer.revision === 1 && writer.stage === 'written', JSON.stringify(writer))
  check('writer receipt carries no body', !('body' in writer) && !('sections' in writer), JSON.stringify(writer))
  check('writer receipt stays compact', JSON.stringify(writer).length <= 1500, String(JSON.stringify(writer).length))
  check('writer child prompt does not reach the receipt', !JSON.stringify(writer).includes('甲推开门'), JSON.stringify(writer))
  check('writer body landed', s.readChapter(root, { work, chapter: 1 }).content.includes('甲推开门'))

  // Reviewer: structured result maps where/problem/fix into the stored review.
  const reviewService = fakeService([completed({
    structured: { items: [{ where: '结尾', problem: '太快', impact: '读者跟不上', severity: 'major', fix: '补一拍', mode: 'patch' }] },
    output: [],
  })])
  const reviewer = await delegateRole(root, { work, chapter: 1, role: 'reviewer' }, { service: reviewService, agent, signal })
  check('reviewer delegates and lands one round', reviewer.ok === true && reviewer.reviewRound === 1 && reviewer.problems.total === 1, JSON.stringify(reviewer))
  const review = s.readReview(root, work, 1)
  check('review maps where/problem/fix', review.items[0].location === '结尾' && review.items[0].problem === '太快' && review.items[0].suggestion === '补一拍', JSON.stringify(review.items))
  check('reviewer child requested structured output', reviewService.specs[0].request.outputSchema !== undefined)
  const afterReview = s.nextStep(root, work)
  check('nextStep advertises reviser delegation', afterReview.action === 'story_revise' && afterReview.delegate?.role === 'reviser', JSON.stringify(afterReview))

  // Reviser: all open items are passed, the new body lands as r2.
  const reviserService = fakeService([completed({
    output: [{ type: 'text', text: '<<<CHAPTER 甲推开门，雨声进来了。他在门口停了一拍，才走进屋。CHAPTER>>>' }],
  })])
  const reviser = await delegateRole(root, { work, chapter: 1, role: 'reviser', mode: 'rewrite' }, { service: reviserService, agent, signal })
  check('reviser delegates and lands r2', reviser.ok === true && reviser.revision === 2 && reviser.stage === 'revised', JSON.stringify(reviser))
  check('reviser resolves open items', Array.isArray(reviser.resolved) && reviser.resolved.includes('Q1'), JSON.stringify(reviser.resolved))
  check('reviser receipt stays compact', JSON.stringify(reviser).length <= 1500)


  // Preflight failures happen before a child starts.
  const existingService = fakeService([])
  await rejects('writer refuses an existing body', 'chapter-exists',
    () => delegateRole(root, { work, chapter: 1, role: 'writer' }, { service: existingService, agent, signal }))
  check('preflight did not start a child', existingService.specs.length === 0, String(existingService.specs.length))
  // The delegated chapter can then settle through the existing summary/state actions.
  s.writeSummary(root, { work, chapter: 1, text: '甲回到屋里。' })
  s.foldState(root, { work, chapter: 1, entities: [{ name: '甲', facts: ['回到屋里'] }], hooks: [] })
  check('the delegated chapter settles', s.readManifest(root, work).chapters[0].stage === 'settled')
  check('the next step moves to the next chapter plan', s.nextStep(root, work).action === 'story_plan')

  s.writePlan(root, { work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 2 })
  await rejects('reviewer refuses a chapter without a body', 'chapter-not-written',
    () => delegateRole(root, { work, chapter: 2, role: 'reviewer' }, { service: fakeService([]), agent, signal }))
  await rejects('missing subagents service is reported', 'delegation-unavailable',
    () => delegateRole(root, { work, chapter: 2, role: 'reviewer' }, { service: undefined, agent, signal }))

  // Output contract failures do not land anything.
  const brokenService = fakeService([completed({ output: [{ type: 'text', text: '没有标记' }] })])
  await rejects('invalid output before writing is refused', 'delegation-output-invalid',
    () => delegateRole(root, { work, chapter: 2, role: 'writer' }, { service: brokenService, agent, signal }))
  check('failed writer did not create a body', s.readManifest(root, work).chapters.find(c => c.number === 2).currentRevision === 0)

  // A non-completed child maps to delegation-failed.
  const failedService = fakeService([{ value: { output: [], stopReason: 'error', diagnostic: 'model down' } }])
  await rejects('non-completed child is refused', 'delegation-failed',
    () => delegateRole(root, { work, chapter: 2, role: 'writer' }, { service: failedService, agent, signal }))

  // Cancellation and timeout settle as delegation-failed without landing.
  s.writePlan(root, { work, chapter: 3, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 3 })
  const pendingService = {
    startActivation: () => ({ result: new Promise(() => {}), dispose: async () => {} }),
  }
  const controller = new AbortController()
  const canceled = delegateRole(root, { work, chapter: 3, role: 'writer' }, { service: pendingService, agent, signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await rejects('cancellation is reported as delegation-failed', 'delegation-failed', () => canceled)
  await rejects('timeout is reported as delegation-failed', 'delegation-failed',
    () => delegateRole(root, { work, chapter: 3, role: 'writer' }, { service: pendingService, agent, signal, timeoutMs: 20 }))
  check('cancellation/timeout never led', s.readManifest(root, work).chapters.find(c => c.number === 3).currentRevision === 0)

  // Empty review and gate errors are explicit.
  s.writeChapter(root, { work, chapter: 3, title: '第三章', body: '第三章正文。'.repeat(20) })
  const emptyReviewService = fakeService([completed({ structured: { items: [] }, output: [] })])
  await rejects('empty review is refused', 'empty-review',
    () => delegateRole(root, { work, chapter: 3, role: 'reviewer' }, { service: emptyReviewService, agent, signal }))

  s.writePlan(root, { work, chapter: 4, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await rejects('unapproved plan is refused before the child', 'plan-not-approved',
    () => delegateRole(root, { work, chapter: 4, role: 'writer' }, { service: fakeService([]), agent, signal }))

  s.approveChapterPlan(root, { work, chapter: 4 })
  s.writeChapter(root, { work, chapter: 4, title: '第四章', body: '第四章正文。'.repeat(20) })
  await rejects('revision without a review is refused', 'review-required',
    () => delegateRole(root, { work, chapter: 4, role: 'reviser' }, { service: fakeService([]), agent, signal }))

  // The model-visible action wires the same delegation path through ctx.get.
  const { apply } = await import('../tools.js')
  const registered = []
  const hostService = fakeService([completed({
    output: [{ type: 'text', text: '<<<TITLE 第二章 TITLE>>>\n<<<CHAPTER 第二章正文。CHAPTER>>>' }],
  })])
  apply({
    tools: {
      register: (definition) => { registered.push(definition); return () => {} },
      guard: () => () => {},
    },
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
    get: name => (name === 'subagents' ? hostService : undefined),
  })
  const delegateAction = registered.find(definition => definition.name === 'story_delegate')
  const { setCurrent } = await import('../current.js')
  setCurrent('action-parent', work)
  const actionResult = await delegateAction.execute(
    { work, chapter: 2, role: 'writer' },
    { name: 'story_delegate', agent: { id: 'action-parent', session: { header: { cwd: root, delegationDepth: 0 } } } },
  )
  check('the action wires ctx.get(subagents)', actionResult.ok === true && actionResult.revision === 1, JSON.stringify(actionResult))
  check('the action receipt has no body', !JSON.stringify(actionResult).includes('第二章正文'), JSON.stringify(actionResult))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1




