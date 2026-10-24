// #52: review observations carry stable ids, resolved evidence, and gate settlement.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { openWork } from '../db.js'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-observation-consumers-'))
try {
  const work = s.initWork(root, { title: '审稿收口', wordRange: { min: 50, max: 5000 } }).workId
  const body = '甲把账本收好，然后离开当铺。雨还在下。'.repeat(4)
  s.writeBible(root, { work, name: 'characters', content: JSON.stringify([{ name: '甲', role: '主角', want: 'w', fear: 'f', limit: 'l', voice: 'v' }]) })
  const plan = s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  check('the plan is written', plan !== undefined)
  throwsCode('review without a body is refused', 'body-not-found', () => s.writeReview(root, { work, chapter: 1, observations: [] }))
  s.writeChapter(root, { work, chapter: 1, title: '账本', body })

  const first = s.writeReview(root, {
    work, chapter: 1,
    observations: [{
      id: 'O1', summary: '伏笔没有推进', evidence: ['账本'], category: 'quality', assessment: 'issue',
      severity: 'major', fix: '补账本内容',
      sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '甲把账本收好' }],
    }],
  })
  check('review writes an observation artifact', first.round === 1 && first.artifactId === 'review:1:r1:1', JSON.stringify(first))
  check('review stores the stable id', s.readReview(root, work, 1).observations[0].id === 'O1')
  throwsCode('duplicate observation ids are refused', 'artifact-invalid', () => s.writeReview(root, {
    work, chapter: 1,
    observations: [
      { id: 'O1', summary: 'a', evidence: [], category: 'quality', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '甲把账本收好' }] },
      { id: 'O1', summary: 'b', evidence: [], category: 'quality', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '甲把账本收好' }] },
    ],
  }))
  throwsCode('an unquoted observation is refused', 'observation-source-unverified', () => s.writeReview(root, {
    work, chapter: 1,
    observations: [{
      id: 'O1', summary: 'x', evidence: [], category: 'quality', assessment: 'issue',
      sourceRefs: [{ sourceId: 'chapter:1:r1', quote: '不在正文里的句子' }],
    }],
  }))
  const open = s.nextStep(root, work)
  check('an open issue points at revision', open.action === 'story_revise' && open.missing?.includes('O1'), JSON.stringify(open))

  s.reviseChapter(root, { work, chapter: 1, body: '甲把账本收好，翻到最后一页，记下编号。'.repeat(4), problemIds: ['O1'], mode: 'rewrite' })
  check('revision does not self-close the issue', s.latestReview(root, work, 1).items[0].done === false)
  throwsCode('settle waits for a fresh review', 'review-required', () => s.settleState(root, { work, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '拿到账本' }] } }))

  const resolved = s.writeReview(root, {
    work, chapter: 1,
    observations: [{
      id: 'O1', summary: '已补账本编号', evidence: [], category: 'quality', assessment: 'resolved', resolves: 'O1',
      sourceRefs: [{ sourceId: 'chapter:1:r2', quote: '记下编号' }],
    }],
  })
  check('a later review can resolve an earlier issue', resolved.round === 2
    && s.readReview(root, work, 1).observations[0].assessment === 'resolved', JSON.stringify(resolved))
  s.writeSummary(root, { work, chapter: 1, text: '甲拿到账本编号。' })
  const settled = s.settleState(root, { work, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '拿到账本' }] } })
  check('a resolved current-revision review settles', s.readManifest(root, work).chapters[0].stage === 'settled', JSON.stringify(settled))

  const db = openWork(root, work)
  try {
    check('the reviews table is gone', db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reviews'").get() === undefined)
  } finally {
    db.close()
  }
  const exported = s.exportWork(root, work, join(root, 'out'))
  const { readFile } = await import('node:fs/promises')
  const reviewFile = await readFile(join(exported.directory, 'reviews', 'ch-0001.r1.md'), 'utf8')
  check('export renders observation reviews', reviewFile.includes('O1') && reviewFile.includes('伏笔没有推进'), reviewFile)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
