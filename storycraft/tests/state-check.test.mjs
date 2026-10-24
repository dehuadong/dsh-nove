// Read-only semantic state check: deterministic short-circuit, findings receipt,
// evidence verification, staleness and failure paths.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkChapterState } from '../state-check.js'
import { submitPayload } from '../submission.js'
import { openWork } from '../db.js'
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

/** A child that submits one queued payload through the real story_submit seam. */
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
          if (typeof result.before === 'function') await result.before(spec)
          const id = /delegationId 是 ([0-9a-f-]+)/u.exec(spec.request.prompt[0].text)?.[1]
          if (result.payload === undefined) return { stopReason: 'completed' }
          const submitted = await submitPayload({
            delegationId: id, depth: 1, root: spec.request.cwd, payload: result.payload,
          })
          return { stopReason: 'completed', submitted }
        })(),
        dispose: async () => {},
      }
    },
  }
}

const completed = payload => ({ payload })
const signal = new AbortController().signal
const agent = { id: 'parent' }
const finding = {
  code: 'fact-unsupported', where: '韩松', problem: '不是他挡的', evidence: '韩松说：「松手。」',
  impact: '归属错', severity: 'major', fix: '改记韩松',
}

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const root = await mkdtemp(join(tmpdir(), 'storycraft-state-check-'))
try {
  const skill = await readFile(join(project, 'skills', 'review', 'storycraft-state-check', 'SKILL.md'), 'utf8')
  check('state-check skill declares its submission contract',
    skill.includes('storycraft-state-check') && skill.includes('story_submit')
    && skill.includes('fact-unsupported') && skill.includes('无对应段落'), skill.slice(0, 120))
  const orchestration = await readFile(join(project, 'skills', 'shared', 'storycraft-studio-orchestration', 'SKILL.md'), 'utf8')
  check('orchestration points at the check before settling', orchestration.includes('story_state_check'), orchestration.slice(0, 120))

  const { workId: work } = s.initWork(root, { title: '对账测试' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  const body = '甲推开门，雨声进来了。韩松说：「松手。」'
  s.writeChapter(root, { work, chapter: 1, title: '一', body })
  s.writeSummary(root, { work, chapter: 1, text: '甲推开门，韩松让他松手。' })

  const before = {
    events: s.readEvents(root, work).length,
    stage: s.readManifest(root, work).chapters[0].stage,
    revision: s.readManifest(root, work).chapters[0].currentRevision,
    summary: s.readSummary(root, work, 1),
    summaryState: s.readSummaryState(root, work, 1).state,
  }
  const good = fakeService([completed({ items: [finding] })])
  const receipt = await checkChapterState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
  }, { service: good, agent, signal })
  check('check returns bounded findings', receipt.ok === true && receipt.checked === true
    && receipt.revision === 1 && receipt.items.length === 1 && receipt.items[0].code === 'fact-unsupported',
  JSON.stringify(receipt))
  check('check counts the proposed delta', receipt.counts.facts === 1 && receipt.counts.hooks === 0
    && receipt.counts.items === 1, JSON.stringify(receipt.counts))
  check('check verifies a real body quote', receipt.items[0].evidenceVerified === true, JSON.stringify(receipt.items[0]))
  check('check reports attempts and duration',
    receipt.trace.submissionAttempts === 1 && typeof receipt.trace.durationMs === 'number', JSON.stringify(receipt.trace))
  check('check does not return the whole body', !JSON.stringify(receipt).includes(body), JSON.stringify(receipt))
  check('check is read-only', s.readEvents(root, work).length === before.events
    && s.readManifest(root, work).chapters[0].stage === before.stage
    && s.readManifest(root, work).chapters[0].currentRevision === before.revision
    && s.readSummary(root, work, 1) === before.summary
    && s.readSummaryState(root, work, 1).state === before.summaryState)

  const unverified = fakeService([completed({
    items: [{ ...finding, evidence: '正文里没有这句话' }],
  })])
  const unverifiedReceipt = await checkChapterState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
  }, { service: unverified, agent, signal })
  check('check flags an unverified quote without dropping it',
    unverifiedReceipt.items.length === 1 && unverifiedReceipt.items[0].evidenceVerified === false
    && unverifiedReceipt.warnings.some(warning => warning.startsWith('evidence-unverified:')),
    JSON.stringify(unverifiedReceipt))

  const shortCircuit = fakeService([])
  await rejects('deterministic error returns before a child', 'hook-not-open',
    () => checkChapterState(root, {
      work, chapter: 1, hooks: [{ text: '不存在的伏笔', state: 'used' }],
    }, { service: shortCircuit, agent, signal }))
  check('deterministic error did not start a child', shortCircuit.specs.length === 0, String(shortCircuit.specs.length))
  await rejects('empty delta is refused', 'empty-state',
    () => checkChapterState(root, { work, chapter: 1 }, { service: shortCircuit, agent, signal }))

  s.writePlan(root, { work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await rejects('a chapter without a body is refused', 'chapter-not-written',
    () => checkChapterState(root, {
      work, chapter: 2, entities: [{ name: '甲', facts: ['一条事实'] }],
    }, { service: shortCircuit, agent, signal }))

  const settled = s.initWork(root, { title: '已定稿' })
  s.writeOutline(root, { work: settled.workId, mainline: '主线' })
  s.approveOutline(root, { work: settled.workId })
  s.writePlan(root, { work: settled.workId, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: settled.workId, chapter: 1 })
  s.writeChapter(root, { work: settled.workId, chapter: 1, title: '一', body: '甲回来。' })
  s.writeReview(root, { work: settled.workId, chapter: 1, problems: [] })
  s.writeSummary(root, { work: settled.workId, chapter: 1, text: '甲回来。' })
  s.foldState(root, { work: settled.workId, chapter: 1, entities: [{ name: '甲', facts: ['回来了'] }] })
  await rejects('a settled chapter is refused', 'chapter-settled',
    () => checkChapterState(root, {
      work: settled.workId, chapter: 1, entities: [{ name: '甲', facts: ['又一条'] }],
    }, { service: shortCircuit, agent, signal }))

  await rejects('missing subagents service is reported', 'state-check-unavailable',
    () => checkChapterState(root, {
      work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
    }, { service: undefined, agent, signal }))

  const noSubmission = fakeService([{ payload: undefined }])
  await rejects('no submission is not a clean result', 'state-check-no-submission',
    () => checkChapterState(root, {
      work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
    }, { service: noSubmission, agent, signal }))

  const stale = fakeService([{
    payload: { items: [] },
    before: async spec => {
      s.writeChapter(spec.request.cwd, { work, chapter: 1, title: '一', body: '改版后的正文。', rewrite: true })
    },
  }])
  await rejects('a body rewrite during the check is stale', 'state-check-stale',
    () => checkChapterState(root, {
      work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
    }, { service: stale, agent, signal }))

  const pending = { startActivation: () => ({ result: new Promise(() => {}), dispose: async () => {} }) }
  await rejects('a timed-out check is a failure', 'state-check-failed',
    () => checkChapterState(root, {
      work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
    }, { service: pending, agent, signal, timeoutMs: 20 }))

  s.writePlan(root, { work, chapter: 3, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 3 })
  s.writeChapter(root, { work, chapter: 3, title: '三', body: '另一章的独特正文。' })
  const promptService = fakeService([completed({ items: [] })])
  const cleanReceipt = await checkChapterState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
  }, { service: promptService, agent, signal })
  check('check reports a clean result without findings',
    cleanReceipt.checked === true && cleanReceipt.items.length === 0
    && cleanReceipt.counts.items === 0, JSON.stringify(cleanReceipt))
  const prompt = promptService.specs[0].request.prompt[0].text
  const currentBody = s.readChapter(root, { work, chapter: 1 }).content
  check('the validator is told to load its skill', prompt.includes('`storycraft-state-check`'), prompt.slice(0, 200))
  check('the prompt carries the current body', prompt.includes(currentBody), prompt.slice(0, 200))
  check('the prompt does not carry another chapter', !prompt.includes('另一章的独特正文'), prompt.slice(0, 200))
  check('the prompt has no work path', !prompt.includes('works/') && !prompt.includes('.db'), prompt.slice(0, 200))

  const nullEvidence = fakeService([completed({
    items: [{ ...finding, code: 'fact-unsupported', evidence: '无对应段落' }],
  })])
  const nullReceipt = await checkChapterState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
  }, { service: nullEvidence, agent, signal })
  check('absence of a passage is not a failed quote',
    nullReceipt.items[0].evidenceVerified === null, JSON.stringify(nullReceipt.items[0]))

  s.writeReview(root, { work, chapter: 3, problems: [] })
  s.writeSummary(root, { work, chapter: 3, text: '另一章。' })
  s.foldState(root, { work, chapter: 3, entities: [{ name: '甲', facts: ['已知'] }] })
  const duplicate = fakeService([completed({ items: [] })])
  const duplicateReceipt = await checkChapterState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['已知'] }],
  }, { service: duplicate, agent, signal })
  check('deterministic duplicate-fact warnings pass through',
    duplicateReceipt.warnings.some(warning => warning.startsWith('duplicate-fact:')),
    JSON.stringify(duplicateReceipt.warnings))

  const invalidPayload = fakeService([completed({ items: [{ ...finding, code: 'bad-code' }] })])
  await rejects('an invalid validator payload is not a clean result', 'state-check-no-submission',
    () => checkChapterState(root, {
      work, chapter: 1, entities: [{ name: '甲', facts: ['推开门'] }],
    }, { service: invalidPayload, agent, signal }))

  const noPlan = s.initWork(root, { title: '无章纲' })
  s.writeOutline(root, { work: noPlan.workId, mainline: '主线' })
  s.approveOutline(root, { work: noPlan.workId })
  s.writePlan(root, { work: noPlan.workId, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: noPlan.workId, chapter: 1 })
  s.writeChapter(root, { work: noPlan.workId, chapter: 1, title: '一', body: '没有章纲的正文。' })
  const noPlanDb = openWork(root, noPlan.workId)
  noPlanDb.prepare("DELETE FROM artifacts WHERE artifact_id = 'plan:1'").run()
  noPlanDb.close()
  const noPlanService = fakeService([completed({ items: [] })])
  const noPlanReceipt = await checkChapterState(root, {
    work: noPlan.workId, chapter: 1, entities: [{ name: '甲', facts: ['一条事实'] }],
  }, { service: noPlanService, agent, signal })
  const noPlanPrompt = noPlanService.specs[0].request.prompt[0].text
  check('a missing plan is omitted instead of blocking', noPlanReceipt.ok === true
    && !noPlanPrompt.includes('## 本章章纲'), JSON.stringify(noPlanReceipt).slice(0, 200))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
