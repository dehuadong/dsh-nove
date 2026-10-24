// Test fixture helper: fills a body quote for review observations.
import * as s from '../storage.js'

export function reviewFixture(root, input) {
  if (Array.isArray(input.observations)) return s.writeReview(root, input)
  const problems = Array.isArray(input.problems) ? input.problems : []
  if (problems.length === 0) return s.writeReview(root, { ...input, observations: [] })
  let body
  try {
    body = s.readChapter(root, { work: input.work, chapter: input.chapter }).content
  } catch (error) {
    // Let writeReview surface the established body-not-found error.
    return s.writeReview(root, { work: input.work, chapter: input.chapter, observations: [] })
  }
  let revision
  try {
    revision = s.readManifest(root, input.work).chapters.find(chapter => chapter.number === input.chapter)?.currentRevision ?? 1
  } catch {
    revision = 1
  }
  const observations = problems.map((problem, index) => ({
    id: `O${index + 1}`,
    summary: problem.problem ?? '问题',
    evidence: [],
    category: 'quality',
    assessment: 'issue',
    ...(problem.severity === undefined ? {} : { severity: problem.severity }),
    ...(problem.fix === undefined && problem.suggestion === undefined ? {} : { fix: problem.fix ?? problem.suggestion }),
    sourceRefs: [{
      sourceId: `chapter:${input.chapter}:r${revision}`,
      quote: problem.quote ?? body.slice(0, 40),
    }],
  }))
  return s.writeReview(root, { work: input.work, chapter: input.chapter, observations })
}
