// ChapterMemo producer/consumer migration: plan:<n> is the only plan source.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { openWork } from '../db.js'
import { readChapterMemo } from '../artifact-store.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function throws(name, code, fn) {
  try {
    await fn()
    check(name, false, `expected ${code}`)
  } catch (error) {
    check(name, error?.code === code, error?.code ?? error?.message)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-memo-consumers-'))
try {
  const work = (await s.initWork(root, { title: '章纲消费' })).workId
  await s.writeOutline(root, { work, mainline: '一条线' })
  await s.approveOutline(root, { work })

  const plan = await s.writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本', obstacle: '掌柜阻拦',
    cost: '欠人情', turn: '账本牵出旧案', body: '甲夜里潜入当铺，拿到账本。', threadRefs: ['hook-1'],
  })
  check('story plan writes a plan artifact', plan.artifact.artifactId === 'plan:1' && plan.artifact.kind === 'plan', JSON.stringify(plan))
  const db = openWork(root, work)
  try {
    check('chapter_plans is no longer written', db.prepare('SELECT count(*) AS n FROM chapter_plans').get().n === 0)
  } finally {
    db.close()
  }
  const text = await s.readPlan(root, work, 1)
  check('readPlan renders body and threadRefs',
    text.includes('## 章纲正文') && text.includes('甲夜里潜入当铺') && text.includes('hook-1'), text)

  const waiting = await s.nextStep(root, work)
  check('unapproved plan is a blocked write step',
    waiting.action === 'story_write' && waiting.blocked?.includes('plan-approval'), JSON.stringify(waiting))
  const pendingDb = openWork(root, work)
  try {
    const pending = s.planApprovalState(pendingDb, 1)
    check('planApprovalState reports blocked before approval',
      pending.hasMemo === true && pending.blocked === true && pending.approved === false, JSON.stringify(pending))
    await throws('assertPlanApproved rejects an unapproved memo', 'plan-not-approved',
      () => s.assertPlanApproved(pendingDb, 1))
  } finally {
    pendingDb.close()
  }

  await throws('action boundary requires body', 'plan-incomplete',
    () => s.writePlan(root, {
      work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't',
      threadRefs: [], requireBody: true,
    }))
  const approved = await s.approveChapterPlan(root, { work, chapter: 1 })
  check('approval binds the memo revision', approved.entry.planRevision === plan.artifact.revisionId, JSON.stringify(approved.entry))
  const stateDb = openWork(root, work)
  try {
    const state = s.planApprovalState(stateDb, 1)
    check('planApprovalState reports approved', state.required === true && state.approved === true && state.blocked === false, JSON.stringify(state))
    s.assertPlanApproved(stateDb, 1)
    check('assertPlanApproved passes when approved', true)
  } finally {
    stateDb.close()
  }
  const ready = await s.nextStep(root, work)
  check('approved plan is not blocked', !(ready.blocked ?? []).includes('plan-approval'), JSON.stringify(ready))

  await s.writeChapter(root, { work, chapter: 1, body: '正文一。'.repeat(20), requirePlanApproval: true })
  const afterWrite = await s.readWork(root, work)
  check('approval survives the first body write', afterWrite.chapters[0].planApproved === true, JSON.stringify(afterWrite.chapters[0]))
  const rewrite = await s.writeChapter(root, { work, chapter: 1, body: '正文二。'.repeat(20), rewrite: true, requirePlanApproval: true })
  check('approval survives a rewrite', rewrite.revision === 2, JSON.stringify(rewrite))

  const rewrittenPlan = await s.writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本', obstacle: '掌柜阻拦',
    cost: '欠人情', turn: '账本牵出旧案', body: '甲白天进当铺，拿到账本。', threadRefs: [],
  })
  await throws('memo rewrite invalidates approval', 'plan-not-approved',
    () => s.writeChapter(root, { work, chapter: 1, body: '正文三。'.repeat(20), rewrite: true, requirePlanApproval: true }))
  await throws('memo rewrite also blocks revision', 'plan-not-approved',
    () => s.reviseChapter(root, {
      work, chapter: 1, body: '正文四。'.repeat(20), problemIds: ['Q1'], mode: 'patch', requirePlanApproval: true,
    }))
  check('memo rewrite records a new revision', rewrittenPlan.artifact.revisionId !== plan.artifact.revisionId)

  const again = await s.writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本', obstacle: '掌柜阻拦',
    cost: '欠人情', turn: '账本牵出旧案', body: '甲白天进当铺，拿到账本。', threadRefs: [],
  })
  check('identical memo is an idempotent no-op', again.artifact.revisionId === rewrittenPlan.artifact.revisionId)
  const oldRevision = readChapterMemo(root, { work, chapter: 1, revisionId: plan.artifact.revisionId })
  check('old memo revision remains readable', oldRevision.artifact.content.body.includes('甲夜里潜入'), JSON.stringify(oldRevision.artifact))
  const planView = await s.readChapter(root, { work, chapter: 1, view: 'plan' })
  check('readChapter plan view renders the memo', planView.content.includes('## 章纲正文'), planView.content)

  const oldPlan = await s.writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本', obstacle: '掌柜阻拦',
    cost: '欠人情', turn: '账本牵出旧案', body: '旧稿。', threadRefs: [],
  })
  await throws('reverting to an older memo revision is refused', 'artifact-revision-exists',
    () => s.writePlan(root, {
      work, chapter: 1, perspective: '甲', goal: '拿到账本', obstacle: '掌柜阻拦',
      cost: '欠人情', turn: '账本牵出旧案', body: '甲白天进当铺，拿到账本。', threadRefs: [],
    }))

  const exportPath = await s.exportWork(root, work)
  const exportedPlan = await readFile(join(exportPath.directory, 'outline', 'ch-0001.plan.md'), 'utf8')
  check('export includes the latest memo plan', exportedPlan.includes('## 章纲正文') && exportedPlan.includes('旧稿'), exportedPlan)

  const noOutline = (await s.initWork(root, { title: '无全书计划' })).workId
  const noOutlineNext = await s.nextStep(root, noOutline)
  check('absent outline is a missing input, not blocked',
    noOutlineNext.action === 'story_outline' && noOutlineNext.missing?.includes('outline')
      && !(noOutlineNext.blocked ?? []).includes('outline-approval'), JSON.stringify(noOutlineNext))

  const outlinePending = (await s.initWork(root, { title: '全书计划待确认' })).workId
  await s.writeOutline(root, { work: outlinePending, mainline: '一条线' })
  const outlineNext = await s.nextStep(root, outlinePending)
  check('written but unapproved outline is a blocked plan step',
    outlineNext.action === 'story_plan' && outlineNext.blocked?.includes('outline-approval'), JSON.stringify(outlineNext))

  const noPlan = (await s.initWork(root, { title: '无章纲' })).workId
  await s.writeOutline(root, { work: noPlan, mainline: '一条线' })
  await s.approveOutline(root, { work: noPlan })
  await s.writePlan(root, { work: noPlan, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  const noPlanDb = openWork(root, noPlan)
  try {
    noPlanDb.prepare("DELETE FROM artifacts WHERE artifact_id = 'plan:1'").run()
  } finally {
    noPlanDb.close()
  }
  const missingPlanRead = await s.readPlan(root, noPlan, 1)
  check('missing memo reads as undefined', missingPlanRead === undefined)
  const noMemoDb = openWork(root, noPlan)
  try {
    const noMemo = s.planApprovalState(noMemoDb, 1)
    check('planApprovalState exposes a missing memo', noMemo.hasMemo === false && noMemo.blocked === false, JSON.stringify(noMemo))
    await throws('assertPlanApproved rejects a missing memo', 'plan-not-found',
      () => s.assertPlanApproved(noMemoDb, 1))
  } finally {
    noMemoDb.close()
  }
  await throws('write without a memo is plan-not-found', 'plan-not-found',
    () => s.writeChapter(root, { work: noPlan, chapter: 1, body: '正文。'.repeat(20), requirePlanApproval: true }))

  const off = (await s.initWork(root, { title: '章纲关闭' })).workId
  await s.writeOutline(root, { work: off, mainline: '一条线' })
  await s.approveOutline(root, { work: off })
  await s.writePlan(root, { work: off, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  await s.updateSettings(root, { work: off, planApproval: 'off' })
  const offWrite = await s.writeChapter(root, { work: off, chapter: 1, body: '正文。'.repeat(20), requirePlanApproval: true })
  check('planApproval off bypasses the gate', offWrite.revision === 1, JSON.stringify(offWrite))

  const deleted = await s.deleteChapter(root, off, 1, { confirm: true })
  check('chapter delete removes the memo', deleted.changed === true && await s.readPlan(root, off, 1) === undefined, JSON.stringify(deleted))

  const broken = (await s.initWork(root, { title: '坏章纲' })).workId
  await s.writeOutline(root, { work: broken, mainline: '一条线' })
  await s.approveOutline(root, { work: broken })
  await s.writePlan(root, { work: broken, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  const brokenDb = openWork(root, broken)
  try {
    brokenDb.prepare("UPDATE artifacts SET content = '{}' WHERE artifact_id = 'plan:1'").run()
  } finally {
    brokenDb.close()
  }
  await throws('invalid memo shape is artifact-invalid', 'artifact-invalid', () => s.readPlan(root, broken, 1))
  await throws('story_read memo shape is artifact-invalid', 'artifact-invalid',
    () => readChapterMemo(root, { work: broken, chapter: 1 }))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
