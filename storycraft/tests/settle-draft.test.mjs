// Settlement produces a draft; only finalize writes state events and locks.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { putArtifact } from '../src/artifact-store.ts'

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
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
