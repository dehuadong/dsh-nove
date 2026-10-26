/** v2 hook/fact ops: projections, transitions, and the settlement write path. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyFactOp, applyHookOp, projectFacts, projectHooks } from '../dist/state-projection.js'
import { initWork, readFoldedState } from '../dist/storage.js'
import {
  approveChapterPlan, readEvents, settleState, writeChapter, writePlan, writeReview, writeSummary,
} from '../dist/store-db.js'

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

const baseHook = {
  hookId: 'h_1', startChapter: 0, type: '物件', status: 'open',
  lastAdvancedChapter: 0, expectedPayoff: '账本真相', notes: '开书伏笔',
  dependsOn: [], paysOffInArc: '第一卷', text: '账本里夹着一张旧照片',
}

const hookEvents = []
hookEvents.push(applyHookOp(hookEvents, { op: 'upsert', hook: baseHook }).event)
check('upsert creates an open hook', projectHooks(hookEvents)[0].status === 'open')
const metadataOnly = applyHookOp(hookEvents, {
  op: 'upsert', hook: { ...baseHook, text: '旧照片背面有字', expectedPayoff: '旧案真相' },
})
hookEvents.push(metadataOnly.event)
check('upsert changes metadata but keeps status',
  metadataOnly.state.hooks[0].status === 'open' && metadataOnly.state.hooks[0].text === '旧照片背面有字')
const advancedIgnored = applyHookOp(hookEvents, {
  op: 'upsert', hook: { ...baseHook, lastAdvancedChapter: 9 },
})
check('upsert cannot move lastAdvancedChapter',
  advancedIgnored.state.hooks[0].lastAdvancedChapter === 0, JSON.stringify(advancedIgnored.state.hooks[0]))
rejects('upsert cannot change status', 'hook-transition-invalid',
  () => applyHookOp(hookEvents, { op: 'upsert', hook: { ...baseHook, status: 'resolved' } }))
rejects('a new hook cannot start resolved', 'hook-transition-invalid',
  () => applyHookOp([], { op: 'upsert', hook: { ...baseHook, hookId: 'h_2', status: 'resolved' } }))
const mention = applyHookOp(hookEvents, { op: 'mention', hookId: 'h_1', chapter: 2 })
hookEvents.push(mention.event)
check('mention keeps status and lastAdvanced',
  mention.state.hooks[0].status === 'open' && mention.state.hooks[0].lastAdvancedChapter === 0,
  JSON.stringify(mention.state.hooks[0]))
const progress = applyHookOp(hookEvents, { op: 'progress', hookId: 'h_1', chapter: 3 })
hookEvents.push(progress.event)
check('progress advances status and chapter',
  progress.state.hooks[0].status === 'progressing' && progress.state.hooks[0].lastAdvancedChapter === 3,
  JSON.stringify(progress.state.hooks[0]))
const progressAgain = applyHookOp(hookEvents, { op: 'progress', hookId: 'h_1', chapter: 5 })
hookEvents.push(progressAgain.event)
check('progress can advance an already progressing hook',
  progressAgain.state.hooks[0].lastAdvancedChapter === 5)
const deferred = applyHookOp(hookEvents, { op: 'defer', hookId: 'h_1', chapter: 6 })
hookEvents.push(deferred.event)
check('defer moves to deferred', deferred.state.hooks[0].status === 'deferred')
const resolved = applyHookOp(hookEvents, { op: 'resolve', hookId: 'h_1', chapter: 8 })
hookEvents.push(resolved.event)
check('resolve moves to resolved', resolved.state.hooks[0].status === 'resolved')
rejects('resolved cannot progress', 'hook-transition-invalid',
  () => applyHookOp(hookEvents, { op: 'progress', hookId: 'h_1', chapter: 9 }))
rejects('resolved cannot be resolved again', 'hook-transition-invalid',
  () => applyHookOp(hookEvents, { op: 'resolve', hookId: 'h_1', chapter: 9 }))
const superseded = applyHookOp(hookEvents, { op: 'supersede', hookId: 'h_1', chapter: 10 })
hookEvents.push(superseded.event)
check('supersede is terminal', superseded.state.hooks[0].status === 'superseded')
rejects('superseded cannot defer', 'hook-transition-invalid',
  () => applyHookOp(hookEvents, { op: 'defer', hookId: 'h_1', chapter: 11 }))
rejects('unknown hook is refused', 'hook-not-found',
  () => applyHookOp(hookEvents, { op: 'progress', hookId: 'h_404', chapter: 11 }))

const factEvents = []
factEvents.push(applyFactOp(factEvents, {
  op: 'upsert', fact: { subject: '甲', predicate: '持有', object: '账本' }, chapter: 1, source: '正文 r1',
}).event)
const facts = projectFacts(factEvents)
check('fact upsert projects validity and source',
  facts.length === 1 && facts[0].validFromChapter === 1 && facts[0].validUntilChapter === null
  && facts[0].sourceChapter === 1, JSON.stringify(facts))
factEvents.push(applyFactOp(factEvents, {
  op: 'upsert', fact: { subject: '甲', predicate: '持有', object: '账本' }, chapter: 2, source: '正文 r2',
}).event)
check('re-asserting the same triple keeps one active fact',
  projectFacts(factEvents).length === 1 && projectFacts(factEvents)[0].sourceChapter === 2)
factEvents.push(applyFactOp(factEvents, {
  op: 'expire', selector: { subject: '甲', predicate: '持有' }, chapter: 3,
}).event)
check('expire sets validUntilChapter', projectFacts(factEvents)[0].validUntilChapter === 3)
rejects('expiring a closed fact is refused', 'fact-not-found',
  () => applyFactOp(factEvents, { op: 'expire', selector: { subject: '甲', predicate: '持有' }, chapter: 4 }))
rejects('fact upsert needs a subject', 'state-op-invalid',
  () => applyFactOp([], { op: 'upsert', fact: { predicate: '持有', object: '账本' }, chapter: 1, source: 'x' }))

// Boundary: legacy text-hook/string-fact events are ignored by the v2
// projection, never translated into the new contract.
check('legacy text-hook events do not enter the v2 projection',
  projectHooks([{ kind: 'hook', text: '旧伏笔', state: 'opened' }]).length === 0)

const root = await mkdtemp(join(tmpdir(), 'storycraft-state-projection-'))
try {
  const { workId: work } = initWork(root, { title: '状态事件' })
  writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本',
    obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
  })
  // Settlement is gated on the chapter having a body, a clean review and a
  // current summary, so the fixture walks the same path a session does.
  approveChapterPlan(root, { work, chapter: 1 })
  writeChapter(root, { work, chapter: 1, title: '账本', body: '灰旗在风里翻了一夜。'.repeat(60) })
  writeReview(root, { work, chapter: 1, observations: [] })
  writeSummary(root, { work, chapter: 1, text: '甲拿到了账本，灰旗还挂着。' })

  // The settlement path is the store's one state-event writer: it projects each
  // op, refuses the whole batch when one is invalid, then writes the events.
  const beforeRejected = readEvents(root, work).length
  rejects('a rejected fact op writes no event', 'fact-not-found',
    () => settleState(root, { work, chapter: 1, factOps: { expire: [{ subject: '乙', predicate: '持有' }] } }))
  check('the rejected op left the event log untouched', readEvents(root, work).length === beforeRejected)

  const settled = settleState(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '持有', object: '账本', source: '正文 r1' }] },
    newHooks: [{ text: baseHook.text }],
  })
  check('settlement records one fact and one new hook',
    settled.counts.facts === 1 && settled.counts.newHooks === 1, JSON.stringify(settled.counts))
  const stored = readEvents(root, work)
  check('events persist in sequence order',
    stored.map(event => event.op ?? event.kind).join(',') === 'upsert,upsert,settle', JSON.stringify(stored))
  check('projection rebuilds from stored events',
    projectHooks(stored).length === 1 && projectHooks(stored)[0].status === 'open'
    && projectFacts(stored)[0].validFromChapter === 1, JSON.stringify(projectFacts(stored)))
  check('readFoldedState projects the v2 events', readFoldedState(root, work).hooks.length === 1,
    JSON.stringify(readFoldedState(root, work)))

  // A settled chapter refuses further state events until it is reopened.
  rejects('state ops refuse a settled chapter', 'chapter-settled',
    () => settleState(root, {
      work, chapter: 1,
      factOps: { upsert: [{ subject: '甲', predicate: '持有', object: '账本' }] },
    }))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
