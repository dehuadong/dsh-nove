// The workbench state model: one primary action per step, with disabled reasons.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { deriveWorkbench } from '../src/workbench.ts'
import { writeFoundationDocument } from '../src/artifact-store.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-workbench-'))
try {
  const state = async (work) => {
    const [next, manifest] = await Promise.all([s.nextStep(root, work), s.readManifest(root, work)])
    return deriveWorkbench({ next, manifest })
  }
  let serial = 0
  const fresh = (options = {}) => {
    serial += 1
    return s.initWork(root, {
      title: `状态模型 ${serial}`, wordRange: { min: 10, max: 5000 }, ...options,
    }).workId
  }

  // foundation-needed: a long-form work with no foundation and no outline.
  const foundationWork = fresh()
  const foundation = await state(foundationWork)
  check('a fresh long-form work asks for foundation',
    foundation.key === 'foundation-needed' && foundation.primary.id === 'architect', JSON.stringify(foundation))

  // foundation-pending: the pure mapping over a foundation gate.
  const foundationPending = deriveWorkbench({
    next: { chapter: 1, action: 'story_architect', reason: '基础设定已生成，等作者确认', blocked: ['foundation-approval'] },
    manifest: { form: 'longform' },
  })
  check('a complete but unconfirmed foundation waits for the author',
    foundationPending.key === 'foundation-pending' && foundationPending.primary.id === 'confirm-foundation'
    && foundationPending.hint.includes('基础设定等作者确认'), JSON.stringify(foundationPending))

  // outline-needed: short form skips foundation.
  const shortWork = fresh({ form: 'short' })
  const outlineNeeded = await state(shortWork)
  check('a fresh short-form work asks for the outline',
    outlineNeeded.key === 'outline-needed' && outlineNeeded.primary.id === 'write-outline', JSON.stringify(outlineNeeded))
  check('the primary label follows the unit',
    outlineNeeded.primary.label === '写全书计划', outlineNeeded.primary.label)

  // outline-pending: written but not approved.
  const outlineWork = fresh({ form: 'short' })
  s.writeOutline(root, { work: outlineWork, mainline: '一条主线' })
  const outlinePending = await state(outlineWork)
  check('a written outline waits for the author',
    outlinePending.key === 'outline-pending' && outlinePending.primary.id === 'confirm-outline'
    && outlinePending.hint.includes('全书计划等作者确认')
    && outlinePending.secondary.some(item => item.id === 'rewrite-outline')
    && outlinePending.secondary.some(item => item.id === 'open-outline'), JSON.stringify(outlinePending))

  // plan-needed: outline approved, no chapters.
  s.approveOutline(root, { work: outlineWork })
  const planNeeded = await state(outlineWork)
  check('an approved outline asks for the first plan',
    planNeeded.key === 'plan-needed' && planNeeded.primary.id === 'write-plan'
    && planNeeded.primary.label === '写第 1 篇的章纲'
    && planNeeded.secondary.some(item => item.id === 'open-outline'), JSON.stringify(planNeeded))

  // plan-pending: plan written, not approved.
  const chapterWork = fresh({ form: 'short' })
  s.writeOutline(root, { work: chapterWork, mainline: '一条主线' })
  s.approveOutline(root, { work: chapterWork })
  s.writePlan(root, {
    work: chapterWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [],
  })
  const planPending = await state(chapterWork)
  check('a written plan waits for the author',
    planPending.key === 'plan-pending' && planPending.primary.id === 'confirm-plan'
    && planPending.primary.label === '确认第 1 篇的章纲'
    && planPending.hint.includes('章纲等作者确认')
    && planPending.secondary.some(item => item.id === 'rewrite-plan'), JSON.stringify(planPending))

  // The outline gate wins over a later chapter plan.
  s.writeOutline(root, { work: chapterWork, mainline: '改过的主线' })
  const outlineOverPlan = await state(chapterWork)
  check('the outline gate wins over the chapter step',
    outlineOverPlan.key === 'outline-pending', JSON.stringify(outlineOverPlan))
  s.approveOutline(root, { work: chapterWork })

  // planApproval off: no plan-pending state exists.
  s.updateSettings(root, { work: chapterWork, planApproval: 'off' })
  s.writePlan(root, {
    work: chapterWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b2', threadRefs: [],
  })
  const withoutGate = await state(chapterWork)
  check('plan approval off never blocks', withoutGate.key === 'writing', JSON.stringify(withoutGate))
  s.updateSettings(root, { work: chapterWork, planApproval: 'required' })
  s.approveChapterPlan(root, { work: chapterWork, chapter: 1 })

  // writing / reviewing / revising / summarizing / settling.
  const writing = await state(chapterWork)
  check('an approved plan asks for the chapter',
    writing.key === 'writing' && writing.primary.id === 'write-chapter'
    && writing.primary.label === '写第 1 篇（写到修订）'
    && writing.secondary.some(item => item.id === 'full-flow'), JSON.stringify(writing))

  s.writeChapter(root, { work: chapterWork, chapter: 1, title: '一', body: '正文。'.repeat(40) })
  const reviewing = await state(chapterWork)
  check('a written chapter asks for review',
    reviewing.key === 'reviewing' && reviewing.primary.id === 'review'
    && reviewing.secondary.find(item => item.id === 'revise')?.disabled?.code === 'no-items', JSON.stringify(reviewing))

  s.writeReview(root, {
    work: chapterWork, chapter: 1,
    observations: [{
      id: 'O1', summary: '慢', evidence: ['e'], category: 'quality', assessment: 'issue',
      sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '正文。'.repeat(5) }],
    }],
  })
  const revising = await state(chapterWork)
  check('open observations ask for a revision',
    revising.key === 'revising' && revising.primary.id === 'revise'
    && revising.secondary.find(item => item.id === 'summarize')?.disabled?.code === 'open-items', JSON.stringify(revising))

  s.reviseChapter(root, { work: chapterWork, chapter: 1, body: '正文。'.repeat(42), problemIds: ['O1'], mode: 'rewrite' })
  s.writeReview(root, { work: chapterWork, chapter: 1, observations: [] })
  const summarizing = await state(chapterWork)
  check('a clean review asks for the summary',
    summarizing.key === 'summarizing' && summarizing.primary.id === 'summarize'
    && summarizing.secondary.some(item => item.id === 'export'), JSON.stringify(summarizing))

  s.writeSummary(root, { work: chapterWork, chapter: 1, text: '甲做了事。' })
  const settling = await state(chapterWork)
  check('a current summary asks to settle',
    settling.key === 'settling' && settling.primary.id === 'settle', JSON.stringify(settling))

  s.settleState(root, { work: chapterWork, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '完成' }] } })
  const nextPlan = await state(chapterWork)
  check('a settled chapter asks for the next plan',
    nextPlan.key === 'plan-needed' && nextPlan.primary.id === 'write-plan', JSON.stringify(nextPlan))

  // volume-summary: the closing volume has no summary yet.
  s.writeVolume(root, { work: chapterWork, id: 'v1', title: '第一卷', from: 1, to: 1 })
  const volume = await state(chapterWork)
  check('a closing volume asks for its summary',
    volume.key === 'volume-summary' && volume.primary.id === 'volume-summary'
    && volume.secondary.some(item => item.id === 'next-plan'), JSON.stringify(volume))

  const seen = [foundation, outlineNeeded, outlinePending, planNeeded, planPending, writing, reviewing,
    revising, summarizing, settling, volume, foundationPending]
  check('a settled chapter returns to the plan state', nextPlan.key === 'plan-needed' && nextPlan.primary.id === 'write-plan', JSON.stringify(nextPlan))
  check('every state names its primary action',
    seen.every(item => typeof item.primary.label === 'string' && item.primary.label !== '')
    && new Set(seen.map(item => `${item.key}:${item.primary.id}`)).size === seen.length,
    seen.map(item => `${item.key}:${item.primary.id}`).join(','))

  // A re-written plan invalidates the approval: the plan gate wins over revise.
  const blockedWork = fresh({ form: 'short' })
  s.writeOutline(root, { work: blockedWork, mainline: '一条主线' })
  s.approveOutline(root, { work: blockedWork })
  s.writePlan(root, {
    work: blockedWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [],
  })
  s.approveChapterPlan(root, { work: blockedWork, chapter: 1 })
  s.writeChapter(root, { work: blockedWork, chapter: 1, title: '一', body: '正文。'.repeat(40) })
  s.writeReview(root, {
    work: blockedWork, chapter: 1,
    observations: [{
      id: 'O1', summary: '慢', evidence: ['e'], category: 'quality', assessment: 'issue',
      sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '正文。'.repeat(5) }],
    }],
  })
  s.writePlan(root, {
    work: blockedWork, chapter: 1, perspective: '甲', goal: 'g2', obstacle: 'o', cost: 'c', turn: 't', body: 'b2', threadRefs: [],
  })
  const gated = await state(blockedWork)
  check('an unconfirmed plan blocks the revision step',
    gated.key === 'plan-pending', JSON.stringify(gated))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
