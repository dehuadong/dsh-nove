// Summary revision binding: current/stale transitions, readWork/status fields,
// delegated admission and manual rebinding.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { openDatabase, workFile } from '../db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-summary-binding-'))
try {
  const { workId: work } = s.initWork(root, { title: '摘要绑定', wordRange: { min: 50, max: 200 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '一', body: '第一版正文。'.repeat(20) })
  s.writeSummary(root, { work, chapter: 1, text: '第一版摘要。' })

  const current = s.readSummaryState(root, work, 1)
  check('summary is current after writing', current.state === 'current' && current.revision === 1, JSON.stringify(current))
  let detail = s.readWork(root, work)
  check('readWork reports current summary',
    detail.chapters[0].hasSummary === true && detail.chapters[0].summaryStale === false
    && detail.chapters[0].summaryRevision === 1, JSON.stringify(detail.chapters[0]))
  let status = s.status(root, work)
  check('status reports current summary',
    status.chapters[0].hasSummary === true && status.chapters[0].summaryStale === false
    && status.chapters[0].summaryRevision === 1, JSON.stringify(status.chapters[0]))

  s.writeChapter(root, { work, chapter: 1, body: '第二版正文。'.repeat(20), rewrite: true })
  const stale = s.readSummaryState(root, work, 1)
  check('summary becomes stale after rewrite',
    stale.state === 'stale' && stale.revision === 1 && stale.currentRevision === 2, JSON.stringify(stale))
  detail = s.readWork(root, work)
  check('readWork reports stale summary',
    detail.chapters[0].hasSummary === false && detail.chapters[0].summaryStale === true
    && detail.chapters[0].summaryRevision === 1, JSON.stringify(detail.chapters[0]))
  status = s.status(root, work)
  check('status reports stale summary',
    status.chapters[0].hasSummary === false && status.chapters[0].summaryStale === true
    && status.chapters[0].summaryRevision === 1, JSON.stringify(status.chapters[0]))
  check('stale summary text is still readable', s.readSummary(root, work, 1).includes('第一版摘要'))

  s.writeSummary(root, { work, chapter: 1, text: '第二版摘要。', ifAbsent: true })
  const rebound = s.readSummaryState(root, work, 1)
  check('delegated write rebinds a stale summary',
    rebound.state === 'current' && rebound.revision === 2 && rebound.text.includes('第二版摘要'), JSON.stringify(rebound))
  throwsCode('delegated write refuses a current summary', 'summary-exists',
    () => s.writeSummary(root, { work, chapter: 1, text: '第三次摘要。', ifAbsent: true }))

  s.writeReview(root, { work, chapter: 1, problems: [{ location: '开头', problem: '慢', suggestion: '快' }] })
  s.reviseChapter(root, { work, chapter: 1, body: '第三版正文，节奏更快。'.repeat(20), problemIds: ['Q1'], mode: 'rewrite' })
  const staleAgain = s.readSummaryState(root, work, 1)
  check('revise makes the summary stale again',
    staleAgain.state === 'stale' && staleAgain.revision === 2 && staleAgain.currentRevision === 3, JSON.stringify(staleAgain))
  const next = s.nextStep(root, work)
  check('nextStep asks for a rewrite and names the old revision',
    next.action === 'story_summarize' && next.missing.includes('summary') && next.reason.includes('旧版本 r2'),
    JSON.stringify(next))
  s.writePlan(root, { work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 2 })
  const brief = await b.assembleBrief(root, work, 2)
  const previous = brief.sections.find(section => section.name === 'previous')
  check('brief falls back past a stale summary',
    previous?.bodyFallback === true && !previous.content.includes('第二版摘要'), JSON.stringify(previous))
  s.writePlan(root, { work, chapter: 3, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 3 })
  const brief3 = await b.assembleBrief(root, work, 3)
  const recent = brief3.sections.find(section => section.name === 'recentSummaries')
  check('recentSummaries excludes stale summaries',
    recent?.absent === true && !recent.content.includes('第二版摘要'), JSON.stringify(recent))
  throwsCode('foldState refuses a stale summary', 'summary-stale', () => s.foldState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['走到门口'] }], hooks: [],
  }))
  s.writeSummary(root, { work, chapter: 1, text: '第三版摘要。' })
  const settled = s.foldState(root, {
    work, chapter: 1, entities: [{ name: '甲', facts: ['走到门口'] }], hooks: [],
  })
  check('settle succeeds after rebinding', settled.counts.entities === 1
    && s.readManifest(root, work).chapters[0].stage === 'settled', JSON.stringify(settled.counts))

  const raw = openDatabase(workFile(root, work))
  const summaryRow = raw.prepare("SELECT artifact_id, revision_id, content FROM artifacts WHERE artifact_id = 'summary:1' ORDER BY rowid DESC LIMIT 1").get()
  const summaryContent = JSON.parse(summaryRow.content)
  summaryContent.bodyRevision = 99
  raw.prepare('UPDATE artifacts SET content = ? WHERE artifact_id = ? AND revision_id = ?')
    .run(JSON.stringify(summaryContent), summaryRow.artifact_id, summaryRow.revision_id)
  raw.close()
  const unbound = s.readSummaryState(root, work, 1)
  check('a summary bound to another revision is stale', unbound.state === 'stale', JSON.stringify(unbound))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
