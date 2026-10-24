/** Review observations: source refs, review identity, reviser read and meta link. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initWork } from '../dist/storage.js'
import {
  approveChapterPlan, writeBible, writeChapter, writePlan, writeReview,
} from '../dist/store-db.js'
import { openWork } from '../dist/db.js'
import {
  readChapterMeta, readChapterObservations, writeChapterObservations,
} from '../dist/artifact-store.js'
import { loadRoleInput } from '../role-input.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function rejects(name, code, fn) {
  try {
    fn()
    check(name, false, '没有抛错')
  } catch (error) {
    check(name, error?.code === code, `${error?.code}: ${error?.message}`)
  }
}

const observation = {
  id: 'O1', code: 'hook-unsupported', summary: '伏笔没有推进', evidence: ['账本没有出现'],
  category: 'quality', assessment: 'issue',
  sourceRefs: [{ sourceId: 'chapter:1', quote: '甲把账本收好。' }],
  severity: 'major', fix: '补账本内容', mode: 'patch',
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-observations-'))
try {
  const { workId: work } = initWork(root, { title: '观察合同' })
  writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本',
    obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
  })
  approveChapterPlan(root, { work, chapter: 1 })
  writeBible(root, {
    work, name: 'characters',
    content: JSON.stringify([{ name: '甲', role: '主角', want: '救父', fear: '失去', limit: '不杀人', voice: '短句' }]),
  })
  writeChapter(root, { work, chapter: 1, title: '账本', body: '甲把账本收好。然后离开当铺。' })
  const written = writeChapterObservations(root, {
    work, chapter: 1, bodyRevision: 1, round: 1, observations: [observation],
  })
  check('review observations use the review identity',
    written.artifact.artifactId === 'review:1:r1:1' && written.artifact.kind === 'review'
    && written.artifact.scope.chapter === 1, JSON.stringify(written))
  const read = readChapterObservations(root, { work, chapter: 1, bodyRevision: 1, round: 1 })
  check('review observations read back with source refs',
    read.artifact.content.observations[0].sourceRefs[0].quote === '甲把账本收好。',
    JSON.stringify(read.artifact.content))
  check('chapter meta links the review artifact',
    readChapterMeta(root, { work, chapter: 1 }).chapterMeta.observationIds.includes('review:1:r1:1'))

  const loaded = await loadRoleInput(root, { work, role: 'reviser', chapter: 1 })
  check('the reviser reads observation summaries',
    loaded.review.open.length === 1 && loaded.review.open[0].problem === '伏笔没有推进',
    JSON.stringify(loaded.review))

  rejects('observations need a source quote', 'artifact-invalid',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 2,
      observations: [{ ...observation, sourceRefs: [{ sourceId: 'chapter:1' }] }],
    }))
  rejects('observations need at least one source ref', 'artifact-invalid',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 2,
      observations: [{ ...observation, sourceRefs: [] }],
    }))
  rejects('observation quotes must be in the source', 'observation-source-unverified',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 2,
      observations: [{ ...observation, sourceRefs: [{ sourceId: 'chapter:1', quote: '正文里没有这句话。' }] }],
    }))
  rejects('observation sources must be readable IDs', 'artifact-invalid',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 2,
      observations: [{ ...observation, sourceRefs: [{ sourceId: 'works/1.md', quote: '甲把账本收好。' }] }],
    }))
  rejects('observations reject an unknown severity', 'artifact-invalid',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 2,
      observations: [{ ...observation, severity: 'critical' }],
    }))
  rejects('review needs a positive body revision', 'artifact-invalid',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 0, round: 1, observations: [observation],
    }))
  rejects('review needs an existing body revision', 'body-not-found',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 9, round: 1, observations: [observation],
    }))
  rejects('review needs a positive round', 'artifact-invalid',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 0, observations: [observation],
    }))
  rejects('review needs an existing chapter', 'chapter-not-found',
    () => writeChapterObservations(root, {
      work, chapter: 99, bodyRevision: 1, round: 1, observations: [observation],
    }))
  writeChapterObservations(root, { work, chapter: 1, bodyRevision: 1, round: 3, observations: [] })
  check('a clean review has zero observations',
    readChapterObservations(root, { work, chapter: 1, bodyRevision: 1, round: 3 })
      .artifact.content.observations.length === 0)

  const db = openWork(root, work)
  db.prepare("UPDATE chapters SET stage = 'settled' WHERE number = 1").run()
  db.close()
  rejects('observations refuse a settled chapter', 'chapter-settled',
    () => writeChapterObservations(root, {
      work, chapter: 1, bodyRevision: 1, round: 4, observations: [observation],
    }))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
