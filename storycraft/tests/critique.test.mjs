// Quality layer: metrics, per-work word range, revision modes.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { critique } from '../critique.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
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

const line = '他把工具收进包里，抬头看了一眼天。'
const prose = `${line}${line}${line}风停了，空气仿佛凝固，他心里不禁一沉。与此同时，远处传来铁器碰撞的声音。`
const metrics = critique(prose)
check('words counts characters', metrics.words > 0, String(metrics.words))
check('sentences counted', metrics.sentences.count === 5, JSON.stringify(metrics.sentences))
check('repeated sentence detected', metrics.repeated.some(item => item.count === 3), JSON.stringify(metrics.repeated))
check('ai phrases detected', metrics.aiPhrases.count >= 3, JSON.stringify(metrics.aiPhrases))
check('dialogue ratio is a number', typeof metrics.dialogueRatio === 'number')
const again = critique(prose)
check('metrics are deterministic', JSON.stringify(again) === JSON.stringify(again) && JSON.stringify(again) === JSON.stringify(metrics))

// Word range boundaries.
const ranged = critique('字'.repeat(300), { min: 300, max: 500 })
check('exact min is within range', ranged.withinRange === true && ranged.shortBy === undefined)
const short = critique('字'.repeat(299), { min: 300, max: 500 })
check('below min reports shortBy', short.withinRange === false && short.shortBy === 1, JSON.stringify(short))
const long = critique('字'.repeat(501), { min: 300, max: 500 })
check('above max reports longBy', long.withinRange === false && long.longBy === 1, JSON.stringify(long))
check('no range means no verdict', critique(prose).withinRange === undefined)

const root = await mkdtemp(join(tmpdir(), 'storycraft-quality-'))
try {
  // Work-level range: validated at init and reflected in the brief.
  await rejects('bad range refused', 'word-range-invalid', () => s.initWork(root, { title: '坏范围', wordRange: { min: 500, max: 100 } }))
  const created = await s.initWork(root, { title: '字数设定', wordRange: { min: 200, max: 400 } })
  const work = created.workId
  const manifest = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(join(root, 'works', work, 'manifest.json'), 'utf8')))
  check('range stored on the manifest', manifest.wordRange?.min === 200 && manifest.wordRange?.max === 400, JSON.stringify(manifest.wordRange))

  const plan = { work, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' }
  await s.writePlan(root, { ...plan, chapter: 1 })
  const body = '字'.repeat(250)
  await s.writeChapter(root, { work, chapter: 1, body })
  const brief = await b.assembleBrief(root, work, 1)
  const policy = brief.sections.find(section => section.name === 'wordPolicy')
  check('brief cites the work range', policy.content.includes('200–400'), policy.content)

  // Settings: the range can be set and cleared after the fact.
  await s.updateSettings(root, { work, wordRange: { min: 100, max: 900 } })
  const afterSet = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(join(root, 'works', work, 'manifest.json'), 'utf8')))
  check('settings store the range', afterSet.wordRange?.min === 100 && afterSet.wordRange?.max === 900, JSON.stringify(afterSet.wordRange))
  await rejects('settings reject a bad range', 'word-range-invalid', () => s.updateSettings(root, { work, wordRange: { min: 500, max: 200 } }))
  await s.updateSettings(root, { work, wordRange: null })
  const afterClear = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(join(root, 'works', work, 'manifest.json'), 'utf8')))
  check('settings clear the range', afterClear.wordRange === undefined, JSON.stringify(afterClear.wordRange))

  // Revision modes.
  await s.writeReview(root, { work, chapter: 1, problems: [{ problem: '一处' }] })
  await rejects('patch rejects a large rewrite', 'revise-mode-violation', () => s.reviseChapter(root, {
    work, chapter: 1, body: '字'.repeat(400), problemIds: ['Q1'], mode: 'patch',
  }))
  const polish = await s.reviseChapter(root, {
    work, chapter: 1, body: '字'.repeat(300), problemIds: ['Q1'], mode: 'polish',
  })
  check('polish accepts a 20% change', polish.artifact.revision === 2)
  check('mode recorded on the entry', polish.entry.lastReviseMode === 'polish')

  await s.writeReview(root, { work, chapter: 1, problems: [{ problem: '两处' }] })
  const rewritten = await s.reviseChapter(root, {
    work, chapter: 1, body: `${'字'.repeat(600)}他心中不禁一沉。`, problemIds: ['Q1'], mode: 'rewrite',
  })
  check('rewrite accepts a big change', rewritten.entry.lastReviseMode === 'rewrite')

  await s.writeReview(root, { work, chapter: 1, problems: [{ problem: '三处' }] })
  await rejects('deslop must reduce the phrase hits', 'revise-mode-violation', () => s.reviseChapter(root, {
    work, chapter: 1, body: `${'字'.repeat(600)}他不禁又心中一沉，仿佛空气凝固。`, problemIds: ['Q1'], mode: 'deslop',
  }))

  // A polish pass needs no new review items: it improves prose, not findings.
  await s.writeReview(root, { work, chapter: 1, problems: [{ problem: '四处' }] })
  const patched = await s.reviseChapter(root, {
    work, chapter: 1, body: `${'字'.repeat(600)}换了一处说法，别的不动。`, problemIds: ['Q1'], mode: 'patch',
  })
  check('patch lands', patched.entry.lastReviseMode === 'patch')
  const polishedAgain = await s.reviseChapter(root, {
    work, chapter: 1, body: `${'字'.repeat(600)}换了一处说法，别的不动，语气再顺一点。`, mode: 'polish',
  })
  check('polish runs without items', polishedAgain.entry.lastReviseMode === 'polish')

  // A body with no hits has nothing to remove: deslop is a no-op there, not an error.
  const clean = (await s.initWork(root, { title: '干净正文' })).workId
  await s.writePlan(root, { ...plan, work: clean, chapter: 1 })
  await s.writeChapter(root, { work: clean, chapter: 1, body: '他把工具收进包里。'.repeat(20) })
  await s.writeReview(root, { work: clean, chapter: 1, problems: [{ problem: '一处' }] })
  const deslopped = await s.reviseChapter(root, {
    work: clean, chapter: 1, body: '他把工具收进包里，抬头看了一眼天。'.repeat(20), problemIds: ['Q1'], mode: 'deslop',
  })
  check('deslop accepts a body with no hits', deslopped.entry.lastReviseMode === 'deslop')
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
