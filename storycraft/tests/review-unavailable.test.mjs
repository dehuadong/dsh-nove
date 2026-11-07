// An unavailable review records a review round without inventing a quote.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { readArtifact } from '../src/artifact-store.ts'
import { validateObservation } from '../src/artifact-contract.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function codeOf(fn) {
  try {
    fn()
    return 'none'
  } catch (error) {
    return error?.code ?? String(error)
  }
}

check('unavailable observation may omit sourceRefs', (() => {
  try {
    validateObservation({
      id: 'O1', code: 'review-unavailable', summary: '审稿暂不可用', evidence: [],
      category: 'quality', assessment: 'unavailable', sourceRefs: [],
    })
    return true
  } catch {
    return false
  }
})())
check('issue observation still needs a quote', codeOf(() => validateObservation({
  id: 'O1', summary: '问题', evidence: [], category: 'quality', assessment: 'issue', sourceRefs: [],
})) === 'artifact-invalid')

const root = await mkdtemp(join(tmpdir(), 'storycraft-review-unavailable-'))
try {
  const { workId: work } = s.initWork(root, { title: '审稿回退' })
  s.writeOutline(root, { work, mainline: '一条线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, body: '正文。'.repeat(20) })
  const review = s.writeReview(root, {
    work, chapter: 1,
    observations: [{
      code: 'review-unavailable', summary: '审稿暂不可用：fixture', evidence: [],
      category: 'quality', assessment: 'unavailable', sourceRefs: [],
    }],
  })
  check('unavailable review writes a round', review.round === 1 && review.observations.length === 1, JSON.stringify(review))
  const artifact = readArtifact(root, { work, artifactId: review.artifactId })
  const parsed = artifact.artifact.content
  check('unavailable review keeps the empty quote list', parsed.observations[0].sourceRefs.length === 0, JSON.stringify(parsed))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
