/** Contract tests for the delegated submission seam. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeSubmission, consumeSubmission, openSubmission, submitPayload } from '../submission.js'
import * as s from '../storage.js'

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
  s.writeReview(root, { work, chapter: 1, problems: [{ location: '开头', problem: '慢', suggestion: '快' }] })

  const writer = openSubmission({ role: 'writer', workId: work, chapter: 1, wordRange: { min: 50, max: 80 } })
  const tooShort = await submitPayload({
    delegationId: writer.delegationId, depth: 1, root,
    payload: { title: '一', body: '短'.repeat(8) },
  })
  check('writer short submission is retryable', tooShort.ok === false
    && tooShort.error.code === 'submit-word-range' && tooShort.retryable === true, JSON.stringify(tooShort))
  const accepted = await submitPayload({
    delegationId: writer.delegationId, depth: 1, root,
    payload: { title: '一', body: '写'.repeat(60) },
  })
  check('writer in-range submission is accepted', accepted.ok === true && accepted.submitted === true, JSON.stringify(accepted))
  const consumed = s.consumeSubmission === undefined ? undefined : undefined
  closeSubmission(writer.delegationId)

  const parent = openSubmission({ role: 'writer', workId: work, chapter: 1 })
  const denied = await submitPayload({ delegationId: parent.delegationId, depth: 0, root, payload: { title: '一', body: '写'.repeat(60) } })
  check('parent submit is denied', denied.ok === false && denied.error.code === 'submit-parent-denied', JSON.stringify(denied))
  closeSubmission(parent.delegationId)

  const reviser = openSubmission({ role: 'reviser', workId: work, chapter: 1, mode: 'patch', wordRange: { min: 50, max: 200 } })
  const tooLarge = await submitPayload({
    delegationId: reviser.delegationId, depth: 1, root,
    payload: { body: '改'.repeat(80) },
  })
  check('reviser mode violation is retryable', tooLarge.ok === false
    && tooLarge.error.code === 'submit-mode-violation' && tooLarge.retryable === true, JSON.stringify(tooLarge))
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
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
