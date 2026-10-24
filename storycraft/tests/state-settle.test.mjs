// Automatic settler settlement: gate preflight, settler -> R9b check, one retry,
// empty delta, unresolved no-write, and infrastructure failures.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settleChapterState } from '../state-settle.js'
import { submitPayload } from '../submission.js'
import * as s from '../storage.js'
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

function fakeService(script) {
  const specs = []
  return {
    specs,
    startActivation(spec) {
      specs.push(spec)
      const prompt = spec.request.prompt[0].text
      const step = script.shift()
      if (step === undefined) throw new Error('no fake result queued')
      if (step.error !== undefined) throw step.error
      return {
        result: (async () => {
          if (typeof step.before === 'function') await step.before(spec)
          const id = /delegationId 是 ([0-9a-f-]+)/u.exec(prompt)?.[1]
          if (step.payload === undefined) return { stopReason: 'completed' }
          const submitted = await submitPayload({
            delegationId: id, depth: 1, root: spec.request.cwd, payload: step.payload,
          })
          return { stopReason: 'completed', submitted }
        })(),
        dispose: async () => {},
      }
    },
  }
}

const signal = new AbortController().signal
const agent = { id: 'parent' }
const body = '甲推开门，雨声进来了。韩松说：「松手。」'
const factPayload = { factOps: { upsert: [{ subject: '甲', predicate: '动作', object: '推开门' }] } }
const emptyPayload = {}
const badHookPayload = { hookOps: { resolve: ['h-missing'] } }
const minorFinding = {
  code: 'fact-ambiguous', where: '甲', problem: '只能推断', evidence: '甲推开门',
  impact: '可能记错', severity: 'minor', fix: '确认或补证据',
}
const majorFinding = {
  code: 'fact-unsupported', where: '韩松', problem: '不是他挡的', evidence: '韩松说：「松手。」',
  impact: '归属错', severity: 'major', fix: '改记韩松',
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-state-settle-'))
const project = dirname(dirname(fileURLToPath(import.meta.url)))
try {
  const makeWork = title => {
    const { workId } = s.initWork(root, { title })
    s.writeOutline(root, { work: workId, mainline: '一条主线' })
    s.approveOutline(root, { work: workId })
    return workId
  }
  const makeChapter = (work, text = body, number = 1) => {
    s.writePlan(root, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work, chapter: number })
    s.writeChapter(root, { work, chapter: number, title: `第${number}章`, body: text })
    reviewFixture(root, { work, chapter: number, observations: [] })
    s.writeSummary(root, { work, chapter: number, text: '本章摘要。' })
  }

  const successWork = makeWork('自动成功')
  makeChapter(successWork)
  check('story_next points at automatic settlement',
    s.nextStep(root, successWork).action === 'story_settle', JSON.stringify(s.nextStep(root, successWork)))
  const successService = fakeService([
    { payload: factPayload },
    { payload: { items: [] } },
  ])
  const success = await settleChapterState(root, { work: successWork, chapter: 1 }, {
    service: successService, agent, signal,
  })
  check('automatic settlement lands the settler delta', success.settled === true
    && success.revision === 1 && success.counts.facts === 1 && success.counts.hooks === 0, JSON.stringify(success))
  check('automatic settlement reports attempts', success.attempts.settler === 1
    && success.attempts.validator === 1, JSON.stringify(success.attempts))
  check('automatic settlement settles the chapter',
    s.readManifest(root, successWork).chapters[0].stage === 'settled'
    && s.readEvents(root, successWork).length === 2, JSON.stringify(s.readManifest(root, successWork).chapters[0]))

  const emptyWork = makeWork('空状态')
  makeChapter(emptyWork)
  const emptyService = fakeService([{ payload: emptyPayload }])
  const empty = await settleChapterState(root, { work: emptyWork, chapter: 1 }, {
    service: emptyService, agent, signal,
  })
  check('an empty settler delta still settles', empty.settled === true
    && empty.counts.facts === 0 && empty.attempts.validator === 0
    && s.readEvents(root, emptyWork).length === 1, JSON.stringify(empty))

  const minorWork = makeWork('次要发现')
  makeChapter(minorWork)
  const minorService = fakeService([
    { payload: factPayload },
    { payload: { items: [minorFinding] } },
  ])
  const minor = await settleChapterState(root, { work: minorWork, chapter: 1 }, {
    service: minorService, agent, signal,
  })
  check('minor findings settle with warnings', minor.settled === true
    && minor.warnings.some(warning => warning.startsWith('fact-ambiguous:'))
    && minor.attempts.settler === 1, JSON.stringify(minor))

  const retryWork = makeWork('反馈重算')
  makeChapter(retryWork)
  const retryService = fakeService([
    { payload: factPayload },
    { payload: { items: [majorFinding] } },
    { payload: { factOps: { upsert: [{ subject: '甲', predicate: '动作', object: '推开门的动作被看见' }] } } },
    { payload: { items: [] } },
  ])
  const retry = await settleChapterState(root, { work: retryWork, chapter: 1 }, {
    service: retryService, agent, signal,
  })
  check('a major finding triggers one feedback retry', retry.settled === true
    && retry.attempts.settler === 2 && retry.attempts.validator === 2, JSON.stringify(retry))
  check('the retry prompt carries the feedback',
    retryService.specs[2].request.prompt[0].text.includes('上一次结算的反馈')
    && retryService.specs[2].request.prompt[0].text.includes('fact-unsupported'),
    retryService.specs[2].request.prompt[0].text.slice(0, 300))

  const emptyRetryWork = makeWork('重算为空')
  makeChapter(emptyRetryWork)
  const emptyRetryService = fakeService([
    { payload: factPayload },
    { payload: { items: [majorFinding] } },
    { payload: emptyPayload },
  ])
  const emptyRetry = await settleChapterState(root, { work: emptyRetryWork, chapter: 1 }, {
    service: emptyRetryService, agent, signal,
  })
  check('an empty retry after a major finding stays unresolved',
    emptyRetry.settled === false && emptyRetry.reason === 'state-reconcile-required'
    && emptyRetry.items.some(item => item.code === 'fact-unsupported')
    && s.readEvents(root, emptyRetryWork).length === 0, JSON.stringify(emptyRetry))

  const unresolvedWork = makeWork('仍未解决')
  makeChapter(unresolvedWork)
  const unresolvedService = fakeService([
    { payload: factPayload },
    { payload: { items: [majorFinding] } },
    { payload: factPayload },
    { payload: { items: [majorFinding] } },
  ])
  const unresolved = await settleChapterState(root, { work: unresolvedWork, chapter: 1 }, {
    service: unresolvedService, agent, signal,
  })
  check('two major attempts stay unsettled without writes',
    unresolved.settled === false && unresolved.reason === 'state-reconcile-required'
    && unresolved.items.length === 1 && s.readEvents(root, unresolvedWork).length === 0
    && s.readManifest(root, unresolvedWork).chapters[0].stage !== 'settled', JSON.stringify(unresolved))

  const invalidWork = makeWork('非法 delta')
  makeChapter(invalidWork)
  const invalidService = fakeService([
    { payload: badHookPayload },
    { payload: badHookPayload },
  ])
  const invalid = await settleChapterState(root, { work: invalidWork, chapter: 1 }, {
    service: invalidService, agent, signal,
  })
  check('two deterministic-invalid deltas stay unsettled', invalid.settled === false
    && invalid.reason === 'state-invalid' && s.readEvents(root, invalidWork).length === 0
    && s.readManifest(root, invalidWork).chapters[0].currentRevision === 1
    && s.readManifest(root, invalidWork).chapters[0].stage !== 'settled',
  JSON.stringify(invalid))

  const gateWork = makeWork('闸门')
  s.writePlan(root, { work: gateWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  const gateService = fakeService([])
  await rejects('a chapter without a body is refused before a child', 'chapter-not-written',
    () => settleChapterState(root, { work: gateWork, chapter: 1 }, { service: gateService, agent, signal }))
  check('a gate failure starts no child', gateService.specs.length === 0, String(gateService.specs.length))
  await rejects('manual settleState keeps the same gate order', 'review-required',
    () => s.settleState(root, { work: gateWork, chapter: 1, factOps: factPayload.factOps }))

  const noSummaryWork = makeWork('缺摘要')
  s.writePlan(root, { work: noSummaryWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: noSummaryWork, chapter: 1 })
  s.writeChapter(root, { work: noSummaryWork, chapter: 1, title: '一', body: '甲推开门。' })
  reviewFixture(root, { work: noSummaryWork, chapter: 1, observations: [] })
  const noSummaryService = fakeService([])
  await rejects('a missing summary is refused before a child', 'summary-required',
    () => settleChapterState(root, { work: noSummaryWork, chapter: 1 }, { service: noSummaryService, agent, signal }))
  check('a missing summary starts no child', noSummaryService.specs.length === 0, String(noSummaryService.specs.length))

  const openReviewWork = makeWork('未处理审稿')
  s.writePlan(root, { work: openReviewWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: openReviewWork, chapter: 1 })
  s.writeChapter(root, { work: openReviewWork, chapter: 1, title: '一', body: '甲推开门。' })
  reviewFixture(root, { work: openReviewWork, chapter: 1, problems: [{ location: '开头', problem: '慢' }] })
  s.writeSummary(root, { work: openReviewWork, chapter: 1, text: '摘要。' })
  const openReviewService = fakeService([])
  await rejects('unprocessed review is refused before a child', 'review-required',
    () => settleChapterState(root, { work: openReviewWork, chapter: 1 }, { service: openReviewService, agent, signal }))
  check('unprocessed review starts no child', openReviewService.specs.length === 0, String(openReviewService.specs.length))

  const noReviewWork = makeWork('缺审稿')
  s.writePlan(root, { work: noReviewWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: noReviewWork, chapter: 1 })
  s.writeChapter(root, { work: noReviewWork, chapter: 1, title: '一', body: '甲推开门。' })
  const noReviewService = fakeService([])
  await rejects('a missing review is refused before a child', 'review-required',
    () => settleChapterState(root, { work: noReviewWork, chapter: 1 }, { service: noReviewService, agent, signal }))
  check('a missing review starts no child', noReviewService.specs.length === 0, String(noReviewService.specs.length))

  const staleSummaryWork = makeWork('摘要过期')
  makeChapter(staleSummaryWork)
  s.writeChapter(root, { work: staleSummaryWork, chapter: 1, title: '一', body: '改版后的正文。', rewrite: true })
  reviewFixture(root, { work: staleSummaryWork, chapter: 1, observations: [] })
  const staleSummaryService = fakeService([])
  await rejects('a stale summary is refused before a child', 'summary-stale',
    () => settleChapterState(root, { work: staleSummaryWork, chapter: 1 }, { service: staleSummaryService, agent, signal }))
  check('a stale summary starts no child', staleSummaryService.specs.length === 0, String(staleSummaryService.specs.length))

  const settledAgain = fakeService([])
  await rejects('a settled chapter is refused', 'chapter-settled',
    () => settleChapterState(root, { work: successWork, chapter: 1 }, { service: settledAgain, agent, signal }))
  check('a settled chapter starts no child', settledAgain.specs.length === 0, String(settledAgain.specs.length))

  const recoveredWork = makeWork('先错后对')
  makeChapter(recoveredWork)
  const recoveredService = fakeService([
    { payload: badHookPayload },
    { payload: factPayload },
    { payload: { items: [] } },
  ])
  const recovered = await settleChapterState(root, { work: recoveredWork, chapter: 1 }, {
    service: recoveredService, agent, signal,
  })
  check('a deterministic error retries once and can settle', recovered.settled === true
    && recovered.attempts.settler === 2 && recovered.attempts.validator === 1, JSON.stringify(recovered))

  const badPayloadWork = makeWork('坏 payload')
  makeChapter(badPayloadWork)
  const badPayloadService = fakeService([{ payload: { factOps: 'not-an-object' } }])
  await rejects('an invalid settler payload is not a clean settlement', 'state-settle-no-submission',
    () => settleChapterState(root, { work: badPayloadWork, chapter: 1 }, { service: badPayloadService, agent, signal }))

  const missingServiceWork = makeWork('无服务')
  makeChapter(missingServiceWork)
  await rejects('missing service is not a clean settlement', 'state-settle-unavailable',
    () => settleChapterState(root, { work: missingServiceWork, chapter: 1 }, { service: undefined, agent, signal }))

  const noSubmissionService = fakeService([{ payload: undefined }])
  await rejects('settler no submission is an error', 'state-settle-no-submission',
    () => settleChapterState(root, { work: missingServiceWork, chapter: 1 }, { service: noSubmissionService, agent, signal }))

  const validatorNoSubmission = fakeService([
    { payload: factPayload },
    { payload: undefined },
  ])
  await rejects('validator no submission is an error', 'state-settle-no-submission',
    () => settleChapterState(root, { work: missingServiceWork, chapter: 1 }, {
      service: validatorNoSubmission, agent, signal,
    }))

  const validatorUnavailable = fakeService([
    { payload: factPayload },
    { error: Object.assign(new Error('provider unavailable'), { code: 'UNSUPPORTED_CAPABILITY' }) },
  ])
  await rejects('validator unavailable maps to settlement unavailable', 'state-settle-unavailable',
    () => settleChapterState(root, { work: missingServiceWork, chapter: 1 }, {
      service: validatorUnavailable, agent, signal,
    }))
  check('infrastructure failures wrote no events', s.readEvents(root, missingServiceWork).length === 0,
    String(s.readEvents(root, missingServiceWork).length))

  const timeoutService = { startActivation: () => ({ result: new Promise(() => {}), dispose: async () => {} }) }
  await rejects('a timed-out settler is a failure', 'state-settle-failed',
    () => settleChapterState(root, { work: missingServiceWork, chapter: 1 }, {
      service: timeoutService, agent, signal, timeoutMs: 20,
    }))

  const staleWork = makeWork('改版')
  makeChapter(staleWork)
  const staleService = fakeService([{
    payload: factPayload,
    before: async spec => {
      s.writeChapter(spec.request.cwd, { work: staleWork, chapter: 1, title: '一', body: '改版后的正文。', rewrite: true })
    },
  }])
  await rejects('a rewrite during settlement is stale', 'state-settle-stale',
    () => settleChapterState(root, { work: staleWork, chapter: 1 }, { service: staleService, agent, signal }))

  const staleSeqWork = makeWork('事件改版')
  makeChapter(staleSeqWork)
  makeChapter(staleSeqWork, '第二章正文。', 2)
  const staleSeqService = fakeService([{
    payload: factPayload,
    before: async spec => {
      s.settleState(spec.request.cwd, {
        work: staleSeqWork, chapter: 2, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '第二章事实' }] },
      })
    },
  }])
  await rejects('a state change during settlement is stale', 'state-settle-stale',
    () => settleChapterState(root, { work: staleSeqWork, chapter: 1 }, { service: staleSeqService, agent, signal }))

  const promptWork = makeWork('prompt 边界')
  makeChapter(promptWork)
  s.settleState(root, {
    work: promptWork, chapter: 1,
    factOps: { upsert: [{ subject: '基线人物', predicate: '状态', object: '基线事实' }] },
    newHooks: [{ text: '基线伏笔' }],
  })
  makeChapter(promptWork, '另一章的独特正文。', 2)
  const promptService = fakeService([
    { payload: factPayload },
    { payload: { items: [] } },
  ])
  await settleChapterState(root, { work: promptWork, chapter: 2 }, { service: promptService, agent, signal })
  const prompt = promptService.specs[0].request.prompt[0].text
  check('the settler loads its skill', prompt.includes('`storycraft-state-settler`'), prompt.slice(0, 160))
  check('the settler prompt carries the baseline and body',
    prompt.includes('## baseline') && prompt.includes('"revision": 1')
    && prompt.includes('基线事实') && prompt.includes('基线伏笔') && prompt.includes('另一章的独特正文。'),
    prompt.slice(0, 200))
  check('the settler prompt does not carry another chapter',
    !prompt.includes('甲推开门，雨声进来了'), prompt.slice(0, 200))
  check('the settler prompt has no work path', !prompt.includes('works/') && !prompt.includes('.storycraft/'), prompt.slice(0, 200))

  const skill = await readFile(join(project, 'skills', 'review', 'storycraft-state-settler', 'SKILL.md'), 'utf8')
  check('state-settler skill declares its submission contract',
    skill.includes('storycraft-state-settler') && skill.includes('story_submit')
    && skill.includes('factOps') && skill.includes('hookOps'), skill.slice(0, 120))
  const orchestration = await readFile(join(project, 'skills', 'shared', 'storycraft-studio-orchestration', 'SKILL.md'), 'utf8')
  const longform = await readFile(join(project, 'skills', 'longform', 'storycraft-longform-chapter', 'SKILL.md'), 'utf8')
  check('main-session skills route settlement to story_settle',
    orchestration.includes('story_settle') && longform.includes('story_settle'),
    `${orchestration.includes('story_settle')} / ${longform.includes('story_settle')}`)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
