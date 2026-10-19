// Role context assembly: protection levels, trimming order, trace and whitelist.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { assembleRoleContext } from '../context.js'

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
  await s.writeOutline(root, { work, approve: true })
  await s.writePlan(root, { work, chapter: 1, perspective: '周观', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.writePlan(root, { work, chapter: 2, perspective: '周观', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.writeChapter(root, { work, chapter: 1, body: '正文。'.repeat(200) })
  await b.writeSummary(root, work, 1, '第一章摘要'.repeat(50))
  const dir = join(root, 'works', work)
  await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '周观', role: '主视角', want: '把墙立起来', fear: '塌方', limit: '不拿人命换速度', voice: '短句' },
    { name: '韩松', role: '总工', want: '验证做法', fear: '算错', limit: '没有数据不签', voice: '反问' },
  ]))
  await writeFile(join(dir, 'bible', 'style.md'), '# 文风\n短句，少形容。', 'utf8')
  await writeFile(join(dir, 'state', 'events.jsonl'), `${JSON.stringify({ seq: 1, at: new Date().toISOString(), chapter: 1, kind: 'hook', text: '一处未解', state: 'opened' })}\n`, 'utf8')

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

  // A tight budget drops compressible sections before protected ones.
  const tight = await assembleRoleContext({ root, work, chapter: 2, role: 'writer', task: '写第 2 章正文。', budget: 150 })
  const dropped = tight.trace.dropped
  check('recent is dropped first', dropped[0] === 'recent', dropped.join(','))
  check('protected sections survive the budget', tight.text.includes('权威顺序') && tight.text.includes('本章任务'))
  check('trace records the budget', tight.trace.budget === 150)

  // Reviewer path: body is protected and present.
  // Work-scoped planning has no chapter entry; it still carries state and recent context.
  // A planner sees the book plan, the volume map and the character cards.
  const planner = await assembleRoleContext({ root, work, chapter: 2, role: 'planner', task: '为第 2 章出章纲' })
  check('planner gets the book plan', planner.text.includes('一条主线'), planner.text.slice(0, 200))
  check('planner gets character cards', planner.text.includes('韩松') && planner.text.includes('语气'), planner.text.slice(0, 400))
  check('planner whitelist comes from the context', planner.whitelist.counts.names === 2, JSON.stringify(planner.whitelist))

  // Planning chapter 3 has no manifest entry yet; that must still work.
  const plannedAhead = await assembleRoleContext({
    root, work, chapter: 3, role: 'planner', task: '为第 3 章出章纲',
  })
  check('planning a chapter without a manifest entry works', plannedAhead.text.includes('为第 3 章出章纲'))

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
  await s.writeOutline(root, { work: bare, approve: true })
  await s.writePlan(root, { work: bare, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  try {
    await assembleRoleContext({ root, work: bare, chapter: 1, role: 'writer', task: '写第 1 章正文。' })
    check('missing character cards are refused', false, 'expected rejection')
  } catch (error) {
    check('missing character cards are refused', error?.code === 'bible-missing', String(error?.code))
  }

  const review = await assembleRoleContext({
    root, work, chapter: 2, role: 'reviewer', body: '这一章正文。'.repeat(100),
    review: { round: 1, revision: 1, open: [{ id: 'Q1', problem: '节奏慢' }] },
  })
  check('reviewer gets the body as protected', review.trace.sections.some(item => item.name === 'body' && item.protection === 'protected'))
  check('reviewer task carries the items', review.text.includes('Q1'), review.text.slice(0, 300))
  check('reviewer gets the chapter plan before the body',
    review.trace.sections.map(item => item.name).indexOf('plan') < review.trace.sections.map(item => item.name).indexOf('body'))
  check('reviewer gets a standards segment', review.trace.sections.some(item => item.name === 'standard' && item.protection === 'protected'))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
