// S1b: deleting the latest chapter removes its artifacts; earlier chapters keep theirs.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import {
  readArtifact, readChapterMemo, readChapterSummary, writeChapterSummary, writeContextTrace,
} from '../src/artifact-store.ts'
import { openWork } from '../src/storage/db.ts'

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
  const work = (await s.initWork(root, { title: '删章工件' })).workId
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

  const traceOf = (chapter, marker) => ({
    chapter,
    skills: [],
    plannerInputs: [],
    composerInputs: ['outline'],
    selectedSources: ['outline'],
    contextTiers: { protectedSources: ['outline'], compressibleSources: [] },
    tokenBudget: { protectedTokens: 10, compressibleTokens: 0, totalSelectedTokens: 10 },
    notes: [marker],
    trimmed: [],
    dropped: [],
    budget: { limit: 8000, used: 10, unit: 'tokens' },
    sections: [{ name: 'task', protection: 'protected', sourceIds: ['outline'], chars: 5, tokens: 5 }],
    missing: [],
    overflow: false,
  })
  const firstTrace = writeContextTrace(root, { work, chapter: 1, role: 'writer', trace: traceOf(1, 'first') })
  const repeatTrace = writeContextTrace(root, { work, chapter: 1, role: 'writer', trace: traceOf(1, 'first') })
  check('a trace is stored per chapter and role', firstTrace.artifactId === 'trace:1:writer', JSON.stringify(firstTrace))
  check('an identical assembly is idempotent', repeatTrace.revisionId === firstTrace.revisionId,
    JSON.stringify([firstTrace, repeatTrace]))
  check('the stored trace carries its chapter',
    readArtifact(root, { work, artifactId: 'trace:1:writer' }).artifact.content.chapter === 1)
  const changedTrace = writeContextTrace(root, { work, chapter: 1, role: 'writer', trace: traceOf(1, 'changed') })
  check('a changed assembly adds a revision', changedTrace.revisionId !== firstTrace.revisionId, JSON.stringify(changedTrace))
  check('both revisions stay readable',
    readArtifact(root, { work, artifactId: 'trace:1:writer', revisionId: firstTrace.revisionId }).artifact.content.notes[0] === 'first'
    && readArtifact(root, { work, artifactId: 'trace:1:writer' }).artifact.content.notes[0] === 'changed')

  await s.deleteChapter(root, work, 3, { confirm: true })
  const afterDeleteOne = readChapterMemo(root, { work, chapter: 1 })
  const afterDeleteTwo = readChapterMemo(root, { work, chapter: 2 })
  check('delete keeps earlier plans unchanged',
    afterDeleteOne.artifact.content.goal === 'g1' && afterDeleteTwo.artifact.content.goal === 'g2',
    JSON.stringify([afterDeleteOne.artifact.content.goal, afterDeleteTwo.artifact.content.goal]))
  check('delete removes the deleted plan', (() => {
    try {
      readChapterMemo(root, { work, chapter: 3 })
      return false
    } catch (error) {
      return error?.code === 'artifact-not-found'
    }
  })())
  check('delete keeps earlier summaries', readChapterSummary(root, { work, chapter: 2 }).artifact.content.chapter === 2)
  check('delete removes the deleted chapter trace', (() => {
    try {
      readArtifact(root, { work, artifactId: 'trace:3:writer' })
      return false
    } catch (error) {
      return error?.code === 'artifact-not-found'
    }
  })())
  const deleteDb = openWork(root, work)
  try {
    check('delete does not clear earlier approvals',
      deleteDb.prepare('SELECT plan_approved_at FROM chapters WHERE number IN (1, 2)').all().every(row => row.plan_approved_at !== null))
  } finally {
    deleteDb.close()
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
