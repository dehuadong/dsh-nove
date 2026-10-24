// S1b: chapter delete/move remaps plan/summary artifacts and clears approval.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import {
  readChapterMemo, readChapterObservations, readChapterSummary, writeChapterObservations, writeChapterSummary,
} from '../artifact-store.js'
import { openWork } from '../db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
const summary = (chapter) => ({
  chapter,
  title: `第${chapter}章`,
  characters: '',
  events: '',
  stateChanges: '',
  hookActivity: '',
  mood: '',
  chapterType: '',
  bodyRevision: 1,
  rawText: '',
})

const root = await mkdtemp(join(tmpdir(), 'storycraft-artifact-remap-'))
try {
  const work = (await s.initWork(root, { title: '重映射' })).workId
  await s.writeOutline(root, { work, mainline: '一条线' })
  await s.approveOutline(root, { work })
  for (const chapter of [1, 2, 3]) {
    await s.writePlan(root, {
      work, chapter, perspective: '甲', goal: `g${chapter}`, obstacle: 'o', cost: 'c', turn: 't',
      body: `b${chapter}`, threadRefs: [],
    })
    await s.approveChapterPlan(root, { work, chapter })
    await s.writeChapter(root, { work, chapter, body: `正文${chapter}。`.repeat(20) })
    writeChapterSummary(root, { work, chapter, content: summary(chapter) })
  }

  const planOne = readChapterMemo(root, { work, chapter: 1 })
  writeChapterObservations(root, {
    work, chapter: 1, bodyRevision: 1, round: 1,
    observations: [{
      code: 'Q1', summary: '目标不清', evidence: ['e'], category: 'quality', assessment: 'issue',
      target: { workId: work, artifactId: 'plan:1', revisionId: planOne.artifact.revisionId },
      sourceRefs: [{ sourceId: 'plan:1', quote: 'g1' }],
    }],
  })

  writeChapterObservations(root, {
    work, chapter: 3, bodyRevision: 1, round: 1,
    observations: [{
      code: 'Q2', summary: '跨章引用', evidence: ['e'], category: 'quality', assessment: 'issue',
      target: { workId: work, artifactId: 'plan:1', revisionId: planOne.artifact.revisionId },
      sourceRefs: [{ sourceId: 'chapter:3', quote: '正文3。' }],
    }],
  })

  await s.moveChapter(root, work, 1, 2)
  const movedOne = readChapterMemo(root, { work, chapter: 1 })
  const movedTwo = readChapterMemo(root, { work, chapter: 2 })
  check('move swaps plan content', movedOne.artifact.content.goal === 'g2' && movedTwo.artifact.content.goal === 'g1',
    JSON.stringify([movedOne.artifact.content, movedTwo.artifact.content]))
  check('move remaps plan scope', movedOne.artifact.scope.chapter === 1 && movedTwo.artifact.scope.chapter === 2)
  const movedDb = openWork(root, work)
  try {
    check('move clears approvals', movedDb.prepare('SELECT plan_approved_at FROM chapters WHERE number IN (1, 2)')
      .all().every(row => row.plan_approved_at === null))
  } finally {
    movedDb.close()
  }
  check('move keeps the latest summary revision', readChapterSummary(root, { work, chapter: 1 }).artifact.content.chapter === 1)
  const movedReview = readChapterObservations(root, { work, chapter: 2, bodyRevision: 1, round: 1 })
  check('move rebinds review target to the new memo revision',
    movedReview.artifact.content.observations[0].target.artifactId === 'plan:2'
      && movedReview.artifact.content.observations[0].target.revisionId === movedTwo.artifact.revisionId,
    JSON.stringify(movedReview.artifact.content.observations[0]))
  check('move rebinds review plan source ref',
    movedReview.artifact.content.observations[0].sourceRefs[0].sourceId === 'plan:2')
  const identityReview = readChapterObservations(root, { work, chapter: 3, bodyRevision: 1, round: 1 })
  check('identity-chapter review target follows the moved memo',
    identityReview.artifact.content.observations[0].target.artifactId === 'plan:2'
      && identityReview.artifact.content.observations[0].target.revisionId === movedTwo.artifact.revisionId,
    JSON.stringify(identityReview.artifact.content.observations[0]))

  await s.deleteChapter(root, work, 2, { confirm: true })
  const afterDeleteOne = readChapterMemo(root, { work, chapter: 1 })
  const afterDeleteTwo = readChapterMemo(root, { work, chapter: 2 })
  check('delete keeps survivors in rank order',
    afterDeleteOne.artifact.content.goal === 'g2' && afterDeleteTwo.artifact.content.goal === 'g3',
    JSON.stringify([afterDeleteOne.artifact.content.goal, afterDeleteTwo.artifact.content.goal]))
  check('delete removes the deleted plan', (() => {
    try {
      readChapterMemo(root, { work, chapter: 3 })
      return false
    } catch (error) {
      return error?.code === 'artifact-not-found'
    }
  })())
  check('delete keeps survivor summaries', readChapterSummary(root, { work, chapter: 2 }).artifact.content.chapter === 2)
  const deleteDb = openWork(root, work)
  try {
    check('delete clears approvals on survivors', deleteDb.prepare('SELECT plan_approved_at, plan_revision FROM chapters')
      .all().every(row => row.plan_approved_at === null && row.plan_revision === null))
  } finally {
    deleteDb.close()
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
