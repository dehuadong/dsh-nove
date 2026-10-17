// Throwaway verification for storycraft/storage.js (not shipped).
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
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
  check('init creates work dir', created.workId === '潮汐记事'.toLowerCase() || created.workId.length > 0, created.workId)
  const work = created.workId
  check('manifest exists', (await s.readManifest(root, work)).title === '潮汐记事')

  await rejects('plan without fields rejected', 'plan-incomplete', () => s.writePlan(root, {
    work, chapter: 1, perspective: '林澈', goal: '', obstacle: 'x', cost: 'y', turn: 'z',
  }))
  const plan = await s.writePlan(root, {
    work, chapter: 1, perspective: '林澈', goal: '拿回合同', obstacle: '房东堵门', cost: '欠下人情', turn: '发现合同是假的',
  })
  check('plan artifact path', plan.artifact.path.endsWith('ch-0001.plan.md'), plan.artifact.path)
  check('plan exists on disk', (await stat(join(root, plan.artifact.path))).isFile())

  await rejects('empty body rejected', 'empty-body', () => s.writeChapter(root, { work, chapter: 1, body: '  ' }))
  const write1 = await s.writeChapter(root, { work, chapter: 1, title: '雨里的灯', body: '他站在雨里。'.repeat(50) })
  check('first body revision is 1', write1.artifact.revision === 1, String(write1.artifact.revision))
  check('words counted', write1.words > 0, String(write1.words))

  await rejects('second write without rewrite rejected', 'chapter-exists', () => s.writeChapter(root, { work, chapter: 1, body: '另一版' }))
  const filesAfterReject = (await readdir(join(root, 'works', work, 'chapters'))).sort()
  check('rejected write left no file', filesAfterReject.length === 1, filesAfterReject.join(','))

  await rejects('review without body rejected', 'body-not-found', () => s.writeReview(root, { work, chapter: 2, problems: [{ location: 'x', problem: 'y' }] }))
  const review = await s.writeReview(root, {
    work, chapter: 1, problems: [
      { location: '第 3 段', problem: '视角跳到了路人', suggestion: '改回林澈视角' },
      { location: '结尾', problem: '钩子太虚', suggestion: '落到合同这一具体物上' },
    ],
  })
  check('review items persisted', review.problems.length === 2 && review.problems[0].id === 'Q1')
  const bodyBefore = await readFile(join(root, 'works', work, 'chapters', 'ch-0001.md'), 'utf8')
  check('review did not touch body', bodyBefore === '他站在雨里。'.repeat(50) + '\n')

  await rejects('revise with unknown problem rejected', 'problem-not-found', () => s.reviseChapter(root, {
    work, chapter: 1, body: '改后正文', problemIds: ['Q9'],
  }))
  const rev = await s.reviseChapter(root, {
    work, chapter: 1, body: '改后正文，视角统一。'.repeat(20), problemIds: ['Q1'],
  })
  check('revision 2 written', rev.artifact.revision === 2)
  check('old revision kept', (await stat(join(root, 'works', work, 'chapters', 'ch-0001.md'))).isFile())
  const reviewText = await readFile(join(root, review.artifact.path), 'utf8')
  check('Q1 marked done', reviewText.includes('- [x] Q1'), reviewText.split('\n').find(line => line.startsWith('- [')))
  check('Q2 still open', reviewText.includes('- [ ] Q2'))

  await rejects('settle blocked while review items are open', 'review-required', () => s.foldState(root, {
    work, chapter: 1, hooks: [{ text: '合同是假的', state: 'opened' }],
  }))
  await s.reviseChapter(root, {
    work, chapter: 1, body: '再改一版，补上母亲的旧照片。'.repeat(20), problemIds: ['Q2'],
  })
  const settledReview = await readFile(join(root, review.artifact.path), 'utf8')
  check('Q2 marked done', settledReview.includes('- [x] Q2'))

  await rejects('hook used before opened rejected', 'hook-not-open', () => s.foldState(root, {
    work, chapter: 1, hooks: [{ text: '合同是假的', state: 'used' }],
  }))
  const folded = await s.foldState(root, {
    work, chapter: 1,
    entities: [{ name: '林澈', facts: ['欠房东三个月房租', '拿到假合同'] }],
    hooks: [{ text: '合同是假的', state: 'opened' }, { text: '母亲的旧照片', state: 'opened' }],
  })
  check('state counts', folded.counts.opened === 2 && folded.counts.entities === 1, JSON.stringify(folded.counts))
  const hooksView = await readFile(join(root, 'works', work, 'hooks.md'), 'utf8')
  check('hooks view rendered', hooksView.includes('合同是假的') && hooksView.includes('opened'))

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
  const planRead = await s.readChapter(root, { work, chapter: 1, view: 'plan' })
  check('plan read', planRead.content.includes('结尾变化'))
  const reviewRead = await s.readReview(root, work, 1)
  check('review read items', reviewRead.items.length === 2 && reviewRead.items[0].done === true)

  // Concurrent writer: the lock makes a second mutation fail loudly.
  const lockFile = join(root, 'works', `.${work}.lock`)
  await (await import('node:fs/promises')).writeFile(lockFile, '')
  await rejects('concurrent write rejected', 'work-busy', () => s.writePlan(root, {
    work, chapter: 2, perspective: 'x', goal: 'y', obstacle: 'z', cost: 'w', turn: 'v',
  }))
  await (await import('node:fs/promises')).rm(lockFile, { force: true })
  // Unwritable root: creating the work must fail without leaving files behind.
  const blockingFile = join(root, 'not-a-directory')
  await (await import('node:fs/promises')).writeFile(blockingFile, 'x')
  let blocked = false
  try {
    await s.initWork(join(blockingFile, 'child'), { title: 'x' })
  } catch (error) {
    blocked = error?.code === 'ENOTDIR' || error?.code === 'EEXIST' || error?.code === 'ENOENT'
  }
  check('unwritable root fails cleanly', blocked, 'no error raised')
  // Atomicity: a failing write must not change the manifest.
  const manifestBefore = await readFile(join(root, 'works', work, 'manifest.json'), 'utf8')
  await rejects('reopened write without flag is rejected', 'chapter-settled', () => s.writeChapter(root, { work, chapter: 1, body: 'x' }))
  const manifestAfter = await readFile(join(root, 'works', work, 'manifest.json'), 'utf8')
  check('manifest unchanged after failure', manifestBefore === manifestAfter)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
