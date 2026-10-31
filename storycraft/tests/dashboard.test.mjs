// E4 dashboard data and author hook transitions.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { readDashboard, transitionHook } from '../src/dashboard.ts'
import { readEvents, readFoldedState } from '../src/store-db.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
function rejects(name, code, fn) {
  try { fn(); check(name, false, '没有抛错') }
  catch (error) { check(name, error?.code === code, `${error?.code}: ${error?.message}`) }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-dashboard-'))
try {
  const { workId: work } = s.initWork(root, { title: '看板' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '一', body: '甲推开门。' })
  s.appendStateEvent(root, {
    work, chapter: 1, kind: 'hook',
    payload: { op: 'upsert', hook: { hookId: 'h_1', startChapter: 1, type: '物件', status: 'open', lastAdvancedChapter: 1, expectedPayoff: '真相', notes: '', dependsOn: [], paysOffInArc: '第一卷', text: '旧钥匙' } },
  })

  const before = readDashboard(root, work)
  check('dashboard returns unresolved hooks', before.hooks.length === 1 && before.hooks[0].text === '旧钥匙', JSON.stringify(before.hooks))
  check('dashboard uses the latest written unsettled chapter', before.transitionChapter === 1, String(before.transitionChapter))
  check('dashboard status is the status projection', before.status.writtenChapters === 1 && before.status.hooks.unresolved === 1, JSON.stringify(before.status))

  const progressed = transitionHook(root, { work, hookId: 'h_1', op: 'progress' })
  check('progress marks the hook progressing', progressed.hooks[0]?.status === 'progressing', JSON.stringify(progressed.hooks))
  const eventCount = readEvents(root, work).length
  const noop = transitionHook(root, { work, hookId: 'h_1', op: 'progress' })
  check('same-chapter progress is a no-op', noop.hooks[0]?.status === 'progressing' && readEvents(root, work).length === eventCount, String(readEvents(root, work).length))

  const resolved = transitionHook(root, { work, hookId: 'h_1', op: 'resolve' })
  check('resolve removes the hook from the dashboard', resolved.hooks.length === 0 && readFoldedState(root, work).hooks[0]?.status === 'resolved')

  rejects('unknown hook is refused', 'hook-not-found', () => transitionHook(root, { work, hookId: 'h_missing', op: 'resolve' }))
  rejects('invalid op is refused', 'hook-transition-invalid', () => transitionHook(root, { work, hookId: 'h_1', op: 'mention' }))

  const empty = s.initWork(root, { title: '没有正文' }).workId
  rejects('no written unsettled chapter is refused', 'chapter-settled', () => transitionHook(root, { work: empty, hookId: 'h_1', op: 'resolve' }))

  const draftWork = s.initWork(root, { title: '草案未处理' }).workId
  s.writeOutline(root, { work: draftWork, mainline: '一条主线' })
  s.approveOutline(root, { work: draftWork })
  s.writePlan(root, { work: draftWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: draftWork, chapter: 1 })
  s.writeChapter(root, { work: draftWork, chapter: 1, title: '一', body: '甲推开门。' })
  s.appendStateEvent(root, {
    work: draftWork, chapter: 1, kind: 'hook',
    payload: { op: 'upsert', hook: { hookId: 'h_1', startChapter: 1, type: '物件', status: 'open', lastAdvancedChapter: 1, expectedPayoff: '真相', notes: '', dependsOn: [], paysOffInArc: '第一卷', text: '旧钥匙' } },
  })
  s.writeStateDraft(root, { work: draftWork, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好钥匙' }] }, ready: false })
  rejects('pending state draft blocks author hook transition', 'state-draft-pending', () => transitionHook(root, { work: draftWork, hookId: 'h_1', op: 'progress' }))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')

