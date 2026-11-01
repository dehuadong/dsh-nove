// Role context retrieval: section placement, stale filter, trace and trim order.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as b from '../src/bible.ts'
import { openWork } from '../src/db.ts'
import { assembleRoleContext } from '../src/context.ts'
import { reviewFixture } from './review-fixture.mjs'
import { mintHookId } from '../src/state-projection.ts'

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
  check('retrieval section is present', out.text.includes('相关参考') && out.text.includes('〔summary:1〕'), out.text.slice(-600))
  check('retrieval trace is enabled with candidates',
    out.trace.retrieval !== undefined && out.trace.retrieval.candidates.length > 0,
    JSON.stringify(out.trace.retrieval))
  check('retrieval hits use artifact ids', out.trace.retrieval.candidates.every(hit => hit.source !== '' && (!hit.source.includes('/') || hit.source.startsWith('skill:'))),
    JSON.stringify(out.trace.retrieval.candidates))
  const skillHits = out.trace.retrieval.candidates.filter(hit => hit.kind === 'skill')
  check('skill candidates carry source and location', skillHits.length > 0
    && skillHits.every(hit => hit.source.startsWith('skill:') && typeof hit.location === 'string' && hit.location.includes('· L')),
    JSON.stringify(skillHits))
  check('context scope only allows the writer reference', skillHits.every(hit => !hit.source.includes('reader-contract')), JSON.stringify(skillHits))
  check('hybrid engine is reported for sent skill', out.trace.retrieval.engine === 'sqlite-fts5-bm25+host-lexical', String(out.trace.retrieval.engine))
  const retrievalSection = out.trace.sections.find(item => item.name === 'retrieval')
  check('skill sources stay out of section sourceIds', retrievalSection !== undefined
    && retrievalSection.sourceIds.every(id => !id.startsWith('skill:')), JSON.stringify(retrievalSection))

  const synthetic = (text) => () => [{
    id: 'skill:test/references/allowed.md#allowed:1', kind: 'skill',
    source: 'skill:test/references/allowed.md', location: '允许 · L1-1', text, score: 0.1, chapter: null,
  }]
  const withSkill = await assembleRoleContext({ root, work, chapter: 5, role: 'writer', task: '写第 5 章正文。' }, { searchSkills: synthetic('甲'.repeat(2000)) })
  const clippedRun = Math.max(0, ...[...withSkill.text.matchAll(/甲+/gu)].map(match => match[0].length))
  check('skill text is clipped before merge', clippedRun >= 399 && clippedRun <= 400, String(clippedRun))
  const failedSkill = await assembleRoleContext({ root, work, chapter: 5, role: 'writer', task: '写第 5 章正文。' }, {
    searchSkills: () => { const error = new Error('skill-busy'); error.code = 'skill-busy'; throw error },
  })
  check('skill retrieval failure is fail-open', failedSkill.trace.notes.some(note => note.includes('技能检索'))
    && failedSkill.trace.retrieval.candidates.length > 0, JSON.stringify(failedSkill.trace))
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
  check('dropped retrieval is absent from text', !tight.text.includes('相关往事') && !tight.text.includes('相关参考'))
  check('dropped retrieval does not claim hybrid engine', tight.trace.retrieval?.engine === 'sqlite-fts5-bm25', JSON.stringify(tight.trace.retrieval))

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
  const { workId: refWork } = s.initWork(root, { title: '定向伏笔' })
  await s.writeOutline(root, { work: refWork, mainline: '深井与钥匙' })
  await b.writeBible(root, refWork, 'characters', JSON.stringify([{ name: '甲', role: '主视角', want: '找钥匙', fear: '失去', limit: '不伤人', voice: '短句' }]))
  for (const chapter of [1, 2, 3]) {
    await s.writePlan(root, { work: refWork, chapter, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work: refWork, chapter })
    await s.writeChapter(root, { work: refWork, chapter, body: `第${chapter}章正文。`.repeat(20) })
    await s.writeSummary(root, { work: refWork, chapter, text: `第${chapter}章摘要。` })
  }
  const hookText = '深井钥匙'
  const hookId = mintHookId(hookText)
  s.appendStateEvent(root, {
    work: refWork, chapter: 3, kind: 'hook',
    payload: { op: 'upsert', hook: { hookId, startChapter: 3, type: '物件', status: 'open', lastAdvancedChapter: 3, expectedPayoff: '真相', notes: '', dependsOn: [], paysOffInArc: '第一卷', text: hookText } },
  })
  const futureId = mintHookId('未来钥匙')
  s.appendStateEvent(root, {
    work: refWork, chapter: 3, kind: 'hook',
    payload: { op: 'upsert', hook: { hookId: futureId, startChapter: 5, type: '物件', status: 'open', lastAdvancedChapter: 5, expectedPayoff: '真相', notes: '', dependsOn: [], paysOffInArc: '第二卷', text: '未来钥匙' } },
  })
  await s.writePlan(root, {
    work: refWork, chapter: 4, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't',
    body: '章纲正文', threadRefs: [hookId, futureId, 'h-deadbeef'],
  })
  await s.approveChapterPlan(root, { work: refWork, chapter: 4 })
  const directed = await assembleRoleContext({ root, work: refWork, chapter: 4, role: 'writer', task: '普通任务' })
  const directedHooks = directed.trace.retrieval.candidates.filter(hit => hit.kind === 'hook')
  check('threadRefs hook is retrieved without relying on FTS', directedHooks.some(hit => hit.id === `hook:${hookId}` && hit.source === 'state')
    && directed.text.includes('建立第 3 章') && !directed.text.includes('最近推进第 4 章'), JSON.stringify(directedHooks))
  const threadDeduped = await assembleRoleContext({ root, work: refWork, chapter: 4, role: 'writer', task: '深井钥匙 普通任务' })
  const dedupedHooks = threadDeduped.trace.retrieval.candidates.filter(hit => hit.kind === 'hook')
  check('threadRefs hook is deduplicated', dedupedHooks.length === 1, JSON.stringify(dedupedHooks))
  check('unknown threadRef is noted', directed.trace.notes.some(note => note.includes('h-deadbeef')), JSON.stringify(directed.trace.notes))
  check('future hook is not leaked', !directedHooks.some(hit => hit.id === `hook:${futureId}`), JSON.stringify(directedHooks))
  s.appendStateEvent(root, { work: refWork, chapter: 3, kind: 'hook', payload: { op: 'resolve', hookId } })
  const afterResolve = await assembleRoleContext({ root, work: refWork, chapter: 4, role: 'writer', task: '普通任务' })
  check('resolved hook is not recalled by threadRefs', !afterResolve.trace.retrieval.candidates.some(hit => hit.id === `hook:${hookId}`), JSON.stringify(afterResolve.trace.retrieval.candidates))

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
