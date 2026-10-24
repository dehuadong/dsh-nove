// S3: v2 hook/fact settlement — host-minted hook ids, projections, consumers,
// reopen reapply and legacy events as history.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { mintHookId } from '../state-projection.js'
import { checkDraft } from '../landing.js'
import { openWork } from '../db.js'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-state-v2-'))
try {
  const { workId: work } = s.initWork(root, { title: '状态迁移', wordRange: { min: 50, max: 5000 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  const writeChapter = (chapter, body = `第${chapter}章正文。`.repeat(30)) => {
    s.writePlan(root, { work, chapter, perspective: '甲', goal: `g${chapter}`, obstacle: 'o', cost: 'c', turn: 't' })
    s.approveChapterPlan(root, { work, chapter })
    s.writeChapter(root, { work, chapter, body })
    reviewFixture(root, { work, chapter, observations: [] })
    s.writeSummary(root, { work, chapter, text: `第${chapter}章摘要。` })
  }
  writeChapter(1)
  writeChapter(2)
  s.writePlan(root, { work, chapter: 3, perspective: '甲', goal: 'g3', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 3 })

  const hookText = '账本里夹着一张旧照片'
  const settled = s.settleState(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '持有', object: '账本' }, { subject: '甲', predicate: '欠', object: '三个月房租' }] },
    newHooks: [{ text: hookText, type: '物件', expectedPayoff: '账本真相' }],
  })
  check('settleState returns counts and projections',
    settled.counts.facts === 2 && settled.counts.newHooks === 1 && settled.counts.hooks === 0
    && settled.hooks.length === 1 && settled.facts.length === 2, JSON.stringify(settled.counts))
  check('the host mints the hook id from its text',
    settled.hooks[0].hookId === mintHookId(hookText) && settled.hooks[0].status === 'open', JSON.stringify(settled.hooks[0]))
  check('settlement flips the chapter and appends the settle marker',
    s.readManifest(root, work).chapters[0].stage === 'settled'
    && s.readEvents(root, work).filter(event => event.kind === 'settle').length === 1)

  const projection = s.readFoldedState(root, work)
  check('facts project with validity',
    projection.facts.length === 2 && projection.facts.every(fact => fact.validUntilChapter === null), JSON.stringify(projection.facts))
  check('hooks project the v2 shape',
    projection.hooks[0].startChapter === 1 && projection.hooks[0].text === hookText, JSON.stringify(projection.hooks))

  const detail = s.readWork(root, work)
  check('readWork exposes facts and hooks instead of entities',
    Array.isArray(detail.state.facts) && detail.state.facts.length === 2
    && detail.state.hooks.length === 1 && detail.state.entities === undefined, JSON.stringify(detail.state))
  const status = s.status(root, work)
  check('status counts v2 hook states',
    status.hooks.open === 1 && status.hooks.unresolved === 1 && status.facts === 2, JSON.stringify(status.hooks))

  const brief = await b.assembleBrief(root, work, 3)
  const hooksSection = brief.sections.find(section => section.name === 'hooks')
  check('brief carries unresolved v2 hooks',
    hooksSection?.content.includes(hookText) === true && hooksSection.content.includes('open'), JSON.stringify(hooksSection))

  const draft = await checkDraft(root, { work, chapter: 2, body: '甲翻开账本。'.repeat(20) })
  check('facts widen the name whitelist', !draft.warnings.some(warning => warning.includes('未登记人名')), JSON.stringify(draft.warnings))

  const hits = s.searchMemory(root, work, '账本')
  const hookHit = hits.find(item => item.kind === 'hook')
  check('retrieval surfaces the projected hook with its status',
    hookHit?.text.includes(hookText) === true && hookHit.text.includes('open'), JSON.stringify(hookHit?.text))

  // Chapter 2 advances and resolves the hook; the projection follows the ops.
  s.settleState(root, {
    work, chapter: 2,
    hookOps: { progress: [mintHookId(hookText)], resolve: [mintHookId(hookText)] },
    factOps: { expire: [{ subject: '甲', predicate: '欠' }] },
  })
  const advanced = s.readFoldedState(root, work)
  check('hook ops move the projection to resolved',
    advanced.hooks.find(hook => hook.hookId === mintHookId(hookText))?.status === 'resolved', JSON.stringify(advanced.hooks))
  check('expire closes the fact validity window',
    advanced.facts.find(fact => fact.predicate === '欠')?.validUntilChapter === 2, JSON.stringify(advanced.facts))
  check('resolved hooks leave the brief',
    (await b.assembleBrief(root, work, 3)).sections.find(section => section.name === 'hooks')?.absent === true)

  // Reopen + re-settle: same-status ops are idempotent under allowReapply.
  s.writeChapter(root, { work, chapter: 2, body: '第二章改版正文。'.repeat(30), rewrite: true, reopen: true })
  reviewFixture(root, { work, chapter: 2, observations: [] })
  s.writeSummary(root, { work, chapter: 2, text: '第二章改版摘要。' })
  const reapplied = s.settleState(root, {
    work, chapter: 2,
    hookOps: { resolve: [mintHookId(hookText)] },
    factOps: { upsert: [{ subject: '甲', predicate: '持有', object: '账本' }], expire: [{ subject: '甲', predicate: '欠' }] },
  })
  check('reopen re-settle tolerates same-status ops',
    reapplied.counts.hooks === 0 && s.readFoldedState(root, work).hooks.find(hook => hook.hookId === mintHookId(hookText))?.status === 'resolved',
    JSON.stringify(reapplied.counts))

  s.writeChapter(root, { work, chapter: 2, body: '错误探测正文。'.repeat(30), rewrite: true, reopen: true })
  reviewFixture(root, { work, chapter: 2, observations: [] })
  s.writeSummary(root, { work, chapter: 2, text: '错误探测摘要。' })
  throwsCode('an unknown hook is refused', 'hook-not-found',
    () => s.settleState(root, { work, chapter: 2, hookOps: { progress: ['h-missing'] } }))
  s.writeChapter(root, { work, chapter: 3, body: '第三章正文。'.repeat(30) })
  reviewFixture(root, { work, chapter: 3, observations: [] })
  s.writeSummary(root, { work, chapter: 3, text: '第三章摘要。' })
  throwsCode('an unknown fact expiration is refused', 'fact-not-found',
    () => s.settleState(root, { work, chapter: 3, factOps: { expire: [{ subject: '甲', predicate: '没有这条' }] } }))
  throwsCode('an empty settlement is refused', 'empty-state',
    () => s.settleState(root, { work, chapter: 2 }))
  throwsCode('an incomplete fact triple is refused', 'state-op-invalid',
    () => s.settleState(root, { work, chapter: 3, factOps: { upsert: [{ subject: '甲' }] } }))

  const duplicated = s.settleState(root, {
    work, chapter: 3,
    newHooks: [{ text: '同一句承诺' }, { text: '同一句承诺' }],
  })
  check('the same hook text in one payload is one hook plus a mention',
    duplicated.counts.newHooks === 1 && duplicated.counts.hooks === 1
    && duplicated.hooks.filter(hook => hook.text === '同一句承诺').length === 1, JSON.stringify(duplicated.counts))

  // Legacy text-hook rows stay in the log but never enter the projection.
  const legacy = openWork(root, work)
  const seq = (legacy.prepare('SELECT max(seq) AS n FROM events').get()?.n ?? 0) + 1
  legacy.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
    .run(seq, new Date().toISOString(), 1, 'hook', JSON.stringify({ kind: 'hook', text: '旧伏笔', state: 'opened' }))
  legacy.close()
  check('legacy text-hook rows are ignored by the projection',
    s.readFoldedState(root, work).hooks.every(hook => hook.text !== '旧伏笔'))

  const exported = await s.exportWork(root, work, join(root, 'out'))
  const eventsFile = await readFile(join(exported.directory, 'state', 'events.jsonl'), 'utf8')
  check('export carries the v2 op events', eventsFile.includes('"op":"upsert"') && eventsFile.includes('"hookId"'), eventsFile.slice(0, 200))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
