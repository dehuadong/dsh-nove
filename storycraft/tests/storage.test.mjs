// Public storage facade: virtual paths, error codes and the writing pipeline.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function rejects(name, code, fn) {
  try {
    await fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-test-'))
try {
  const created = await s.initWork(root, { title: '潮汐记事', form: 'longform' })
  check('init returns a work id', created.workId.length > 0, created.workId)
  const work = created.workId
  check('manifest exists', (await s.readManifest(root, work)).title === '潮汐记事')

  await rejects('plan without fields rejected', 'plan-incomplete', () => s.writePlan(root, {
    work, chapter: 1, perspective: '林澈', goal: '', obstacle: 'x', cost: 'y', turn: 'z',
  }))
  const plan = await s.writePlan(root, {
    work, chapter: 1, perspective: '林澈', goal: '拿回合同', obstacle: '房东堵门', cost: '欠下人情', turn: '发现合同是假的',
  })
  check('plan artifact is a virtual path', plan.artifact.path === `works/${work}/outline/ch-0001.plan.md`, plan.artifact.path)
  check('virtual paths do not exist on disk', await stat(join(root, plan.artifact.path)).then(() => false).catch(() => true))

  const beforeApproval = (await s.readWork(root, work)).chapters[0]
  check('a new plan starts unapproved', beforeApproval.planApproved === false, JSON.stringify(beforeApproval))
  const approved = await s.approveChapterPlan(root, { work, chapter: 1 })
  check('approval records a timestamp', typeof approved.entry.planApprovedAt === 'string')
  const afterApproval = (await s.readWork(root, work)).chapters[0]
  check('readWork exposes the approval', afterApproval.planApproved === true, JSON.stringify(afterApproval))

  await rejects('empty body rejected', 'empty-body', () => s.writeChapter(root, { work, chapter: 1, body: '  ' }))
  const write1 = await s.writeChapter(root, { work, chapter: 1, title: '雨里的灯', body: '他站在雨里。'.repeat(50) })
  check('first body revision is 1', write1.artifact.revision === 1, String(write1.artifact.revision))
  check('words counted', write1.words > 0, String(write1.words))
  check('body path is virtual and versioned', write1.artifact.path === `works/${work}/chapters/ch-0001.md`, write1.artifact.path)

  await s.writePlan(root, { work, chapter: 1, perspective: '林澈', goal: '拿回合同（改）', obstacle: '房东堵门', cost: '欠下人情', turn: '发现合同是假的' })
  const afterReplan = (await s.readWork(root, work)).chapters[0]
  check('rewriting the plan clears the approval', afterReplan.planApproved === false, JSON.stringify(afterReplan))
  await s.approveChapterPlan(root, { work, chapter: 1 })

  await rejects('second write without rewrite rejected', 'chapter-exists', () => s.writeChapter(root, { work, chapter: 1, body: '另一版' }))
  const versions = (await s.readManifest(root, work)).chapters[0].currentRevision
  check('rejected write left the revision untouched', versions === 1, String(versions))

  await rejects('review without body rejected', 'body-not-found', () => s.writeReview(root, { work, chapter: 2, problems: [{ location: 'x', problem: 'y' }] }))
  const review = await s.writeReview(root, {
    work, chapter: 1, problems: [
      { location: '第 3 段', problem: '视角跳到了路人', suggestion: '改回林澈视角' },
      { location: '结尾', problem: '钩子太虚', suggestion: '落到合同这一具体物上' },
    ],
  })
  check('review items persisted', review.problems.length === 2 && review.problems[0].id === 'Q1')
  check('review path is virtual', review.artifact.path === `works/${work}/reviews/ch-0001.r1.md`, review.artifact.path)

  await rejects('revise with unknown problem rejected', 'problem-not-found', () => s.reviseChapter(root, {
    work, chapter: 1, body: '改后正文', problemIds: ['Q9'],
  }))
  const rev = await s.reviseChapter(root, {
    work, chapter: 1, body: '改后正文，视角统一。'.repeat(20), problemIds: ['Q1'], mode: 'rewrite',
  })
  check('revision 2 written', rev.artifact.revision === 2)
  check('old revision kept', (await s.readChapter(root, { work, chapter: 1, revision: 1 })).content.startsWith('他站在雨里'))
  const reviewItems = (await s.readReview(root, work, 1)).items
  check('Q1 marked done', reviewItems.find(item => item.id === 'Q1')?.done === true)
  check('Q2 still open', reviewItems.find(item => item.id === 'Q2')?.done === false)

  await rejects('settle blocked while review items are open', 'review-required', () => s.foldState(root, {
    work, chapter: 1, hooks: [{ text: '合同是假的', state: 'opened' }],
  }))
  // The body changed, so the old list no longer describes it: review again.
  await rejects('stale review cannot drive another patch', 'review-required', () => s.reviseChapter(root, {
    work, chapter: 1, body: '再改一版，补上母亲的旧照片。'.repeat(20), problemIds: ['Q2'],
  }))
  await s.writeReview(root, {
    work, chapter: 1, problems: [{ location: '结尾', problem: '照片收得太快', suggestion: '补一拍' }],
  })
  await s.reviseChapter(root, {
    work, chapter: 1, body: '再改一版，补上母亲的旧照片。'.repeat(20), problemIds: ['Q1'], mode: 'rewrite',
  })

  let missingSummary
  try {
    await s.readChapter(root, { work, chapter: 1, view: 'summary' })
  } catch (error) {
    missingSummary = error.code
  }
  check('summary read before writing reports summary-not-found', missingSummary === 'summary-not-found', String(missingSummary))
  await rejects('settle without a summary is refused', 'summary-required', () => s.foldState(root, {
    work, chapter: 1, entities: [{ name: '林澈', facts: ['拿到假合同'] }],
  }))
  await s.writeSummary(root, { work, chapter: 1, text: '林澈拿到假合同，母亲留下旧照片。' })
  await rejects('hook used before opened rejected', 'hook-not-open', () => s.foldState(root, {
    work, chapter: 1, hooks: [{ text: '合同是假的', state: 'used' }],
  }))
  const folded = await s.foldState(root, {
    work, chapter: 1,
    entities: [{ name: '林澈', facts: ['欠房东三个月房租', '拿到假合同'] }],
    hooks: [{ text: '合同是假的', state: 'opened' }, { text: '母亲的旧照片', state: 'opened' }],
  })
  check('state counts', folded.counts.opened === 2 && folded.counts.entities === 1, JSON.stringify(folded.counts))
  check('state artifact points at the event log', folded.artifact.path === `works/${work}/state/events.jsonl`, folded.artifact.path)

  const status = await s.status(root, work)
  check('status writtenChapters = 1', status.writtenChapters === 1)
  check('status hooks opened = 2', status.hooks.opened === 2, JSON.stringify(status.hooks))
  check('status latestChapter = 1', status.latestChapter === 1)

  const works = await s.listWorks(root)
  check('listWorks finds the work', works.length === 1 && works[0].workId === work)

  const detail = await s.readWork(root, work)
  check('detail chapters include plan flag', detail.chapters[0].hasPlan === true)
  check('detail review openProblems', detail.chapters[0].openProblems === 0, String(detail.chapters[0].openProblems))
  check('detail stage is settled', detail.chapters[0].stage === 'settled', String(detail.chapters[0].stage))
  check('detail entities folded', detail.state.entities.length === 1)

  const chapter = await s.readChapter(root, { work, chapter: 1 })
  check('chapter current revision = 3', chapter.revision === 3, String(chapter.revision))
  check('chapter path is virtual', chapter.path === `works/${work}/chapters/ch-0001.r3.md`, chapter.path)
  const planRead = await s.readChapter(root, { work, chapter: 1, view: 'plan' })
  check('plan read', planRead.content.includes('结尾变化'))
  const summaryRead = await s.readChapter(root, { work, chapter: 1, view: 'summary' })
  check('summary read returns the written text', summaryRead.content.includes('假合同'), summaryRead.content.slice(0, 80))

  // Unwritable root: creating the work must fail without leaving files behind.
  const blockingFile = join(root, 'not-a-directory')
  await writeFile(blockingFile, 'x')
  let blocked = false
  try {
    await s.initWork(join(blockingFile, 'child'), { title: 'x' })
  } catch (error) {
    blocked = error?.code === 'ENOTDIR' || error?.code === 'EEXIST' || error?.code === 'ENOENT'
  }
  check('unwritable root fails cleanly', blocked, 'no error raised')

  // Atomicity: a failing write must not change the work.
  const before = JSON.stringify(await s.readManifest(root, work))
  await rejects('reopened write without flag is rejected', 'chapter-settled', () => s.writeChapter(root, { work, chapter: 1, body: 'x' }))
  check('work unchanged after failure', JSON.stringify(await s.readManifest(root, work)) === before)

  // The confirmation policy is per work: required by default, opt-out allowed.
  const policyWork = (await s.initWork(root, { title: '策略测试' })).workId
  await s.writeOutline(root, { work: policyWork, mainline: '一条主线' })
  const beforeOutlineApproval = await s.readWork(root, policyWork)
  check('a new plan starts unconfirmed', beforeOutlineApproval.manifest.outline?.approvedAt === undefined,
    JSON.stringify(beforeOutlineApproval.manifest.outline))
  await s.approveOutline(root, { work: policyWork })
  const afterOutlineApproval = await s.readWork(root, policyWork)
  check('host approval is recorded', typeof afterOutlineApproval.manifest.outline?.approvedAt === 'string',
    JSON.stringify(afterOutlineApproval.manifest.outline))
  await s.writeOutline(root, { work: policyWork, mainline: '一条主线（改）' })
  const afterOutlineRewrite = await s.readWork(root, policyWork)
  check('rewriting the plan clears the confirmation', afterOutlineRewrite.manifest.outline?.approvedAt === undefined,
    JSON.stringify(afterOutlineRewrite.manifest.outline))

  await s.writePlan(root, { work: policyWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  const defaultPolicy = (await s.readWork(root, policyWork)).manifest.planApproval
  check('confirmation is required by default', defaultPolicy === 'required', String(defaultPolicy))
  await rejects('required policy blocks an unconfirmed chapter', 'plan-not-approved',
    () => s.writeChapter(root, { work: policyWork, chapter: 1, body: '正文。'.repeat(60), requirePlanApproval: true }))
  const switched = await s.updateSettings(root, { work: policyWork, planApproval: 'off' })
  check('policy can be switched off', switched.planApproval === 'off', JSON.stringify(switched))
  const offWrite = await s.writeChapter(root, { work: policyWork, chapter: 1, body: '正文。'.repeat(60), requirePlanApproval: true })
  check('off policy allows writing without confirmation', offWrite.artifact.revision === 1, JSON.stringify(offWrite.artifact))

} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1


