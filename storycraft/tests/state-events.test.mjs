/** v2 hook/fact events: source events, projections, and the legacy boundary. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFactOp, appendHookOp, applyFactOp, applyHookOp, projectFacts, projectHooks } from '../state-events.js'
import { initWork, readFoldedState } from '../dist/storage.js'
import { openWork } from '../dist/db.js'
import { readEvents, writePlan } from '../dist/store-db.js'

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

const root = await mkdtemp(join(tmpdir(), 'storycraft-state-events-'))
try {
  const { workId: work } = initWork(root, { title: '状态事件' })
  writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本',
    obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
  })
  const upserted = appendHookOp(root, { work, op: 'upsert', hook: baseHook })
  check('hook upsert appends an event', upserted.seq === 1 && upserted.event.kind === 'hook')
  appendHookOp(root, { work, op: 'progress', hookId: 'h_1', chapter: 1 })
  appendFactOp(root, {
    work, op: 'upsert', fact: { subject: '甲', predicate: '持有', object: '账本' }, chapter: 1, source: '正文 r1',
  })
  const stored = readEvents(root, work)
  check('events persist in sequence order',
    stored.map(event => event.op ?? event.kind).join(',') === 'upsert,progress,upsert', JSON.stringify(stored))
  check('projection rebuilds from stored events',
    projectHooks(stored)[0].status === 'progressing'
    && projectFacts(stored)[0].validFromChapter === 1, JSON.stringify(projectFacts(stored)))
  check('readFoldedState projects the v2 events', readFoldedState(root, work).hooks.length === 1,
    JSON.stringify(readFoldedState(root, work)))

  appendHookOp(root, { work, op: 'resolve', hookId: 'h_1', chapter: 1 })
  const beforeRejected = readEvents(root, work).length
  rejects('a rejected transition writes no event', 'hook-transition-invalid',
    () => appendHookOp(root, { work, op: 'progress', hookId: 'h_1', chapter: 3 }))
  check('the rejected transition left the event log untouched', readEvents(root, work).length === beforeRejected)

  const db = openWork(root, work)
  db.prepare("UPDATE chapters SET stage = 'settled' WHERE number = 1").run()
  db.close()
  rejects('state ops refuse a settled chapter', 'chapter-settled',
    () => appendFactOp(root, {
      work, op: 'upsert', fact: { subject: '甲', predicate: '持有', object: '账本' }, chapter: 1, source: '正文 r1',
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
