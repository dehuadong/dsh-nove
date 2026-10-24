/** Contract tests for the delegated submission seam. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeSubmission, consumeSubmission, openSubmission, submitPayload } from '../submission.js'
import { SUBMIT_OUTPUT } from '../tools.js'
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

const root = await mkdtemp(join(tmpdir(), 'storycraft-submission-'))
try {
  const { workId: work } = s.initWork(root, { title: '提交测试', wordRange: { min: 50, max: 80 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '一', body: '旧'.repeat(60) })
  reviewFixture(root, { work, chapter: 1, problems: [{ location: '开头', problem: '慢', suggestion: '快' }] })

  const writer = openSubmission({ role: 'writer', workId: work, chapter: 1, wordRange: { min: 50, max: 80 } })
  const tooShort = await submitPayload({
    delegationId: writer.delegationId, depth: 1, root,
    payload: { title: '一', body: '短'.repeat(8) },
  })
  check('writer short submission is retryable', tooShort.ok === false
    && tooShort.error.code === 'submit-word-range' && tooShort.retryable === true
    && typeof tooShort.actual === 'string' && typeof tooShort.limit === 'string', JSON.stringify(tooShort))
  const accepted = await submitPayload({
    delegationId: writer.delegationId, depth: 1, root,
    payload: { title: '一', body: '写'.repeat(60) },
  })
  check('writer in-range submission is accepted', accepted.ok === true && accepted.submitted === true, JSON.stringify(accepted))
  const duplicate = await submitPayload({
    delegationId: writer.delegationId, depth: 1, root,
    payload: { title: '一', body: '写'.repeat(60) },
  })
  check('accepted submission cannot be repeated', duplicate.ok === false
    && duplicate.error.code === 'submit-already-consumed', JSON.stringify(duplicate))
  const consumed = consumeSubmission(writer.delegationId)
  check('accepted submission is consumable once', consumed?.consumed === true
    && consumed.payload.body.length === 60 && consumeSubmission(writer.delegationId) === undefined, JSON.stringify(consumed))
  closeSubmission(writer.delegationId)

  const unknown = await submitPayload({ delegationId: 'missing', depth: 1, root, payload: { title: '一', body: '写'.repeat(60) } })
  check('unknown delegation is rejected', unknown.ok === false && unknown.error.code === 'submit-unknown-delegation', JSON.stringify(unknown))

  const huge = openSubmission({ role: 'writer', workId: work, chapter: 1 })
  const oversized = await submitPayload({
    delegationId: huge.delegationId, depth: 1, root,
    payload: { title: '一', body: '写'.repeat(70 * 1024) },
  })
  check('oversized submission is rejected', oversized.ok === false
    && oversized.error.code === 'submit-too-large', JSON.stringify(oversized))
  closeSubmission(huge.delegationId)

  const reviewer = openSubmission({ role: 'reviewer', workId: work, chapter: 1 })
  const wrongRole = await submitPayload({
    delegationId: reviewer.delegationId, depth: 1, root,
    payload: { title: '一', body: '写'.repeat(60) },
  })
  check('entry role binding rejects a writer payload', wrongRole.ok === false
    && wrongRole.error.code === 'submit-invalid', JSON.stringify(wrongRole))
  closeSubmission(reviewer.delegationId)
  const parent = openSubmission({ role: 'writer', workId: work, chapter: 1 })
  const denied = await submitPayload({ delegationId: parent.delegationId, depth: 0, root, payload: { title: '一', body: '写'.repeat(60) } })
  check('parent submit is denied', denied.ok === false && denied.error.code === 'submit-parent-denied', JSON.stringify(denied))
  closeSubmission(parent.delegationId)

  const rewrite = openSubmission({ role: 'reviser', workId: work, chapter: 1, mode: 'rewrite', wordRange: { min: 50, max: 200 } })
  const eight = await submitPayload({
    delegationId: rewrite.delegationId, depth: 1, root,
    payload: { body: '八'.repeat(8) },
  })
  check('eight-character rewrite is rejected by word range', eight.ok === false
    && eight.error.code === 'submit-word-range' && eight.actual === '8 字', JSON.stringify(eight))
  closeSubmission(rewrite.delegationId)
  const reviser = openSubmission({ role: 'reviser', workId: work, chapter: 1, mode: 'patch', wordRange: { min: 50, max: 200 } })
  const tooLarge = await submitPayload({
    delegationId: reviser.delegationId, depth: 1, root,
    payload: { body: '改'.repeat(80) },
  })
  check('reviser mode violation is retryable', tooLarge.ok === false
    && tooLarge.error.code === 'submit-mode-violation' && tooLarge.retryable === true
    && typeof tooLarge.actual === 'string' && typeof tooLarge.limit === 'string', JSON.stringify(tooLarge))
  const short = await submitPayload({
    delegationId: reviser.delegationId, depth: 1, root,
    payload: { body: '短'.repeat(8) },
  })
  check('reviser short submission is rejected', short.ok === false && short.error.code === 'submit-word-range', JSON.stringify(short))
  const exhausted = await submitPayload({
    delegationId: reviser.delegationId, depth: 1, root,
    payload: { body: '短'.repeat(8) },
  })
  check('third failed attempt exhausts the submission', exhausted.ok === false
    && exhausted.error.code === 'submit-attempts-exhausted', JSON.stringify(exhausted))
  closeSubmission(reviser.delegationId)

  const summarizer = openSubmission({ role: 'summarizer', workId: work, chapter: 1 })
  const emptySummary = await submitPayload({
    delegationId: summarizer.delegationId, depth: 1, root, payload: { rawText: '   ' },
  })
  check('empty summary is retryable', emptySummary.ok === false
    && emptySummary.error.code === 'submit-invalid' && emptySummary.retryable === true, JSON.stringify(emptySummary))
  const longSummary = await submitPayload({
    delegationId: summarizer.delegationId, depth: 1, root, payload: { rawText: '摘'.repeat(401) },
  })
  check('summary over 400 code points is retryable', longSummary.ok === false
    && longSummary.error.code === 'submit-summary-range' && longSummary.actual === '401 字'
    && longSummary.limit === '≤400 字', JSON.stringify(longSummary))
  check('summary failure envelope fits SUBMIT_OUTPUT',
    ['ok', 'error', 'retryable', 'actual', 'limit'].every(key => SUBMIT_OUTPUT.schema.properties[key] !== undefined)
    && Object.keys(longSummary).every(key => SUBMIT_OUTPUT.schema.properties[key] !== undefined), JSON.stringify(longSummary))
  const summaryAccepted = await submitPayload({
    delegationId: summarizer.delegationId, depth: 1, root, payload: { rawText: '甲回到屋里。', title: '回屋' },
  })
  check('summary in range is accepted', summaryAccepted.ok === true && summaryAccepted.submitted === true, JSON.stringify(summaryAccepted))
  const summaryConsumed = consumeSubmission(summarizer.delegationId)
  check('accepted summary is consumable', summaryConsumed?.payload.rawText === '甲回到屋里。', JSON.stringify(summaryConsumed))
  closeSubmission(summarizer.delegationId)

  const openValidator = () => openSubmission({ role: 'validator', workId: work, chapter: 1 })
  const item = {
    code: 'fact-unsupported', where: '霍七', problem: '不是他', evidence: '韩松没松',
    impact: '归属错', severity: 'major', fix: '改记韩松',
  }
  const badCodeEntry = openValidator()
  const badCode = await submitPayload({
    delegationId: badCodeEntry.delegationId, depth: 1, root,
    payload: { items: [{ ...item, code: 'unsupported-fact' }] },
  })
  check('validator rejects an unknown finding code', badCode.ok === false
    && badCode.error.code === 'submit-invalid' && badCode.retryable === true, JSON.stringify(badCode))
  closeSubmission(badCodeEntry.delegationId)
  const missingFieldEntry = openValidator()
  const missingField = await submitPayload({
    delegationId: missingFieldEntry.delegationId, depth: 1, root,
    payload: { items: [{ ...item, evidence: '' }] },
  })
  check('validator requires evidence', missingField.ok === false
    && missingField.error.code === 'submit-invalid', JSON.stringify(missingField))
  closeSubmission(missingFieldEntry.delegationId)
  const longEvidenceEntry = openValidator()
  const longEvidence = await submitPayload({
    delegationId: longEvidenceEntry.delegationId, depth: 1, root,
    payload: { items: [{ ...item, evidence: '证'.repeat(241) }] },
  })
  check('validator caps evidence length', longEvidence.ok === false
    && longEvidence.error.code === 'submit-invalid', JSON.stringify(longEvidence))
  closeSubmission(longEvidenceEntry.delegationId)
  const tooManyEntry = openValidator()
  const tooMany = await submitPayload({
    delegationId: tooManyEntry.delegationId, depth: 1, root,
    payload: { items: Array.from({ length: 9 }, () => item) },
  })
  check('validator caps findings at eight', tooMany.ok === false
    && tooMany.error.code === 'submit-invalid', JSON.stringify(tooMany))
  closeSubmission(tooManyEntry.delegationId)
  const badSeverityEntry = openValidator()
  const badSeverity = await submitPayload({
    delegationId: badSeverityEntry.delegationId, depth: 1, root,
    payload: { items: [{ ...item, severity: 'blocker' }] },
  })
  check('validator severity is advisory only', badSeverity.ok === false
    && badSeverity.error.code === 'submit-invalid', JSON.stringify(badSeverity))
  closeSubmission(badSeverityEntry.delegationId)
  const emptyEntry = openValidator()
  const emptyFindings = await submitPayload({
    delegationId: emptyEntry.delegationId, depth: 1, root, payload: { items: [] },
  })
  check('validator accepts an empty finding list', emptyFindings.ok === true
    && emptyFindings.submitted === true, JSON.stringify(emptyFindings))
  closeSubmission(emptyEntry.delegationId)
  const acceptedEntry = openValidator()
  const acceptedFinding = await submitPayload({
    delegationId: acceptedEntry.delegationId, depth: 1, root, payload: { items: [item] },
  })
  check('validator accepts a non-empty finding', acceptedFinding.ok === true
    && acceptedFinding.submitted === true, JSON.stringify(acceptedFinding))
  const acceptedPayload = consumeSubmission(acceptedEntry.delegationId)
  check('validator finding is consumable', acceptedPayload?.payload.items.length === 1
    && acceptedPayload.payload.items[0].code === 'fact-unsupported', JSON.stringify(acceptedPayload))
  closeSubmission(acceptedEntry.delegationId)
  const missingQuoteEntry = openValidator()
  const missingQuote = await submitPayload({
    delegationId: missingQuoteEntry.delegationId, depth: 1, root,
    payload: { items: [{ ...item, code: 'missing-change', evidence: '无对应段落' }] },
  })
  check('missing-change requires a body quote', missingQuote.ok === false
    && missingQuote.error.code === 'submit-invalid' && missingQuote.retryable === true, JSON.stringify(missingQuote))
  closeSubmission(missingQuoteEntry.delegationId)
  const exhaustedEntry = openValidator()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await submitPayload({
      delegationId: exhaustedEntry.delegationId, depth: 1, root,
      payload: { items: [{ ...item, severity: 'blocker' }] },
    })
  }
  const exhaustedFindings = await submitPayload({
    delegationId: exhaustedEntry.delegationId, depth: 1, root,
    payload: { items: [{ ...item, severity: 'blocker' }] },
  })
  check('validator attempt limit is enforced', exhaustedFindings.ok === false
    && exhaustedFindings.error.code === 'submit-attempts-exhausted', JSON.stringify(exhaustedFindings))
  closeSubmission(exhaustedEntry.delegationId)

  const settlerEntry = openSubmission({ role: 'settler', workId: work, chapter: 1 })
  const settlerPayload = { factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '推开门' }] } }
  const settlerAccepted = await submitPayload({
    delegationId: settlerEntry.delegationId, depth: 1, root, payload: settlerPayload,
  })
  check('settler accepts a v2 payload', settlerAccepted.ok === true
    && settlerAccepted.submitted === true, JSON.stringify(settlerAccepted))
  const settlerConsumed = consumeSubmission(settlerEntry.delegationId)
  check('settler payload is consumable', settlerConsumed?.payload.factOps.upsert[0].subject === '甲',
    JSON.stringify(settlerConsumed))
  closeSubmission(settlerEntry.delegationId)
  const emptySettlerEntry = openSubmission({ role: 'settler', workId: work, chapter: 1 })
  const emptySettler = await submitPayload({
    delegationId: emptySettlerEntry.delegationId, depth: 1, root,
    payload: {},
  })
  check('settler accepts an empty payload', emptySettler.ok === true && emptySettler.submitted === true,
    JSON.stringify(emptySettler))
  closeSubmission(emptySettlerEntry.delegationId)
  const legacySettlerEntry = openSubmission({ role: 'settler', workId: work, chapter: 1 })
  const legacySettler = await submitPayload({
    delegationId: legacySettlerEntry.delegationId, depth: 1, root,
    payload: { entities: [], hooks: [] },
  })
  check('settler rejects the legacy delta shape', legacySettler.ok === false
    && legacySettler.error.code === 'submit-invalid', JSON.stringify(legacySettler))
  closeSubmission(legacySettlerEntry.delegationId)
  const badSettlerEntry = openSubmission({ role: 'settler', workId: work, chapter: 1 })
  const badSettler = await submitPayload({
    delegationId: badSettlerEntry.delegationId, depth: 1, root,
    payload: { factOps: { upsert: [{ subject: '甲', predicate: '持有' }] } },
  })
  check('settler rejects an incomplete fact triple', badSettler.ok === false
    && badSettler.error.code === 'submit-invalid', JSON.stringify(badSettler))
  closeSubmission(badSettlerEntry.delegationId)
  const largeSettlerEntry = openSubmission({ role: 'settler', workId: work, chapter: 1 })
  const largeSettler = await submitPayload({
    delegationId: largeSettlerEntry.delegationId, depth: 1, root,
    payload: { factOps: { upsert: Array.from({ length: 21 }, (_, index) => ({ subject: '甲', predicate: '持有', object: `物${index}` })) } },
  })
  check('settler caps fact ops', largeSettler.ok === false
    && largeSettler.error.code === 'submit-invalid', JSON.stringify(largeSettler))
  closeSubmission(largeSettlerEntry.delegationId)
  const manyHooksEntry = openSubmission({ role: 'settler', workId: work, chapter: 1 })
  const manyHooks = await submitPayload({
    delegationId: manyHooksEntry.delegationId, depth: 1, root,
    payload: { newHooks: Array.from({ length: 9 }, (_, index) => ({ text: `伏笔${index}` })) },
  })
  check('settler caps new hooks', manyHooks.ok === false && manyHooks.error.code === 'submit-invalid',
    JSON.stringify(manyHooks))
  closeSubmission(manyHooksEntry.delegationId)} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
