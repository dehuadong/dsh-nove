// A review is only current for the body it was written against: rewriting the
// body must send the chapter back to review, not forward to settlement.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { loadRoleInput } from '../src/role-input.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-review-stale-'))
try {
  const { workId: work } = s.initWork(root, { title: '审稿失效', wordRange: { min: 1, max: 10000 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '一', body: '甲推开门，雨声进来了。'.repeat(6) })
  s.writeReview(root, {
    work, chapter: 1,
    observations: [{
      id: 'O1', summary: '节奏快', evidence: ['e'], category: 'quality', assessment: 'issue',
      sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '甲推开门' }],
    }],
  })

  const before = await s.nextStep(root, work)
  check('a reviewed chapter asks for the revision', before.action === 'story_revise', JSON.stringify(before))

  s.reviseChapter(root, { work, chapter: 1, body: '甲推开门，雨声慢慢进来了。'.repeat(6), problemIds: ['O1'], mode: 'rewrite' })

  const after = await s.nextStep(root, work)
  check('the rewrite makes the previous review stale',
    after.action === 'story_review', JSON.stringify(after))
  check('the revision number actually changed',
    s.readChapter(root, { work, chapter: 1 }).revision === 2,
    JSON.stringify(s.readChapter(root, { work, chapter: 1 }).revision))

let deslopCode = ''
let deslopNext = ''
try {
  await loadRoleInput(root, { work, chapter: 1, role: 'reviser', mode: 'deslop' })
} catch (error) {
  deslopCode = error.code
  deslopNext = error.next
}
check('deslop with nothing mechanical stops with a typed exit', deslopCode === 'polish-noop', deslopCode)
check('the deslop exit names the next step', typeof deslopNext === 'string' && deslopNext.includes('跳过修订'), String(deslopNext))


  // A plan rewrite after the review makes the review stale even on the same body.
  s.writeReview(root, {
    work, chapter: 1,
    observations: [{
      id: 'O2', summary: '再改一处', evidence: ['e'], category: 'quality', assessment: 'issue',
      sourceRefs: [{ sourceId: 'chapter:1:r2', quote: '甲推开门' }],
    }],
  })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: '改成第三件事', obstacle: 'o', cost: 'c', turn: 't', body: 'b3', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1 })
  const afterPlan = await s.nextStep(root, work)
  check('a plan rewrite invalidates the previous review', afterPlan.action === 'story_review', JSON.stringify(afterPlan))

} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
