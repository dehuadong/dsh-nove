// Reopening an earlier chapter must put the guided flow back on that chapter,
// even when a later chapter already exists.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-reopen-target-'))
try {
  const { workId: work } = s.initWork(root, { title: '重开目标', wordRange: { min: 10, max: 5000 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })

  for (const chapter of [1, 2]) {
    s.writePlan(root, { work, chapter, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work, chapter })
    s.writeChapter(root, { work, chapter, title: `第${chapter}章`, body: `正文${chapter}。`.repeat(20) })
  }

  // Settle chapter 1 the shortest way the store allows.
  s.writeReview(root, { work, chapter: 1, observations: [] })
  s.writeSummary(root, { work, chapter: 1, text: '摘要一' })
  s.settleState(root, { work, chapter: 1, newHooks: [{ text: '备用钥匙' }] })
  check('chapter 1 settles', s.readManifest(root, work).chapters.find(item => item.number === 1).stage === 'settled')

  const open = s.reopenChapter(root, { work, chapter: 1 })
  check('reopen leaves the revision alone', open.revision === 1 || open.revision === undefined, JSON.stringify(open))

  const next = await s.nextStep(root, work)
  check('the guided flow returns to the reopened chapter',
    next.action === 'story_review' && next.chapter === 1, JSON.stringify(next))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
