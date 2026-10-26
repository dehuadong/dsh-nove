// Role context retrieval: section placement, stale filter, trace and trim order.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../dist/storage.js'
import * as b from '../dist/bible.js'
import { openWork } from '../dist/db.js'
import { assembleRoleContext } from '../dist/context.js'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-context-retrieval-'))
try {
  const work = (await s.initWork(root, { title: '检索上下文', wordRange: { min: 200, max: 400 } })).workId
  await s.writeOutline(root, { work, mainline: '旧井与钥匙' })
  await s.approveOutline(root, { work })
  await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '甲', role: '主视角', want: '找旧井', fear: '失去钥匙', limit: '不伤人', voice: '短句' },
  ]))
  for (const number of [1, 2, 3, 4]) {
    await s.writePlan(root, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work, chapter: number })
    await s.writeChapter(root, { work, chapter: number, body: `第${number}章正文。`.repeat(30) })
    await s.writeSummary(root, { work, chapter: number, text: number === 1 ? '旧井边有一把备用钥匙。' : `第${number}章摘要。` })
  }
  await s.writePlan(root, { work, chapter: 5, perspective: '甲', goal: '找旧井', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work, chapter: 5 })
  await reviewFixture(root, { work, chapter: 1, observations: [] })
  await s.settleState(root, { work, chapter: 1, newHooks: [{ text: '备用钥匙' }] })
  const raw = openWork(root, work)
  const summaryRow = raw.prepare("SELECT artifact_id, revision_id, content FROM artifacts WHERE artifact_id = 'summary:2' ORDER BY rowid DESC LIMIT 1").get()
  const summaryContent = JSON.parse(summaryRow.content)
  summaryContent.bodyRevision = 0
  raw.prepare('UPDATE artifacts SET content = ? WHERE artifact_id = ? AND revision_id = ?')
    .run(JSON.stringify(summaryContent), summaryRow.artifact_id, summaryRow.revision_id)
  raw.close()
  await s.importMaterial(root, work, {
    name: '旧井参考.md',
    contentBase64: Buffer.from('旧井边的作者参考资料。', 'utf8').toString('base64'),
  })

  const out = await assembleRoleContext({ root, work, chapter: 5, role: 'writer', task: '写第 5 章正文。', instruction: '写旧井' })
  const names = out.trace.sections.map(item => item.name)
  check('retrieval follows recent', names.indexOf('retrieval') === names.indexOf('recent') + 1, names.join(','))
  check('retrieval section is present', out.text.includes('相关往事') && out.text.includes('〔summary:1〕'), out.text.slice(-600))
  check('retrieval trace is enabled with candidates',
    out.trace.retrieval !== undefined && out.trace.retrieval.candidates.length > 0,
    JSON.stringify(out.trace.retrieval))
  check('retrieval hits use artifact ids', out.trace.retrieval.candidates.every(hit => hit.source !== '' && !hit.source.includes('/')),
    JSON.stringify(out.trace.retrieval.candidates))
  check('stale chapter 2 summary is not retrieved', !out.trace.retrieval.candidates.some(hit => hit.id === 'summary:2'), JSON.stringify(out.trace.retrieval.candidates))
  check('material is retrieved with a bounded snippet',
    out.trace.retrieval.candidates.some(hit => hit.kind === 'material'
      && hit.source.startsWith('material:')), JSON.stringify(out.trace.retrieval.candidates))
  check('retrieval text carries the material title', out.text.includes('旧井参考'), out.text.slice(-800))
  check('recent still carries current summaries', out.text.includes('第 4 章：第4章摘要。'))
  const deduped = await assembleRoleContext({
    root, work, chapter: 5, role: 'writer', task: '写第 5 章正文。', instruction: '第4章摘要',
  })
  check('summaries already sent by recent are deduped',
    !deduped.trace.retrieval.candidates.some(hit => hit.id === 'summary:4'), JSON.stringify(deduped.trace.retrieval.candidates))
  const failed = await assembleRoleContext(
    { root, work, chapter: 5, role: 'writer', task: '写第 5 章正文。', instruction: '写旧井' },
    { searchMemory: () => { const error = new Error('busy'); error.code = 'work-busy'; throw error } },
  )
  check('retrieval failure is fail-open with a trace note',
    failed.trace.retrieval !== undefined && failed.trace.retrieval.candidates.length === 0
    && failed.trace.notes.some(note => note.includes('work-busy'))
    && !failed.text.includes('相关往事') && failed.text.includes('本章任务'), JSON.stringify(failed.trace))

  const tight = await assembleRoleContext({
    root, work, chapter: 5, role: 'writer', task: '写第 5 章正文。', instruction: '写旧井', budget: 150,
  })
  check('retrieval is the first compressible dropped', tight.trace.dropped[0] === 'retrieval', tight.trace.dropped.join(','))
  check('dropped retrieval is recorded on its section',
    tight.trace.sections.find(item => item.name === 'retrieval')?.dropped === true, JSON.stringify(tight.trace.sections))
  check('dropped retrieval is absent from text', !tight.text.includes('相关往事'))

  const planner = await assembleRoleContext({ root, work, role: 'planner', scope: 'work', task: '出全书计划 旧井' })
  check('work-scope planner retrieves without a target', planner.trace.retrieval !== undefined, JSON.stringify(planner.trace.retrieval))
  check('work-scope planner can retrieve material',
    planner.trace.retrieval.candidates.some(hit => hit.kind === 'material'), JSON.stringify(planner.trace.retrieval.candidates))
  const early = await assembleRoleContext({ root, work, chapter: 1, role: 'planner', task: '找旧井' })
  check('material is available at beforeChapter=1', early.trace.retrieval.candidates.some(hit => hit.kind === 'material'),
    JSON.stringify(early.trace.retrieval.candidates))

  const emptyWork = (await s.initWork(root, { title: '无命中检索', wordRange: { min: 100, max: 200 } })).workId
  await s.writeOutline(root, { work: emptyWork, mainline: '无命中' })
  await s.approveOutline(root, { work: emptyWork })
  await b.writeBible(root, emptyWork, 'characters', JSON.stringify([{ name: '乙', role: '主视角', want: '走', fear: '停', limit: '不回头', voice: '短句' }]))
  for (const number of [1, 2, 3]) {
    await s.writePlan(root, { work: emptyWork, chapter: number, perspective: '乙', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work: emptyWork, chapter: number })
    await s.writeChapter(root, { work: emptyWork, chapter: number, body: `第${number}章正文。`.repeat(20) })
    await s.writeSummary(root, { work: emptyWork, chapter: number, text: `第${number}章摘要。` })
  }
  await s.writePlan(root, { work: emptyWork, chapter: 4, perspective: '乙', goal: 'zzzz', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work: emptyWork, chapter: 4 })
  const empty = await assembleRoleContext({ root, work: emptyWork, role: 'planner', scope: 'work', task: 'zzzz' })
  check('zero-hit retrieval keeps an enabled empty trace',
    empty.trace.retrieval !== undefined && empty.trace.retrieval.candidates.length === 0
    && empty.trace.retrieval.candidates.length === 0 && !empty.text.includes('相关往事'), JSON.stringify(empty.trace.retrieval))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
