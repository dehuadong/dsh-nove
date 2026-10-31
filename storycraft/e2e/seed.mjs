/**
 * Fixture seeding shared by the two ways this package gets exercised: the copy
 * install used by the Playwright specs (`e2e/host.mjs`) and the tarball install
 * used by `scripts/install-smoke.mjs`.
 *
 * The fixture is built through the same storage actions a session uses, so every
 * number the page shows comes from real writes rather than hand-made files.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { reviewFixture } from '../tests/review-fixture.mjs'
import { recordCall } from '../src/telemetry.ts'
import { openWork } from '../src/db.ts'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Load the storage module straight from source (type stripping handles it). */
async function loadStore() {
  return import(pathToFileURL(path.join(projectRoot, 'src', 'storage.ts')).href)
}

/**
 * Build the sample workspace and return the facts the specs assert against.
 * @param {string} workspaceDir - directory the fixture work lives in.
 * @returns {Promise<object>} facts: workId, title, words, events, hooksOpen, revision, reviewRound.
 */
export async function buildFixture(workspaceDir) {
  const store = await loadStore()
  const created = await store.initWork(workspaceDir, { title: '示例短篇' })
  const work = created.workId
  // The outline gate applies to every chapter plan now, so the fixture approves
  // the book plan first and rewrites it unapproved at the end for the panel spec.
  await store.writeOutline(workspaceDir, { work, mainline: '一条主线' })
  await store.approveOutline(workspaceDir, { work })
  await store.writePlan(workspaceDir, {
    work, chapter: 1, perspective: '甲', goal: '救火', obstacle: '断电', cost: '时间', turn: '找到出口',
  })
  // A body needs its chapter plan confirmed; chapter 2 keeps an unconfirmed plan
  // so the panel has something to offer a confirmation button for.
  await store.approveChapterPlan(workspaceDir, { work, chapter: 1 })
  await store.writePlan(workspaceDir, {
    work, chapter: 2, perspective: '甲', goal: '找回灰旗', obstacle: '渠水', cost: '脚伤', turn: '旗是空的',
  })
  const first = '灰旗在风里翻了一夜。'.repeat(60)
  await store.writeChapter(workspaceDir, { work, chapter: 1, title: '灰旗', body: first })
  await store.writeReview(workspaceDir, {
    work, chapter: 1,
    observations: [
      { id: 'O1', summary: '光线写得太满', evidence: [], category: 'quality', assessment: 'issue', fix: '收一收', sourceRefs: [{ sourceId: 'chapter:1:r1', quote: first.slice(0, 20) }] },
      { id: 'O2', summary: '收束太快', evidence: [], category: 'quality', assessment: 'issue', fix: '补一拍', sourceRefs: [{ sourceId: 'chapter:1:r1', quote: first.slice(0, 20) }] },
    ],
  })
  const second = '灰旗在风里翻了一夜。火在渠里烧着。'.repeat(45)
  await store.reviseChapter(workspaceDir, { work, chapter: 1, body: second, problemIds: ['O1', 'O2'], mode: 'rewrite' })
  await store.writeReview(workspaceDir, { work, chapter: 1, observations: [] })
  await store.writeSummary(workspaceDir, { work, chapter: 1, text: '甲在渠边丢了半袋粮，灰旗还挂着。' })
  await store.settleState(workspaceDir, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '丢了半袋粮' }] },
    newHooks: [{ text: '灰旗是谁挂的' }],
  })
  // Read-only works, one per workbench state the panel spec walks through.
  const plan = (w, chapter) => store.writePlan(workspaceDir, {
    work: w, chapter, perspective: '甲', goal: '目标' + chapter, obstacle: '断电', cost: '时间', turn: '找到出口',
  })
  const stateWork = async (title, form, build) => {
    const createdWork = await store.initWork(workspaceDir, { title, form })
    if (build !== undefined) await build(createdWork.workId)
  }
  await stateWork('状态-基础设定', 'longform')
  await stateWork('状态-无计划', 'short')
  await stateWork('状态-计划待确认', 'short', async (w) => {
    await store.writeOutline(workspaceDir, { work: w, mainline: '一条主线' })
  })
  await stateWork('状态-章纲待确认', 'short', async (w) => {
    await store.writeOutline(workspaceDir, { work: w, mainline: '一条主线' })
    await store.approveOutline(workspaceDir, { work: w })
    await plan(w, 1)
  })
  await stateWork('状态-写作中', 'short', async (w) => {
    await store.writeOutline(workspaceDir, { work: w, mainline: '一条主线' })
    await store.approveOutline(workspaceDir, { work: w })
    await plan(w, 1)
    await store.approveChapterPlan(workspaceDir, { work: w, chapter: 1 })
  })
  await stateWork('状态-审稿中', 'short', async (w) => {
    await store.writeOutline(workspaceDir, { work: w, mainline: '一条主线' })
    await store.approveOutline(workspaceDir, { work: w })
    await plan(w, 1)
    await store.approveChapterPlan(workspaceDir, { work: w, chapter: 1 })
    await store.writeChapter(workspaceDir, { work: w, chapter: 1, title: '一', body: '灰旗在风里翻了一夜。'.repeat(20) })
  })
  const boardSetup = async (w) => {
    await store.writeOutline(workspaceDir, { work: w, mainline: '一条主线' })
    await store.approveOutline(workspaceDir, { work: w })
    await plan(w, 1)
    await store.approveChapterPlan(workspaceDir, { work: w, chapter: 1 })
    await store.writeChapter(workspaceDir, { work: w, chapter: 1, title: '一', body: '灰旗在风里翻了一夜。'.repeat(20) })
  }
  await stateWork('状态-看板', 'short', async (w) => {
    await boardSetup(w)
    await store.appendStateEvent(workspaceDir, {
      work: w, chapter: 1, kind: 'hook',
      payload: { op: 'upsert', hook: { hookId: 'h-1', startChapter: 1, type: '物件', status: 'open', lastAdvancedChapter: 1, expectedPayoff: '真相', notes: '', dependsOn: [], paysOffInArc: '', text: '旧钥匙' } },
    })
    await store.appendStateEvent(workspaceDir, {
      work: w, chapter: 1, kind: 'hook',
      payload: { op: 'upsert', hook: { hookId: 'h-2', startChapter: 2, type: '悬念', status: 'open', lastAdvancedChapter: 1, expectedPayoff: '第二真相', notes: '', dependsOn: [], paysOffInArc: '', text: '第二把钥匙' } },
    })
  })
  await stateWork('状态-日志', 'short', async (w) => {
    await boardSetup(w)
    for (let index = 1; index <= 25; index += 1) {
      const failed = index % 3 === 0
      const outcome = failed ? (index % 6 === 0 ? 'rejected' : 'error') : 'accepted'
      recordCall(workspaceDir, w, {
        chapter: 1, role: index % 2 === 0 ? 'reviewer' : 'writer', scope: 'log:' + index, attempt: 1,
        trigger: index % 4 === 0 ? 'transient-retry' : 'first',
        startedAt: '2026-10-31T00:00:' + String(index).padStart(2, '0') + '.000Z',
        endedAt: '2026-10-31T00:00:' + String(index).padStart(2, '0') + '.500Z',
        durationMs: 500, outcome, promptChars: 10, outputChars: 20,
        usageSource: index % 5 === 0 ? 'unavailable' : 'session',
        ...(index % 5 === 0 ? {} : { totalTokens: index * 10 }),
        model: 'model-a', provider: 'p', errorCode: failed ? 'fixture-failure' : null,
      })
    }
  })
  await stateWork('状态-日志完成', 'short', async (w) => {
    await boardSetup(w)
    recordCall(workspaceDir, w, {
      chapter: 1, role: 'architect', scope: 'log:completed', attempt: 1, trigger: 'first',
      startedAt: '2026-10-31T00:01:00.000Z', endedAt: '2026-10-31T00:01:01.000Z',
      durationMs: 1000, outcome: 'completed', promptChars: 10, outputChars: 20,
      usageSource: 'session', totalTokens: 50, model: 'model-a', provider: 'p',
    })
  })
  await stateWork('状态-自检坏库', 'short', async (w) => {
    await boardSetup(w)
    const db = openWork(workspaceDir, w)
    db.exec('PRAGMA user_version = 999')
    db.close()
  })
  await stateWork('状态-分析', 'short', async (w) => {
    await boardSetup(w)
    reviewFixture(workspaceDir, {
      work: w, chapter: 1,
      observations: [
        { id: 'O1', category: 'quality', assessment: 'issue', summary: '重复句', evidence: [], sourceRefs: [{ sourceId: 'chapter:1', quote: '灰旗在风里翻了一夜。' }] },
        { id: 'O2', category: 'execution', assessment: 'issue', severity: 'major', summary: '节奏慢', evidence: [], sourceRefs: [{ sourceId: 'chapter:1', quote: '灰旗在风里翻了一夜。' }] },
      ],
    })
    recordCall(workspaceDir, w, {
      chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
      startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:01.000Z', durationMs: 1000,
      outcome: 'accepted', promptChars: 10, outputChars: 20, usageSource: 'session', totalTokens: 100,
      inputTokens: 40, outputTokens: 60, model: 'model-a', provider: 'p',
    })
    recordCall(workspaceDir, w, {
      chapter: 1, role: 'reviewer', scope: 'review:r1', attempt: 1, trigger: 'first',
      startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:02.000Z', durationMs: 2000,
      outcome: 'accepted', promptChars: 10, outputChars: 20, usageSource: 'unavailable',
      model: 'model-a', provider: 'p',
    })
  })
  await stateWork('状态-看板草案', 'short', async (w) => {
    await boardSetup(w)
    await store.appendStateEvent(workspaceDir, {
      work: w, chapter: 1, kind: 'hook',
      payload: { op: 'upsert', hook: { hookId: 'h-1', startChapter: 1, type: '物件', status: 'open', lastAdvancedChapter: 1, expectedPayoff: '真相', notes: '', dependsOn: [], paysOffInArc: '', text: '旧钥匙' } },
    })
    await store.writeStateDraft(workspaceDir, { work: w, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好钥匙' }] }, ready: false })
  })
  // An unapproved book plan: the page must offer its confirmation button.
  await store.writeOutline(workspaceDir, { work, mainline: '一条主线', volumes: '第一卷', ending: '开放' })
  const status = await store.status(workspaceDir, work)
  const detail = store.readWork(workspaceDir, work)
  const events = store.readEvents(workspaceDir, work).length
  return {
    workId: status.workId,
    title: status.title,
    words: status.chapters[0].words,
    events,
    hooksOpen: status.hooks.open,
    revision: status.chapters[0].revision,
    reviewRound: detail.chapters[0].reviewRound,
  }
}

/**
 * Register the fixture workspace in a DSH home so the page has something to read.
 * @param {object} input - home directory, workspace directory, facts, log label.
 */
export function seedWorkspace({ home, workspaceDir, facts, label }) {
  const storageDir = path.join(home, 'storages')
  mkdirSync(storageDir, { recursive: true })
  const workspaceId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  const now = new Date().toISOString()
  const storage = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        [workspaceId]: { path: workspaceDir, title: 'fixture', sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }
  writeFileSync(path.join(storageDir, 'workspace.json'), `${JSON.stringify(storage, null, 2)}\n`)
  console.log(`[${label}] 已注册 fixture 工作区：${workspaceDir}（${facts.words} 字、${facts.events} 条事件）`)
}
