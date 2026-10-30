// A reviewer whose quotes are not in the body gets one automatic retry with feedback.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { delegateRole } from '../src/delegate.ts'
import { submitPayload } from '../src/submission.ts'
import * as s from '../src/storage.ts'
import { writeBible } from '../src/bible.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function fakeService(results) {
  const specs = []
  return {
    specs,
    startActivation(spec) {
      specs.push(spec)
      const result = results.shift()
      if (result === undefined) throw new Error('no fake result queued')
      return {
        result: (async () => {
          const id = /delegationId 是 ([0-9a-f-]+)/u.exec(spec.request.prompt[0].text)?.[1]
          const submitted = await submitPayload({ delegationId: id, depth: 1, root: spec.request.cwd, payload: result.payload })
          return { stopReason: 'completed', submitted }
        })(),
        dispose: async () => {},
      }
    },
  }
}
const item = (quote, problem) => ({ quote, problem, impact: '读者会误解', severity: 'minor', fix: '补一句', mode: 'patch' })

const root = await mkdtemp(join(tmpdir(), 'storycraft-review-retry-'))
const agent = { id: 'parent' }
const signal = new AbortController().signal
try {
  const { workId: work } = s.initWork(root, { title: '审稿重试', wordRange: { min: 10, max: 5000 } })
  s.writeOutline(root, { work, mainline: '主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '第1章', body: '甲把账本收好，雨停了。'.repeat(10) })
  await writeBible(root, work, 'characters', JSON.stringify([{ name: '甲', role: '主角', want: '收好账本', fear: '丢', limit: '不伤人', voice: '短句' }]))
  await writeBible(root, work, 'style', '# 文风\n短句。')

  const service = fakeService([
    { payload: { items: [item('账本在桌上', '引文不存在')] } },
    { payload: { items: [item('甲把账本收好', '引文存在')] } },
  ])
  const receipt = await delegateRole(root, { work, chapter: 1, role: 'reviewer' }, { service, agent, signal })
  check('a bad quote is retried once', service.specs.length === 2 && receipt.submissionAttempts === 2, JSON.stringify(receipt))
  check('the retry prompt carries the rejection feedback',
    service.specs[1].request.prompt[0].text.includes('上次提交被拒绝')
    && service.specs[1].request.prompt[0].text.includes('连续存在的原文'),
    service.specs[1].request.prompt[0].text.slice(-300))
  check('only the accepted review lands', receipt.problems.total === 1 && receipt.reviewRound === 1, JSON.stringify(receipt))

  const { workId: failing } = s.initWork(root, { title: '审稿双击失败', wordRange: { min: 10, max: 5000 } })
  s.writeOutline(root, { work: failing, mainline: '主线' })
  s.approveOutline(root, { work: failing })
  s.writePlan(root, { work: failing, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: failing, chapter: 1 })
  s.writeChapter(root, { work: failing, chapter: 1, title: '第1章', body: '甲把账本收好，雨停了。'.repeat(10) })
  await writeBible(root, failing, 'characters', JSON.stringify([{ name: '甲', role: '主角', want: '收好账本', fear: '丢', limit: '不伤人', voice: '短句' }]))
  await writeBible(root, failing, 'style', '# 文风\n短句。')
  const badService = fakeService([
    { payload: { items: [item('账本在桌上', '引文不存在一')] } },
    { payload: { items: [item('账本在手里', '引文不存在二')] } },
  ])
  let code = ''
  try {
    await delegateRole(root, { work: failing, chapter: 1, role: 'reviewer' }, { service: badService, agent, signal })
  } catch (error) { code = error?.code ?? String(error) }
  check('a second bad submission returns the error', code === 'observation-source-unverified', code)
  check('the retry is bounded to one extra dispatch', badService.specs.length === 2, String(badService.specs.length))
  let reviewRound = 0
  try { reviewRound = s.latestReview(root, failing, 1)?.round ?? 0 } catch { reviewRound = 0 }
  check('no review lands after two bad submissions', reviewRound === 0, String(reviewRound))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
