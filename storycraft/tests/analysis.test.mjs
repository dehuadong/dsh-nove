// E6: latest-review distribution and role/model call aggregates.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { readAnalysis } from '../src/analysis.ts'
import { recordCall } from '../src/telemetry.ts'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-analysis-'))
try {
  const { workId: work } = s.initWork(root, { title: '分析' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '一', body: '甲推开门。' })
  reviewFixture(root, {
    work, chapter: 1,
    observations: [{ id: 'O1', category: 'scope', assessment: 'issue', severity: 'major', summary: '旧问题', evidence: [], sourceRefs: [{ sourceId: 'chapter:1', quote: '甲推开门。' }] }],
  })
  reviewFixture(root, {
    work, chapter: 1,
    observations: [
      { id: 'O1', category: 'scope', assessment: 'resolved', summary: '已改', evidence: [], resolves: 'O1', sourceRefs: [{ sourceId: 'chapter:1', quote: '甲推开门。' }] },
      { id: 'O2', category: 'quality', assessment: 'issue', summary: '重复', evidence: [], sourceRefs: [{ sourceId: 'chapter:1', quote: '甲推开门。' }] },
      { id: 'O3', category: 'execution', assessment: 'issue', severity: 'major', summary: '节奏慢', evidence: [], fix: '删一段', sourceRefs: [{ sourceId: 'chapter:1', quote: '甲推开门。' }] },
    ],
  })
  recordCall(root, work, {
    chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:01.000Z', durationMs: 1000,
    outcome: 'accepted', promptChars: 10, outputChars: 20, usageSource: 'session', totalTokens: 100,
    inputTokens: 40, outputTokens: 60, model: 'model-a', provider: 'p',
  })
  recordCall(root, work, {
    chapter: 1, role: 'reviewer', scope: 'review:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:02.000Z', durationMs: 2000,
    outcome: 'accepted', promptChars: 10, outputChars: 20, usageSource: 'unavailable',
    model: 'model-a', provider: 'p',
  })

  const analysis = readAnalysis(root, work)
  const open = s.status(root, work).openProblems
  check('analysis has one reviewed chapter', analysis.reviews.chapters.length === 1 && analysis.reviews.chapters[0]?.chapter === 1)
  check('review issues align with openProblems', analysis.reviews.issues.total === open && open === 2, `${analysis.reviews.issues.total}/${open}`)
  check('missing severity has its own bucket', analysis.reviews.issues.bySeverity.major === 1 && analysis.reviews.issues.bySeverity.unspecified === 1, JSON.stringify(analysis.reviews.issues.bySeverity))
  check('category buckets are counted', analysis.reviews.issues.byCategory.execution === 1 && analysis.reviews.issues.byCategory.quality === 1, JSON.stringify(analysis.reviews.issues.byCategory))
  check('resolved observations are separate', analysis.reviews.resolved === 1 && analysis.reviews.chapters[0]?.chapter === 1)
  check('call totals group by role and model', analysis.calls.total.count === 2 && analysis.calls.total.totalTokens === 100 && analysis.calls.total.callsWithoutUsage === 1, JSON.stringify(analysis.calls.total))
  check('role and model rows are present', analysis.calls.byRole.some(row => row.role === 'writer' && row.totalTokens === 100)
    && analysis.calls.byRole.some(row => row.role === 'reviewer' && row.totalTokens === null)
    && analysis.calls.byModel.some(row => row.model === 'model-a' && row.count === 2), JSON.stringify(analysis.calls))
  const empty = s.initWork(root, { title: '空分析' }).workId
  const emptyAnalysis = readAnalysis(root, empty)
  check('empty work has empty review and call aggregates', emptyAnalysis.reviews.issues.total === 0 && emptyAnalysis.calls.total.count === 0 && emptyAnalysis.calls.total.totalTokens === null)
  const json = JSON.stringify(analysis)
  check('analysis carries no review or body text', !json.includes('节奏慢') && !json.includes('甲推开门') && !json.includes('evidence'), json.slice(0, 200))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
