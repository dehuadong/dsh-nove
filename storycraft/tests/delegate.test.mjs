// Host-side role delegation: preflight, fake child runs, landing and receipts.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { delegateRole } from '../src/delegate.ts'
import { checkWordRange } from '../src/landing.ts'
import { submitPayload } from '../src/submission.ts'
import * as s from '../src/storage.ts'
import { readArtifact } from '../src/artifact-store.ts'
import { writeBible } from '../src/bible.ts'
import { reviewFixture } from './review-fixture.mjs'

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

/** Convert legacy test fixtures into the structured payload the child submits. */
function payloadOf(value) {
  if (value.payload !== undefined) return value.payload
  if (value.structured?.items !== undefined) return { items: value.structured.items }
  const text = (value.output ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
  const chapter = /<<<CHAPTER\s*([\s\S]*?)\s*CHAPTER>>>/u.exec(text)?.[1]?.trim()
  if (chapter !== undefined) {
    return { title: /<<<TITLE\s*([\s\S]*?)\s*TITLE>>>/u.exec(text)?.[1]?.trim() ?? '测试章', body: chapter }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }
  return undefined
}

/** A subagents service that submits queued fixtures through the real seam. */
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
        result: (async () => {
          const id = /delegationId 是 ([0-9a-f-]+)/u.exec(spec.request.prompt[0].text)?.[1]
          const payload = payloadOf(result.value)
          if (payload === undefined) return { ...result.value }
          const submitted = await submitPayload({ delegationId: id, depth: 1, root: spec.request.cwd, payload })
          return { ...result.value, stopReason: 'completed', submitted }
        })(),
        dispose: async () => {},
      }
    },
  }
}

const completed = value => ({ value: { ...value, stopReason: 'completed' } })
const signal = new AbortController().signal
const agent = { id: 'parent' }

const range = { min: 10, max: 20 }
try {
  checkWordRange({ role: 'writer', body: '字'.repeat(5), chapter: 1, wordRange: range })
  check('writer short range is refused', false, 'no error')
} catch (error) {
  check('writer short range is refused', error.code === 'delegation-word-range', String(error.code))
}
try {
  checkWordRange({ role: 'writer', body: '字'.repeat(25), chapter: 1, wordRange: range })
  check('writer over max is refused', false, 'no error')
} catch (error) {
  check('writer over max is refused', error.code === 'delegation-word-range', String(error.code))
}
try {
  checkWordRange({ role: 'reviser', mode: 'deslop', body: '字'.repeat(25), chapter: 1, wordRange: range })
  check('deslop over max asks the author', false, 'no error')
} catch (error) {
  check('deslop over max asks the author', error.code === 'delegation-word-range' && error.message.includes('deslop 仍超限'), String(error.message))
}
try {
  checkWordRange({ role: 'reviser', body: '字'.repeat(25), chapter: 1, wordRange: range })
  check('reviser over max is refused', false, 'no error')
} catch (error) {
  check('reviser over max is refused', error.code === 'delegation-word-range', String(error.code))
}
try {
  checkWordRange({ role: 'reviser', body: '字'.repeat(5), chapter: 1, wordRange: range })
  check('reviser below min is refused', false, 'no error')
} catch (error) {
  check('reviser below min is refused', error.code === 'delegation-word-range', String(error.code))
}
check('in-range writer passes', checkWordRange({ role: 'writer', body: '字'.repeat(15), chapter: 1, wordRange: range }).warnings.length === 0)
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

  // Planner: outline approved, no plan yet; the delegate writes plan:<n> only.
  const plannerWork = s.initWork(root, { title: '规划委派' }).workId
  s.writeOutline(root, { work: plannerWork, mainline: '一条主线' })
  s.approveOutline(root, { work: plannerWork })
  const plannerNext = s.nextStep(root, plannerWork)
  check('nextStep advertises planner delegation', plannerNext.action === 'story_plan' && plannerNext.delegate?.role === 'planner', JSON.stringify(plannerNext))
  const plannerService = fakeService([completed({
    payload: {
      perspective: '甲', goal: '查清旧案', obstacle: '证人失踪', cost: '失去靠山', turn: '发现证人是自己人',
      body: '本章章纲正文。', threadRefs: [],
    },
  })])
  const planner = await delegateRole(root, { work: plannerWork, chapter: 1, role: 'planner' }, { service: plannerService, agent, signal })
  check('planner delegates and lands an unapproved plan', planner.ok === true && planner.role === 'planner' && planner.planApproved === false && planner.stage === 'planned', JSON.stringify(planner))
  check('planner receipt carries no plan body', !('body' in planner) && !('threadRefs' in planner), JSON.stringify(planner))
  check('planner prompt names the plan-craft skill', plannerService.specs[0].request.prompt[0].text.includes('storycraft-plan-craft'))
  const storedPlan = s.readPlan(root, plannerWork, 1)
  check('planner plan lands under the bound work/chapter', typeof storedPlan === 'string' && storedPlan.includes('查清旧案') && planner.artifact?.artifactId === 'plan:1', String(storedPlan))
  const plannerTrace = readArtifact(root, { work: plannerWork, artifactId: 'trace:1:planner' })
  check('the planner dispatch records its context trace',
    plannerTrace.artifact.kind === 'trace' && plannerTrace.artifact.content.chapter === 1
    && plannerTrace.artifact.content.budget.unit === 'tokens', JSON.stringify(plannerTrace.artifact.content).slice(0, 200))
  await rejects('planner refuses to overwrite an existing plan', 'plan-exists',
    () => delegateRole(root, { work: plannerWork, chapter: 1, role: 'planner' }, { service: fakeService([]), agent, signal }))

  const blockedPlan = s.initWork(root, { title: '待确认计划' }).workId
  s.writeOutline(root, { work: blockedPlan, mainline: '一条主线' })
  const blockedNext = s.nextStep(root, blockedPlan)
  check('outline-blocked plan step does not advertise planner',
    blockedNext.action === 'story_plan' && blockedNext.blocked?.includes('outline-approval') && blockedNext.delegate === undefined,
    JSON.stringify(blockedNext))

  const shortPlanWork = s.initWork(root, { title: '短篇不委派规划', form: 'short' }).workId
  s.writeOutline(root, { work: shortPlanWork, mainline: '一条主线' })
  s.approveOutline(root, { work: shortPlanWork })
  const shortPlanNext = s.nextStep(root, shortPlanWork)
  check('short form does not advertise planner delegation',
    shortPlanNext.action === 'story_plan' && shortPlanNext.delegate === undefined, JSON.stringify(shortPlanNext))

  const unavailablePlan = s.initWork(root, { title: '无服务规划' }).workId
  s.writeOutline(root, { work: unavailablePlan, mainline: '一条主线' })
  s.approveOutline(root, { work: unavailablePlan })
  await rejects('planner reports unavailable service', 'delegation-unavailable',
    () => delegateRole(root, { work: unavailablePlan, chapter: 1, role: 'planner' }, { agent, signal }))

  const emptyPlanService = fakeService([completed({})])
  await rejects('planner without submission does not land a plan', 'delegation-no-submission',
    () => delegateRole(root, { work: unavailablePlan, chapter: 1, role: 'planner' }, { service: emptyPlanService, agent, signal }))
  check('planner no-submission wrote no plan', s.readPlan(root, unavailablePlan, 1) === undefined)

  // Without an approved outline the planner is not started.
  const noOutline = s.initWork(root, { title: '无计划' }).workId
  await rejects('planner requires an approved outline', 'outline-required',
    () => delegateRole(root, { work: noOutline, chapter: 1, role: 'planner' }, { service: fakeService([]), agent, signal }))


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
  check('writer receipt reports submission attempts', writer.submissionAttempts === 1, JSON.stringify(writer))
  const writerPrompt = writerService.specs[0].request.prompt[0].text
  check('long-form writer prompt names form and unit', writerPrompt.split('\n')[0] === '你是长篇小说《委派测试》（委派测试）的写手子代理，负责第 1 章。', writerPrompt.split('\n')[0])
  check('long-form writer prompt loads one generic craft skill',
    writerPrompt.split('storycraft-write-craft').length - 1 === 1 && !writerPrompt.includes('storycraft-short-story') && !writerPrompt.includes('storycraft-short-drama'),
    writerPrompt.split('\n')[1])
  check('writer body landed', s.readChapter(root, { work, chapter: 1 }).content.includes('甲推开门'))

  // Form-aware writer routing: short adds the short-fiction method, script the script method.
  const short = s.initWork(root, { title: '短篇委派', form: 'short' }).workId
  await writeBible(root, short, 'characters', JSON.stringify([{ name: '甲', role: '主视角', want: 'w', fear: 'f', limit: 'l', voice: 'v' }]))
  s.writePlan(root, { work: short, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: short, chapter: 1 })
  const shortService = fakeService([completed({ payload: { title: '短篇', body: '甲推开门，雨声进来了。' } })])
  await delegateRole(root, { work: short, chapter: 1, role: 'writer' }, { service: shortService, agent, signal })
  const shortPrompt = shortService.specs[0].request.prompt[0].text
  check('short writer prompt names form and unit', shortPrompt.startsWith('你是短篇小说《短篇委派》') && shortPrompt.includes('负责第 1 篇。'), shortPrompt.split('\n')[0])
  check('short writer prompt loads generic and short skills', shortPrompt.includes('storycraft-write-craft') && shortPrompt.includes('storycraft-short-story'), shortPrompt.split('\n')[1])

  const script = s.initWork(root, { title: '剧本委派', form: 'script' }).workId
  await writeBible(root, script, 'characters', JSON.stringify([{ name: '甲', role: '主视角', want: 'w', fear: 'f', limit: 'l', voice: 'v' }]))
  s.writePlan(root, { work: script, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: script, chapter: 1 })
  const scriptService = fakeService([completed({ payload: { title: '第一集', body: '甲推开门，雨声进来了。' } })])
  await delegateRole(root, { work: script, chapter: 1, role: 'writer' }, { service: scriptService, agent, signal })
  const scriptPrompt = scriptService.specs[0].request.prompt[0].text
  check('script writer prompt names form and unit', scriptPrompt.startsWith('你是剧本《剧本委派》') && scriptPrompt.includes('负责第 1 集。'), scriptPrompt.split('\n')[0])
  check('script writer prompt loads generic and script skills', scriptPrompt.includes('storycraft-write-craft') && scriptPrompt.includes('storycraft-short-drama'), scriptPrompt.split('\n')[1])

  const shortReviewService = fakeService([completed({ structured: { items: [{ quote: '甲推开门，雨声进来了。', problem: '太快', impact: '读者跟不上', severity: 'minor', fix: '补一拍', mode: 'patch' }] } })])
  await delegateRole(root, { work: short, chapter: 1, role: 'reviewer' }, { service: shortReviewService, agent, signal })
  const shortReviewPrompt = shortReviewService.specs[0].request.prompt[0].text
  check('short reviewer prompt keeps form label and role skill only',
    shortReviewPrompt.startsWith('你是短篇小说《短篇委派》') && shortReviewPrompt.includes('storycraft-review') && !shortReviewPrompt.includes('storycraft-short-story'),
    shortReviewPrompt.split('\n').slice(0, 2).join(' / '))

  const shortReviserService = fakeService([completed({ payload: { body: '甲推开门，雨声进来了。他在门口停了一拍。' } })])
  await delegateRole(root, { work: short, chapter: 1, role: 'reviser', mode: 'rewrite' }, { service: shortReviserService, agent, signal })
  const shortReviserPrompt = shortReviserService.specs[0].request.prompt[0].text
  check('short reviser prompt keeps form label and role skill only',
    shortReviserPrompt.startsWith('你是短篇小说《短篇委派》') && shortReviserPrompt.includes('storycraft-revise-craft') && !shortReviserPrompt.includes('storycraft-short-story'),
    shortReviserPrompt.split('\n').slice(0, 2).join(' / '))

  // Reviewer: structured result maps where/problem/fix into the stored review.
  const reviewService = fakeService([completed({
    structured: { items: [{ quote: '甲推开门，雨声进来了。', problem: '太快', impact: '读者跟不上', severity: 'major', fix: '补一拍', mode: 'patch' }] },
    output: [],
  })])
  const reviewer = await delegateRole(root, { work, chapter: 1, role: 'reviewer' }, { service: reviewService, agent, signal })
  check('reviewer delegates and lands one round', reviewer.ok === true && reviewer.reviewRound === 1 && reviewer.problems.total === 1, JSON.stringify(reviewer))
  const review = s.readReview(root, work, 1)
  check('review maps where/problem/fix', review.items[0].location === '甲推开门，雨声进来了。' && review.items[0].problem === '太快' && review.items[0].suggestion === '补一拍', JSON.stringify(review.items))
  check('reviewer prompt carries story_submit', reviewService.specs[0].request.prompt[0].text.includes('story_submit'))
  const afterReview = s.nextStep(root, work)
  check('nextStep advertises reviser delegation', afterReview.action === 'story_revise' && afterReview.delegate?.role === 'reviser', JSON.stringify(afterReview))

  // Reviser: all open items are passed, the new body lands as r2.
  const reviserService = fakeService([completed({
    output: [{ type: 'text', text: '<<<CHAPTER 甲推开门，雨声进来了。他在门口停了一拍，才走进屋。CHAPTER>>>' }],
  })])
  const reviser = await delegateRole(root, { work, chapter: 1, role: 'reviser', mode: 'rewrite' }, { service: reviserService, agent, signal })
  check('reviser delegates and lands r2', reviser.ok === true && reviser.revision === 2 && reviser.stage === 'revised', JSON.stringify(reviser))
  check('reviser resolves open items', Array.isArray(reviser.resolved) && reviser.resolved.includes('O1'), JSON.stringify(reviser.resolved))
  check('reviser receipt carries mode and attempts', reviser.lastMode === 'rewrite' && reviser.submissionAttempts === 1, JSON.stringify(reviser))
  check('reviser receipt stays compact', JSON.stringify(reviser).length <= 1500)
  const cleanService = fakeService([completed({ structured: { items: [] } })])
  await delegateRole(root, { work, chapter: 1, role: 'reviewer' }, { service: cleanService, agent, signal })

  // Summarizer: the chapter is revised and still has no summary.
  const beforeSummary = s.nextStep(root, work)
  check('nextStep advertises summarizer delegation',
    beforeSummary.action === 'story_summarize' && beforeSummary.delegate?.role === 'summarizer', JSON.stringify(beforeSummary))
  await rejects('summarizer reports a missing service', 'delegation-unavailable',
    () => delegateRole(root, { work, chapter: 1, role: 'summarizer' }, { service: undefined, agent, signal }))
  check('missing service wrote no summary', s.readSummary(root, work, 1) === undefined)
  await rejects('summarizer reports no submission', 'delegation-no-submission',
    () => delegateRole(root, { work, chapter: 1, role: 'summarizer' }, { service: fakeService([completed({})]), agent, signal }))
  check('no submission wrote no summary', s.readSummary(root, work, 1) === undefined)
  const summarizerService = fakeService([completed({ payload: { rawText: '甲回到屋里。', title: '回屋' } })])
  const summarizer = await delegateRole(root, { work, chapter: 1, role: 'summarizer' }, { service: summarizerService, agent, signal })
  check('summarizer delegates and lands', summarizer.ok === true && summarizer.summaryChars === 6 && summarizer.artifact?.kind === 'summary', JSON.stringify(summarizer))
  check('summarizer receipt carries attempts and no text',
    summarizer.submissionAttempts === 1 && !JSON.stringify(summarizer).includes('甲回到屋里。'), JSON.stringify(summarizer))
  check('summarizer wrote the summary', s.readSummary(root, work, 1)?.includes('甲回到屋里'), s.readSummary(root, work, 1))
  check('summary step moves to automatic settlement', s.nextStep(root, work).action === 'story_settle', JSON.stringify(s.nextStep(root, work)))
  reviewFixture(root, { work, chapter: 1, problems: [{ location: '结尾', problem: '再收一拍', suggestion: '补一句' }] })
  s.reviseChapter(root, { work, chapter: 1, body: '甲回到屋里，又出门看了一眼。'.repeat(20), problemIds: ['O1'], mode: 'rewrite' })
  check('a later revision makes the summary stale', s.readSummaryState(root, work, 1).state === 'stale')
  const cleanAgain = fakeService([completed({ structured: { items: [] } })])
  await delegateRole(root, { work, chapter: 1, role: 'reviewer' }, { service: cleanAgain, agent, signal })
  const staleService = fakeService([completed({ payload: { rawText: '甲回到屋里，又出门看了一眼。' } })])
  const staleRewrite = await delegateRole(root, { work, chapter: 1, role: 'summarizer' }, { service: staleService, agent, signal })
  check('summarizer is allowed to rebind a stale summary', staleRewrite.ok === true
    && s.readSummaryState(root, work, 1).state === 'current', JSON.stringify(staleRewrite))
  await rejects('a second summarizer is refused', 'summary-exists',
    () => delegateRole(root, { work, chapter: 1, role: 'summarizer' }, { service: fakeService([]), agent, signal }))

  // Preflight failures happen before a child starts.
  const existingService = fakeService([])
  await rejects('writer refuses an existing body', 'chapter-exists',
    () => delegateRole(root, { work, chapter: 1, role: 'writer' }, { service: existingService, agent, signal }))
  check('preflight did not start a child', existingService.specs.length === 0, String(existingService.specs.length))
  // The delegated chapter can then settle through the existing state action.
  s.settleState(root, { work, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '回到屋里' }] } })
  check('the delegated chapter settles', s.readManifest(root, work).chapters[0].stage === 'settled')
  check('the next step moves to the next chapter plan', s.nextStep(root, work).action === 'story_plan')
  await rejects('a settled chapter is refused', 'chapter-settled',
    () => delegateRole(root, { work, chapter: 1, role: 'reviewer' }, { service: fakeService([]), agent, signal }))

  s.writePlan(root, { work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 2 })
  await rejects('reviewer refuses a chapter without a body', 'chapter-not-written',
    () => delegateRole(root, { work, chapter: 2, role: 'reviewer' }, { service: fakeService([]), agent, signal }))
  await rejects('missing subagents service is reported', 'delegation-unavailable',
    () => delegateRole(root, { work, chapter: 2, role: 'reviewer' }, { service: undefined, agent, signal }))

  // Output contract failures do not land anything.
  const brokenService = fakeService([completed({ output: [{ type: 'text', text: '没有标记' }] })])
  await rejects('invalid output before writing is refused', 'delegation-no-submission',
    () => delegateRole(root, { work, chapter: 2, role: 'writer' }, { service: brokenService, agent, signal }))
  check('failed writer did not create a body', s.readManifest(root, work).chapters.find(c => c.number === 2).currentRevision === 0)

  // A word-ranged work: writer gate, reviser max gate and mode retry.
  const rangeWork = s.initWork(root, { title: '范围测试', wordRange: { min: 50, max: 80 } })
  s.writeOutline(root, { work: rangeWork.workId, mainline: '一条主线' })
  s.approveOutline(root, { work: rangeWork.workId })
  s.writePlan(root, { work: rangeWork.workId, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: rangeWork.workId, chapter: 1 })
  await writeBible(root, rangeWork.workId, 'characters', JSON.stringify([
    { name: '甲', role: '主视角', want: 'w', fear: 'f', limit: 'l', voice: 'v' },
  ]))
  const shortWriterService = fakeService([completed({
    output: [{ type: 'text', text: '<<<TITLE 短稿 TITLE>>>\n<<<CHAPTER 太短。CHAPTER>>>' }],
  })])
  await rejects('writer below the word range is refused', 'delegation-no-submission',
    () => delegateRole(root, { work: rangeWork.workId, chapter: 1, role: 'writer' }, { service: shortWriterService, agent, signal }))
  check('the refused short writer did not land', s.readManifest(root, rangeWork.workId).chapters.find(c => c.number === 1).currentRevision === 0)

  const baseBody = '甲在雨里走。'.repeat(10)
  const rangedWriterService = fakeService([completed({
    output: [{ type: 'text', text: `<<<TITLE 雨里 TITLE>>>\n<<<CHAPTER ${baseBody} CHAPTER>>>` }],
  })])
  const rangedWrite = await delegateRole(root, { work: rangeWork.workId, chapter: 1, role: 'writer' }, { service: rangedWriterService, agent, signal })
  check('writer in range lands', rangedWrite.ok === true && rangedWrite.words >= 50 && rangedWrite.words <= 80, JSON.stringify(rangedWrite))
  reviewFixture(root, { work: rangeWork.workId, chapter: 1, problems: [{ location: '开头', problem: '慢' }] })

  const overMaxService = fakeService([completed({
    output: [{ type: 'text', text: `<<<CHAPTER ${'字'.repeat(100)} CHAPTER>>>` }],
  })])
  await rejects('reviser over max is refused', 'delegation-no-submission',
    () => delegateRole(root, { work: rangeWork.workId, chapter: 1, role: 'reviser', mode: 'rewrite' }, { service: overMaxService, agent, signal }))

  const patchService = fakeService([completed({
    output: [{ type: 'text', text: `<<<CHAPTER ${'字'.repeat(70)} CHAPTER>>>` }],
  })])
  await rejects('a patch over 20% is refused', 'delegation-no-submission',
    () => delegateRole(root, { work: rangeWork.workId, chapter: 1, role: 'reviser', mode: 'patch' }, { service: patchService, agent, signal }))

  const polishService = fakeService([completed({
    output: [{ type: 'text', text: `<<<CHAPTER ${'字'.repeat(75)} CHAPTER>>>` }],
  })])
  await rejects('a polish over 40% is refused', 'delegation-no-submission',
    () => delegateRole(root, { work: rangeWork.workId, chapter: 1, role: 'reviser', mode: 'polish' }, { service: polishService, agent, signal }))

  const rewriteService = fakeService([completed({
    output: [{ type: 'text', text: `<<<CHAPTER ${'字'.repeat(75)} CHAPTER>>>` }],
  })])
  const rewritten = await delegateRole(root, { work: rangeWork.workId, chapter: 1, role: 'reviser', mode: 'rewrite' }, { service: rewriteService, agent, signal })
  check('the editor can retry the reviser with rewrite', rewritten.ok === true && rewritten.revision === 2, JSON.stringify(rewritten))
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

  // Empty review is a valid clean pass.
  s.writeChapter(root, { work, chapter: 3, title: '第三章', body: '第三章正文。'.repeat(20) })
  const emptyReviewService = fakeService([completed({ structured: { items: [] }, output: [] })])
  const cleanReview = await delegateRole(root, { work, chapter: 3, role: 'reviewer' }, { service: emptyReviewService, agent, signal })
  check('empty review is recorded as a clean pass',
    cleanReview.ok === true && cleanReview.problems?.total === 0, JSON.stringify(cleanReview))
  const afterClean = s.nextStep(root, work)
  check('clean review advertises summarizer delegation',
    afterClean.action === 'story_summarize' && afterClean.delegate?.role === 'summarizer', JSON.stringify(afterClean))

  s.writePlan(root, { work, chapter: 4, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await rejects('unapproved plan is refused before the child', 'plan-not-approved',
    () => delegateRole(root, { work, chapter: 4, role: 'writer' }, { service: fakeService([]), agent, signal }))

  s.approveChapterPlan(root, { work, chapter: 4 })
  s.writeChapter(root, { work, chapter: 4, title: '第四章', body: '第四章正文。'.repeat(20) })
  await rejects('revision without a review is refused', 'review-required',
    () => delegateRole(root, { work, chapter: 4, role: 'reviser' }, { service: fakeService([]), agent, signal }))

  // The model-visible action wires the same delegation path through ctx.get.
  const { apply } = await import('../src/tools.ts')
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
  const { setCurrent } = await import('../src/current.ts')
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
