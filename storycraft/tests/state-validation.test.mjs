// State delta preflight: normalization, facts, hook lifecycle and settle guard.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { normalizeStateDelta, validateStateDelta } from '../state-validation.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throws(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected error')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}
function pure(delta, folded) {
  return validateStateDelta(normalizeStateDelta(delta), folded)
}

const folded = {
  entities: [{ name: '甲', facts: ['旧事实'] }],
  hooks: [{ text: '门后的信', state: 'opened' }, { text: '旧信', state: 'resolved' }],
}

check('same-payload duplicate facts warn and stay', pure({
  entities: [{ name: '甲', facts: ['新事实', '新事实'] }],
}, folded).warnings.length === 1)
check('facts already in the projection warn', pure({
  entities: [{ name: '甲', facts: ['旧事实'] }],
}, folded).warnings[0].startsWith('duplicate-fact: 甲'))
check('opened then resolved in one payload is legal', pure({
  hooks: [{ text: '新线索', state: 'opened' }, { text: '新线索', state: 'resolved' }],
}, folded).warnings.length === 0)
throws('used on a missing hook is refused', 'hook-not-open', () => pure({
  hooks: [{ text: '不存在', state: 'used' }],
}, folded))
throws('resolved on a missing hook is refused', 'hook-not-found', () => pure({
  hooks: [{ text: '不存在', state: 'resolved' }],
}, folded))
throws('opening the same hook twice is refused', 'duplicate-hook', () => pure({
  hooks: [{ text: '新线索', state: 'opened' }, { text: '新线索', state: 'opened' }],
}, folded))
throws('resolved then used is refused', 'duplicate-hook', () => pure({
  hooks: [{ text: '旧信', state: 'used' }],
}, folded))

const root = await mkdtemp(join(tmpdir(), 'storycraft-state-'))
try {
  const work = s.initWork(root, { title: '状态预检' }).workId
  function ready(chapter) {
    s.writePlan(root, { work, chapter, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work, chapter })
    s.writeChapter(root, { work, chapter, body: `第 ${chapter} 章正文。` })
    s.writeReview(root, { work, chapter, problems: [] })
    s.writeSummary(root, { work, chapter, text: `第 ${chapter} 章摘要。` })
  }

  ready(1)
  const first = s.foldState(root, {
    work, chapter: 1,
    entities: [{ name: '甲', facts: ['旧事实'] }],
    hooks: [{ text: '门后的信', state: 'opened' }],
  })
  check('a clean delta settles without warnings', first.warnings.length === 0 && first.counts.entities === 1)

  ready(2)
  const second = s.foldState(root, {
    work, chapter: 2,
    entities: [{ name: '甲', facts: ['旧事实', '旧事实'] }],
    hooks: [{ text: '门后的信', state: 'opened' }, { text: '门后的信', state: 'resolved' }],
  })
  check('old and same-payload duplicate facts warn', second.warnings.length === 2, JSON.stringify(second.warnings))
  check('opened then resolved advances the hook', second.counts.resolved === 1 && second.hooks.includes('门后的信') === false)

  ready(3)
  const before = s.readEvents(root, work, 3).length
  throws('chapter-settled blocks a second settle', 'chapter-settled',
    () => s.foldState(root, { work, chapter: 1, entities: [{ name: '甲', facts: ['又一条'] }] }))
  throws('unknown resolved hook is refused before writing', 'hook-not-found',
    () => s.foldState(root, { work, chapter: 3, hooks: [{ text: '不存在', state: 'resolved' }] }))
  throws('unknown used hook is refused before writing', 'hook-not-open',
    () => s.foldState(root, { work, chapter: 3, hooks: [{ text: '不存在', state: 'used' }] }))
  throws('duplicate opened hook is refused before writing', 'duplicate-hook',
    () => s.foldState(root, { work, chapter: 3, hooks: [{ text: '门后的信', state: 'opened' }] }))
  check('failed preflight wrote no events', s.readEvents(root, work, 3).length === before)
  check('failed preflight left the chapter unsettled', s.readWork(root, work).chapters[2].stage !== 'settled')
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
