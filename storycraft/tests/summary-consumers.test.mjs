// S2: ChapterSummary lives as `summary:<n>`; producers stamp identity, stale
// binds to bodyRevision, and consumers read the artifact instead of the table.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../dist/storage.js'
import * as b from '../dist/bible.js'
import * as tools from '../dist/tools.js'
import { readChapterSummary } from '../dist/artifact-store.js'
import { setCurrent } from '../dist/current.js'
import { checkDraft } from '../dist/landing.js'
import { openWork } from '../dist/db.js'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const STRUCTURE = ['title', 'characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType']
const registered = []
const ctx = {
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {} },
  effect: (fn) => { const dispose = fn(); return () => dispose?.() },
  get: () => undefined,
}
tools.apply(ctx, { mode: 'longform' })
const byName = new Map(registered.map(definition => [definition.name, definition]))
const exec = { agent: { id: 'test-session', session: { header: { cwd: undefined } } } }

const root = await mkdtemp(join(tmpdir(), 'storycraft-summary-consumers-'))
exec.agent.session.header.cwd = root
try {
  const { workId: work } = s.initWork(root, { title: '摘要迁移', wordRange: { min: 50, max: 5000 } })
  setCurrent(exec.agent.id, work)
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  for (const chapter of [1, 2]) {
    s.writePlan(root, { work, chapter, perspective: '甲', goal: `g${chapter}`, obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work, chapter })
    s.writeChapter(root, { work, chapter, body: `第${chapter}章正文。`.repeat(30) })
  }

  const receipt = s.writeSummary(root, { work, chapter: 1, text: '第一版摘要。' })
  check('manual write binds the body revision', receipt.summaryRevision === 1 && receipt.truncated === false, JSON.stringify(receipt))
  const first = readChapterSummary(root, { work, chapter: 1 }).artifact
  check('summary is an artifact with host-stamped identity',
    first.kind === 'summary' && first.content.chapter === 1 && first.content.bodyRevision === 1
    && first.content.rawText === '第一版摘要。', JSON.stringify(first.content))
  check('manual write leaves structure empty', STRUCTURE.every(field => first.content[field] === ''), JSON.stringify(first.content))

  const db = openWork(root, work)
  try {
    check('summaries table is retired', db.prepare(`SELECT count(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name = 'summaries'`).get().n === 0)
  } finally {
    db.close()
  }

  s.writeSummary(root, {
    work, chapter: 1,
    content: { rawText: '结构化摘要。', title: '标'.repeat(200), chapter: 9, bodyRevision: 9 },
  })
  const stamped = readChapterSummary(root, { work, chapter: 1 }).artifact.content
  check('structured fields are clipped at 120', [...stamped.title].length === 120, String([...stamped.title].length))
  check('child cannot override host identity', stamped.chapter === 1 && stamped.bodyRevision === 1, JSON.stringify(stamped))

  const capped = s.writeSummary(root, { work, chapter: 1, text: '长'.repeat(401) })
  const cappedText = readChapterSummary(root, { work, chapter: 1 }).artifact.content.rawText
  check('rawText caps at 400 code points', capped.truncated === true && [...cappedText].length === 400, String(cappedText.length))

  s.writeChapter(root, { work, chapter: 1, body: '重写正文。'.repeat(40), rewrite: true })
  check('rewrite makes the summary stale', s.readSummaryState(root, work, 1).state === 'stale')
  check('readWork reports the stale binding',
    s.readWork(root, work).chapters[0].summaryStale === true
    && s.readWork(root, work).chapters[0].summaryRevision === 1 && s.readWork(root, work).chapters[0].hasSummary === false)
  s.writeSummary(root, { work, chapter: 1, text: '重写后摘要。' })
  const rebound = s.readSummaryState(root, work, 1)
  check('re-summary rebinds to the new body revision',
    rebound.state === 'current' && rebound.revision === 2, JSON.stringify(rebound))

  s.writeSummary(root, {
    work, chapter: 2,
    content: {
      rawText: '第二章，沈砚在灯下磨铜。',
      title: '钟楼夜话',
      characters: '沈砚、陆晚',
      events: '钟未成',
      stateChanges: '铜料见底',
      hookActivity: '余音未解',
      mood: '冷',
      chapterType: '转折',
    },
  })
  const hits = s.searchMemory(root, work, '陆晚', {})
  const hit = hits.find(item => item.kind === 'summary' && item.chapter === 2)
  check('structure feeds the search index', hit !== undefined, JSON.stringify(hits.map(item => item.id)))
  check('retrieval text carries only rawText', hit?.text === '第二章，沈砚在灯下磨铜。', JSON.stringify(hit?.text))

  const read = s.readChapter(root, { work, chapter: 2, view: 'summary' })
  check('readChapter renders rawText', read.content === '第二章，沈砚在灯下磨铜。' && read.revision === 1, JSON.stringify(read))

  const brief = await b.assembleBrief(root, work, 2)
  const previous = brief.sections.find(section => section.name === 'previous')
  check('brief previous renders the rebound summary', previous?.content.includes('重写后摘要。'), JSON.stringify(previous))

  const detail = s.readWork(root, work).chapters[1]
  check('readWork exposes the current binding',
    detail.hasSummary === true && detail.summaryStale === false && detail.summaryRevision === 1, JSON.stringify(detail))

  const draft = await checkDraft(root, { work, chapter: 2, body: '沈砚与陆晚在灯下磨铜。'.repeat(20) })
  check('summary characters widen the name whitelist',
    !draft.warnings.some(item => String(item).includes('陆晚')), JSON.stringify(draft.warnings))

  const index = await b.summaryIndex(root, work)
  check('summaryIndex lists artifact summaries',
    index.chapters.length === 2 && index.chapters[1].words === [...'第二章，沈砚在灯下磨铜。'].length, JSON.stringify(index.chapters))
  const statusChapter = s.status(root, work).chapters[1]
  check('status exposes the current binding',
    statusChapter.hasSummary === true && statusChapter.summaryRevision === 1 && statusChapter.summaryStale === false,
    JSON.stringify(statusChapter))

  s.writePlan(root, { work, chapter: 3, perspective: '甲', goal: 'g3', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 3 })
  const brief3 = await b.assembleBrief(root, work, 3)
  const recent3 = brief3.sections.find(section => section.name === 'recentSummaries')
  check('brief recent carries rawText only',
    recent3?.content.includes('第二章，沈砚在灯下磨铜。') === true && recent3.content.includes('钟楼夜话') === false,
    JSON.stringify(recent3?.content))

  const longTool = await byName.get('story_summarize').execute({ work, chapter: 1, summary: '扩'.repeat(401) }, exec)
  check('story_summarize reports truncation', longTool.ok === true && longTool.truncated === true, JSON.stringify(longTool))
  const beforeIdem = readChapterSummary(root, { work, chapter: 1 }).artifact.revisionId
  const countDb = openWork(root, work)
  const beforeRows = countDb.prepare("SELECT count(*) AS n FROM artifacts WHERE artifact_id = 'summary:1'").get().n
  countDb.close()
  s.writeSummary(root, { work, chapter: 1, text: '扩'.repeat(401) })
  const countAfter = openWork(root, work)
  const afterRows = countAfter.prepare("SELECT count(*) AS n FROM artifacts WHERE artifact_id = 'summary:1'").get().n
  countAfter.close()
  check('identical summary is an idempotent no-op',
    readChapterSummary(root, { work, chapter: 1 }).artifact.revisionId === beforeIdem && beforeRows === afterRows,
    JSON.stringify({ beforeRows, afterRows }))

  const missing = await byName.get('story_read').execute({ work, artifactId: 'summary:3' }, exec)
  check('story_read reports a missing summary', missing.ok === false && missing.error.code === 'summary-not-found', JSON.stringify(missing))

  const oldRevision = readChapterSummary(root, { work, chapter: 2 }).artifact.revisionId
  s.writeSummary(root, { work, chapter: 2, content: { rawText: '第二章改版摘要。', characters: '沈砚、陆晚' } })
  const current = await byName.get('story_read').execute({ work, artifactId: 'summary:2' }, exec)
  const currentJson = JSON.parse(current.content)
  check('story_read returns the summary JSON',
    currentJson.rawText === '第二章改版摘要。' && currentJson.bodyRevision === 1, current.content)
  const old = await byName.get('story_read').execute({ work, artifactId: 'summary:2', revisionId: oldRevision }, exec)
  check('story_read reads an explicit old revision', JSON.parse(old.content).rawText === '第二章，沈砚在灯下磨铜。', old.content)

  const exported = await s.exportWork(root, work, join(root, 'out'))
  const summaryFile = await readFile(join(exported.directory, 'summaries', 'ch-0002.md'), 'utf8')
  check('export writes the raw text', summaryFile.trim() === '第二章改版摘要。', JSON.stringify(summaryFile))
  const manifest = JSON.parse(await readFile(join(exported.directory, 'manifest.json'), 'utf8'))
  check('export manifest binds the summary to the body revision',
    manifest.chapters[1].summaryRevision === 1 && manifest.chapters[1].summaryStale === false,
    JSON.stringify(manifest.chapters[1]))

  reviewFixture(root, { work, chapter: 1, problems: [{ location: '开头', problem: '慢', suggestion: '快' }] })
  s.reviseChapter(root, { work, chapter: 1, body: '第三次正文。'.repeat(40), problemIds: ['O1'], mode: 'rewrite' })
  reviewFixture(root, { work, chapter: 1, observations: [] })
  let staleError
  try {
    s.settleState(root, { work, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '走到门口' }] } })
  } catch (error) {
    staleError = error
  }
  check('settle refuses a stale summary', staleError?.code === 'summary-stale', String(staleError?.code))

  const lateDb = openWork(root, work)
  try {
    check('summary writes never touch a retired table', lateDb.prepare(`SELECT count(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name = 'summaries'`).get().n === 0)
  } finally {
    lateDb.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
