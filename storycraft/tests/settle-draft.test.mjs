// Settlement produces a draft; only finalize writes state events and locks.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { putArtifact } from '../src/artifact-store.ts'
import { contentVersion } from '../src/domain.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function codeOf(fn) {
  try { fn(); return '' } catch (error) { return error?.code ?? String(error) }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-draft-'))
try {
  const { workId: work } = s.initWork(root, { title: '草案与定稿', wordRange: { min: 10, max: 5000 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '第1章', body: '甲把账本收好。'.repeat(20) })
  s.writeReview(root, { work, chapter: 1, observations: [] })
  s.writeSummary(root, { work, chapter: 1, text: '甲收好账本。' })

  // AC1: settle writes only a draft.
  const draft = s.writeStateDraft(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好账本' }] },
    ready: true,
  })
  check('settle writes a draft without events',
    draft.ready === true && s.readEvents(root, work).length === 0
    && s.readManifest(root, work).chapters[0].stage !== 'settled', JSON.stringify(draft))
  check('the draft is readable', s.readStateDraft(root, { work, chapter: 1 })?.revision === 1)

  // AC4/AC5: finalize applies it once and locks.
  const finalized = s.finalizeChapter(root, { work, chapter: 1 })
  check('finalize applies the draft', finalized.appended === 1
    && s.readManifest(root, work).chapters[0].stage === 'settled', JSON.stringify(finalized))
  check('finalize deletes the draft', s.readStateDraft(root, { work, chapter: 1 }) === undefined)
  check('a second finalize is refused', codeOf(() => s.finalizeChapter(root, { work, chapter: 1 })) === 'chapter-settled')

  // AC6/AC10: reopen clears readiness.
  s.reopenChapter(root, { work, chapter: 1 })
  const reopened = s.readManifest(root, work).chapters[0]
  const baseEvents = s.readEvents(root, work).length
  check('reopen clears readiness', reopened.stage === 'written' && reopened.stateReadyRevision === 0, JSON.stringify(reopened))

  // A reconcile-style draft is not consumable until the author accepts it.
  s.writeReview(root, { work, chapter: 1, observations: [] })
  s.writeSummary(root, { work, chapter: 1, text: '甲收好账本，雨停了。' })
  const pending = s.writeStateDraft(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '雨停了' }] },
    findings: [{ code: 'x', where: 'w', problem: 'p' }],
    ready: false,
  })
  check('a reconcile draft is not ready', pending.ready === false)
  check('finalize refuses an unaccepted draft', codeOf(() => s.finalizeChapter(root, { work, chapter: 1 })) === 'state-not-ready')
  const applied = s.markStateDraftReady(root, { work, chapter: 1 })
  check('apply marks the draft ready', applied.ready === true)
  check('no events before finalize', s.readEvents(root, work).length === baseEvents)

  // AC7: author ops merge into the draft and clear findings.
  s.mergeStateDraft(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '门口' }] },
  })
  const merged = s.readStateDraft(root, { work, chapter: 1 })
  check('author ops land in the draft', merged?.ready === true && merged.content.resolvedBy === 'author'
    && merged.content.findings.length === 0, JSON.stringify(merged?.content))
  check('author ops write no events', s.readEvents(root, work).length === baseEvents)

  s.finalizeChapter(root, { work, chapter: 1 })
  check('finalize writes the merged ops', s.readEvents(root, work).length === baseEvents + 3)

  // AC2/AC3: no draft / stale draft are distinct failures.
  s.reopenChapter(root, { work, chapter: 1 })
  check('apply without a draft is refused', codeOf(() => s.markStateDraftReady(root, { work, chapter: 1 })) === 'draft-not-found')
  check('finalize without a draft is refused', codeOf(() => s.finalizeChapter(root, { work, chapter: 1 })) === 'state-not-ready')

  // AC13: artifactId and content must agree.
  check('a draft whose id and content disagree is refused',
    codeOf(() => putArtifact(root, {
      workId: work, artifactId: 'state:draft:1:r2', kind: 'state_draft', scope: { chapter: 1 },
      content: { chapter: 1, revision: 1, factOps: {}, hookOps: {}, newHooks: [], findings: [], ready: true, resolvedBy: null, createdAt: new Date().toISOString() },
      provenance: 'generated', createdAt: new Date().toISOString(),
    })) === 'artifact-invalid')

  // AC16: a chapter move invalidates drafts and readiness.
  s.writeReview(root, { work, chapter: 1, observations: [] })
  s.writeSummary(root, { work, chapter: 1, text: '甲收好账本，雨停了，门口有人。' })
  s.writePlan(root, { work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 2 })
  s.writeChapter(root, { work, chapter: 2, title: '第2章', body: '乙把灯点上。'.repeat(20) })
  s.writeStateDraft(root, { work, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '待定' }] }, ready: true })
  await s.moveChapter(root, work, 1, 2)
  check('a chapter move clears drafts', s.readStateDraft(root, { work, chapter: 1 }) === undefined
    && s.readManifest(root, work).chapters.every(item => item.stateReadyRevision === 0),
    JSON.stringify(s.readManifest(root, work).chapters.map(item => [item.number, item.stateReadyRevision])))

  // AC3/AC5/AC10: stale draft, review gate order, and rewrite invalidation.
  const second = s.initWork(root, { title: '草案边界', wordRange: { min: 10, max: 5000 } }).workId
  s.writeOutline(root, { work: second, mainline: '一条主线' })
  s.approveOutline(root, { work: second })
  s.writePlan(root, { work: second, chapter: 1, perspective: '丁', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: second, chapter: 1 })
  s.writeChapter(root, { work: second, chapter: 1, title: '第1章', body: '丁把灯点上。'.repeat(20) })
  s.writeReview(root, { work: second, chapter: 1, observations: [] })
  s.writeSummary(root, { work: second, chapter: 1, text: '丁点上灯。' })

  // A draft for an older body revision cannot be accepted.
  const staleContent = { chapter: 1, revision: 2, factOps: {}, hookOps: {}, newHooks: [], findings: [], ready: false, resolvedBy: null, createdAt: new Date().toISOString() }
  putArtifact(root, {
    workId: second, artifactId: 'state:draft:1:r2', kind: 'state_draft', scope: { chapter: 1 },
    revisionId: contentVersion(staleContent),
    content: staleContent,
    provenance: 'generated', createdAt: new Date().toISOString(),
  })
  check('a stale draft cannot be accepted',
    codeOf(() => s.markStateDraftReady(root, { work: second, chapter: 1 })) === 'draft-stale')

  // The review gate runs before readiness: a new open observation blocks finalize.
  s.writeStateDraft(root, { work: second, chapter: 1, factOps: { upsert: [{ subject: '丁', predicate: '状态', object: '点灯' }] }, ready: true })
  s.writeReview(root, {
    work: second, chapter: 1,
    observations: [{
      id: 'O1', summary: '灯没写清', evidence: [], category: 'quality', assessment: 'issue',
      sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '丁把灯点上' }],
    }],
  })
  check('finalize asks for review before readiness',
    codeOf(() => s.finalizeChapter(root, { work: second, chapter: 1 })) === 'review-required')

  // AC10: a rewrite invalidates the draft and readiness.
  s.writeReview(root, { work: second, chapter: 1, observations: [] })
  s.writeStateDraft(root, { work: second, chapter: 1, factOps: { upsert: [{ subject: '丁', predicate: '状态', object: '再点灯' }] }, ready: true })
  s.writeChapter(root, { work: second, chapter: 1, title: '第1章', body: '丁又把灯点上。'.repeat(20), rewrite: true })
  check('a rewrite clears the draft and readiness',
    s.readStateDraft(root, { work: second, chapter: 1 }) === undefined
    && s.readManifest(root, second).chapters[0].stateReadyRevision === 0)

  // AC16: deleting a chapter removes its own draft only.
  const third = s.initWork(root, { title: '删除草案', wordRange: { min: 10, max: 5000 } }).workId
  s.writeOutline(root, { work: third, mainline: '一条主线' })
  s.approveOutline(root, { work: third })
  for (const number of [1, 2]) {
    s.writePlan(root, { work: third, chapter: number, perspective: '戊', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work: third, chapter: number })
    s.writeChapter(root, { work: third, chapter: number, title: `第${number}章`, body: '戊把门推开。'.repeat(20) })
    s.writeReview(root, { work: third, chapter: number, observations: [] })
    s.writeSummary(root, { work: third, chapter: number, text: '戊推开门。' })
  }
  s.writeStateDraft(root, { work: third, chapter: 1, factOps: { upsert: [{ subject: '戊', predicate: '状态', object: '开门' }] }, ready: true })
  s.writeStateDraft(root, { work: third, chapter: 2, factOps: { upsert: [{ subject: '戊', predicate: '状态', object: '进门' }] }, ready: true })
  await s.deleteChapter(root, third, 2, { confirm: true })
  check('deleting a chapter removes its draft and keeps the other',
    s.readStateDraft(root, { work: third, chapter: 2 }) === undefined
    && s.readStateDraft(root, { work: third, chapter: 1 }) !== undefined
    && s.readManifest(root, third).chapters.find(item => item.number === 1).stateReadyRevision === 1,
    JSON.stringify({ draft2: s.readStateDraft(root, { work: third, chapter: 2 }) === undefined, draft1: s.readStateDraft(root, { work: third, chapter: 1 }) !== undefined, ready: s.readManifest(root, third).chapters }))

} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
