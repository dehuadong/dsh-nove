// Role context assembly: protection levels, trimming order, trace and whitelist.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../dist/storage.js'
import * as b from '../dist/bible.js'
import { openWork } from '../dist/db.js'
import { assembleRoleContext } from '../dist/context.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-context-'))
try {
  const work = (await s.initWork(root, { title: '上下文测试', wordRange: { min: 3000, max: 5000 } })).workId
  await s.writeOutline(root, { work, mainline: '一条主线' })
  await s.approveOutline(root, { work })
  await s.writePlan(root, { work, chapter: 1, perspective: '周观', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work, chapter: 1 })
  await s.writePlan(root, { work, chapter: 2, perspective: '周观', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.writeChapter(root, { work, chapter: 1, body: '正文。'.repeat(200) })
  await b.writeSummary(root, work, 1, '第一章摘要'.repeat(50))
  await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '周观', role: '主视角', want: '把墙立起来', fear: '塌方', limit: '不拿人命换速度', voice: '短句' },
    { name: '韩松', role: '总工', want: '验证做法', fear: '算错', limit: '没有数据不签', voice: '反问' },
  ]))
  await b.writeBible(root, work, 'style', '# 文风\n短句，少形容。')
  const events = openWork(root, work)
  events.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
    .run(1, new Date().toISOString(), 1, 'hook', JSON.stringify({
      op: 'upsert',
      hook: {
        hookId: 'h-test', startChapter: 1, type: '悬念', status: 'open', lastAdvancedChapter: 1,
        expectedPayoff: '', notes: '', text: '一处未解',
      },
    }))
  events.close()

  const unapprovedContext = await assembleRoleContext({
    root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。',
  }).then(() => undefined, error => error)
  check('writer context refuses an unconfirmed plan', unapprovedContext?.code === 'plan-not-approved', String(unapprovedContext?.code))
  await s.approveChapterPlan(root, { work, chapter: 2 })

  const out = await assembleRoleContext({ root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', instruction: '写得紧一点' })
  const names = out.trace.sections.map(item => item.name)
  check('writer gets the seven sections', ['authority', 'task', 'constraints', 'state', 'recent', 'style'].every(name => names.includes(name)), names.join(','))
  check('authority and task are protected', out.trace.sections.filter(item => ['authority', 'task', 'constraints'].includes(item.name)).every(item => item.protection === 'protected'))
  check('state and recent are compressible', out.trace.sections.filter(item => ['state', 'recent', 'style'].includes(item.name)).every(item => item.protection === 'compressible'))
  check('constraints carry the word range', out.text.includes('3000–5000'), out.text.slice(0, 200))
  check('constraints carry the lead character', out.text.includes('周观') && out.text.includes('不拿人命换速度'), out.text.slice(0, 300))
  check('whitelist summary lists sample names', out.whitelist.counts.names === 2 && out.whitelist.sample.names.join(',') === '周观,韩松', JSON.stringify(out.whitelist))
  check('whitelist summary counts numbers', typeof out.whitelist.counts.numbers === 'number', JSON.stringify(out.whitelist))
  check('recent uses summaries', out.text.includes('第一章摘要'), out.text.slice(0, 300))
  check('retrieval is disabled below three written chapters',
    out.trace.retrieval === undefined, JSON.stringify(out.trace.retrieval))
  check('trace sources are virtual work paths', out.trace.sections.every(item => item.source === undefined || !item.source.startsWith('outline/')), JSON.stringify(out.trace.sections.map(item => item.source)))

  // A tight budget drops compressible sections before protected ones.
  const tight = await assembleRoleContext({ root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', budget: 150 })
  const dropped = tight.trace.dropped
  check('recent is dropped first', dropped[0] === 'recent', dropped.join(','))
  check('protected sections survive the budget', tight.text.includes('权威顺序') && tight.text.includes('本章任务'))
  check('trace records the budget', tight.trace.budget.limit === 150 && tight.trace.budget.unit === 'tokens')

  // The trace's numbers are the ones the budget and receipt report.
  const sectionTokens = out.trace.sections.reduce((sum, item) => sum + item.tokens, 0)
  check('the trace sums its sections', out.trace.tokenBudget.totalSelectedTokens === sectionTokens
    && out.trace.budget.used === sectionTokens, JSON.stringify(out.trace.tokenBudget))
  check('the trace says the tokens are estimated', out.trace.notes.some(note => note.includes('估算')), JSON.stringify(out.trace.notes))
  check('the trace splits protected and compressible tokens',
    out.trace.tokenBudget.protectedTokens > 0 && out.trace.tokenBudget.compressibleTokens >= 0
    && out.trace.tokenBudget.protectedTokens + out.trace.tokenBudget.compressibleTokens === sectionTokens)

  // A compressible section over its cap is compressed, never dropped.
  await b.writeBible(root, work, 'style', `# 文风\n${'短句，少形容。'.repeat(140)}`)
  const capped = await assembleRoleContext({ root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。' })
  const styleSection = capped.trace.sections.find(item => item.name === 'style')
  check('a section over its cap is compressed',
    styleSection?.trimmed === true && styleSection.tokens <= 400, JSON.stringify(styleSection))

  // Protected content over the total budget is flagged, never trimmed.
  const overflowing = await assembleRoleContext({ root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', instruction: '写'.repeat(9000) })
  check('protected overflow is flagged and kept',
    overflowing.trace.overflow === true && overflowing.text.includes('权威顺序')
    && overflowing.trace.notes.some(note => note.includes('overflow')), JSON.stringify(overflowing.trace.notes))
  const exact = await assembleRoleContext({
    root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', budget: capped.trace.budget.used,
  })
  check('a budget exactly used up does not overflow', exact.trace.overflow === false, JSON.stringify(exact.trace.budget))
  check('trimmed and dropped never overlap', !exact.trace.trimmed.some(name => exact.trace.dropped.includes(name)),
    JSON.stringify({ trimmed: exact.trace.trimmed, dropped: exact.trace.dropped }))
  const plain = await assembleRoleContext({ root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。' })
  const protectedOnly = await assembleRoleContext({
    root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', budget: plain.trace.tokenBudget.protectedTokens - 1,
  })
  check('protected content alone can trigger overflow', protectedOnly.trace.overflow === true,
    JSON.stringify(protectedOnly.trace.tokenBudget))
  const invalidBudget = await assembleRoleContext({
    root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', budget: -5,
  })
  check('an invalid budget falls back to the role default', invalidBudget.trace.budget.limit === 8000,
    JSON.stringify(invalidBudget.trace.budget))

  // A planner sees the book plan, the volume map and the character cards.
  const planner = await assembleRoleContext({ root, work, chapter: 2, role: 'planner', task: '为第 2 章出章纲' })
  check('planner gets the book plan', planner.text.includes('一条主线'), planner.text.slice(0, 200))
  check('planner gets character cards', planner.text.includes('韩松') && planner.text.includes('语气'), planner.text.slice(0, 400))
  check('planner whitelist comes from the context', planner.whitelist.counts.names === 2, JSON.stringify(planner.whitelist))

  // Planning chapter 3 has no chapter entry yet; that must still work.
  const plannedAhead = await assembleRoleContext({
    root, work, chapter: 3, role: 'planner', task: '为第 3 章出章纲',
  })
  check('planning a chapter without a chapter entry works', plannedAhead.text.includes('为第 3 章出章纲'))

  const workScope = await assembleRoleContext({
    root, work, role: 'planner', scope: 'work', task: '出全书计划',
  })
  check('work scope needs no chapter', workScope.text.includes('出全书计划'))
  check('work scope still carries hooks', workScope.text.includes('一处未解'))

  try {
    await assembleRoleContext({ root, work, chapter: 2, role: 'reviewer', task: '审第 2 章。', body: '' })
    check('a review without a body is refused', false, 'expected rejection')
  } catch (error) {
    check('a review without a body is refused', error?.code === 'chapter-not-written', String(error?.code))
  }

  // A work without character cards cannot dispatch writing or review.
  const bare = (await s.initWork(root, { title: '无人物卡' })).workId
  await s.writeOutline(root, { work: bare, mainline: '一条主线' })
  await s.approveOutline(root, { work: bare })
  await s.writePlan(root, { work: bare, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work: bare, chapter: 1 })
  try {
    await assembleRoleContext({ root, work: bare, chapter: 1, role: 'writer', task: '写第 1 章正文。' })
    check('missing character cards are refused', false, 'expected rejection')
  } catch (error) {
    check('missing character cards are refused', error?.code === 'bible-missing', String(error?.code))
  }

  const review = await assembleRoleContext({
    root, work, chapter: 2, role: 'reviewer', body: '这一章正文。'.repeat(100),
    review: { round: 1, revision: 1, open: [{ id: 'O1', problem: '节奏慢' }] },
  })
  check('reviewer gets the body as protected', review.trace.sections.some(item => item.name === 'body' && item.protection === 'protected'))
  check('reviewer task carries the items', review.text.includes('O1'), review.text.slice(0, 300))
  check('reviewer gets the chapter plan before the body',
    review.trace.sections.map(item => item.name).indexOf('plan') < review.trace.sections.map(item => item.name).indexOf('body'))
  check('reviewer gets a standards segment', review.trace.sections.some(item => item.name === 'standard' && item.protection === 'protected'))

  const summaryBody = s.readChapter(root, { work, chapter: 1 }).content
  const summaryContext = await assembleRoleContext({ root, work, chapter: 1, role: 'summarizer', body: summaryBody })
  const summaryNames = summaryContext.trace.sections.map(item => item.name)
  check('summarizer gets exactly authority/task/body/state',
    JSON.stringify(summaryNames) === JSON.stringify(['authority', 'task', 'body', 'state']), summaryNames.join(','))
  check('summarizer gets the body as protected',
    summaryContext.trace.sections.some(item => item.name === 'body' && item.protection === 'protected'))
  check('summarizer task names the summary', summaryContext.text.includes('写摘要'), summaryContext.text.slice(0, 200))
  check('summarizer omits constraints/recent/style/standard',
    ['constraints', 'recent', 'style', 'standard', 'plan'].every(name => !summaryNames.includes(name)), summaryNames.join(','))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
