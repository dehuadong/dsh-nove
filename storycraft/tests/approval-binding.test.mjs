// Approvals bind to the content that was approved: rewriting the plan or the
// outline invalidates the confirmation even when the write path forgets to clear it.
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

const root = await mkdtemp(join(tmpdir(), 'storycraft-approval-binding-'))
try {
  const { workId: work } = s.initWork(root, { title: '批准绑定' })

  // Outline first: rewrite it before any plan exists, so its gate is reachable.
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  const outlineApproved = await s.nextStep(root, work)
  check('an approved outline advances to the first plan',
    outlineApproved.action === 'story_plan' && !(outlineApproved.blocked ?? []).includes('outline-approval'),
    JSON.stringify(outlineApproved))

  s.writeOutline(root, { work, mainline: '改过的主线' })
  const afterOutlineRewrite = await s.nextStep(root, work)
  check('rewriting the outline withdraws its approval',
    (afterOutlineRewrite.blocked ?? []).includes('outline-approval'), JSON.stringify(afterOutlineRewrite))

  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: '查清旧案', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1 })
  const planApproved = await s.nextStep(root, work)
  check('an approved plan advances to writing',
    planApproved.action === 'story_write' && !(planApproved.blocked ?? []).includes('plan-approval'),
    JSON.stringify(planApproved))

  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: '改成另一件事', obstacle: 'o', cost: 'c', turn: 't', body: 'b2', threadRefs: [] })
  const afterPlanRewrite = await s.nextStep(root, work)
  check('rewriting the plan withdraws the approval',
    (afterPlanRewrite.blocked ?? []).includes('plan-approval'), JSON.stringify(afterPlanRewrite))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
