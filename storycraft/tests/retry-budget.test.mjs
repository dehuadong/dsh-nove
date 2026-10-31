// F14: startup retries and the optional per-chapter token cap.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runChild } from '../src/delegate.ts'
import { openWork } from '../src/db.ts'
import { initWork, updateSettings } from '../src/storage.ts'
import { callSummary, recordCall } from '../src/telemetry.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

function child(result = { stopReason: 'completed' }) {
  return { childId: 'child', result: Promise.resolve(result), dispose: async () => {} }
}

function rowsOf(root, work) {
  const db = openWork(root, work)
  try { return db.prepare('SELECT attempt, trigger, outcome, error_code FROM model_calls ORDER BY id').all() } finally { db.close() }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-f14-'))
try {
  const { workId: work } = initWork(root, { title: '重试预算' })
  let starts = 0
  const transient = {
    async startActivation() {
      starts += 1
      if (starts <= 2) throw new Error('503 service unavailable')
      return child()
    },
  }
  const retry = await runChild({
    service: transient, agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
    telemetry: {
      work, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
      sink: (call) => recordCall(root, work, call),
    },
  })
  check('startup transient retries succeed on the third attempt', starts === 3 && retry.call.retries === 2, `starts=${starts}`)
  const retryRows = rowsOf(root, work)
  check('each startup attempt writes one row', retryRows.length === 3, JSON.stringify(retryRows))
  check('attempts increase within the scope', retryRows.map(row => row.attempt).join(',') === '1,2,3', JSON.stringify(retryRows))
  check('retry rows carry transient-retry', retryRows[1]?.trigger === 'transient-retry' && retryRows[2]?.trigger === 'transient-retry', JSON.stringify(retryRows))
  await retry.dispose()

  for (const row of retryRows) { /* rows already asserted */ }
  const beforeUnavailable = rowsOf(root, work).length
  let unavailableCode = ''
  try {
    await runChild({
      service: { async startActivation() { throw new Error('provider unavailable') } },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
      telemetry: { work, chapter: 1, role: 'writer', scope: 'writer:r2', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, work, call) },
    })
  } catch (error) { unavailableCode = error?.code }
  check('provider unavailable is not retried', unavailableCode === 'delegation-unavailable' && rowsOf(root, work).length === beforeUnavailable + 1, unavailableCode)

  const activatedWork = initWork(root, { title: '激活后失败' }).workId
  let activatedStarts = 0
  let activatedCode = ''
  try {
    await runChild({
      service: {
        async startActivation() {
          activatedStarts += 1
          return { childId: 'child', result: Promise.reject(new Error('stream failed')), dispose: async () => {} }
        },
      },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
      telemetry: { work: activatedWork, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, activatedWork, call) },
    })
  } catch (error) { activatedCode = error?.code }
  check('activation-started failures are not retried', activatedCode === 'delegation-failed' && activatedStarts === 1 && rowsOf(root, activatedWork).length === 1, `${activatedCode}/${activatedStarts}`)

  const timeoutWork = initWork(root, { title: '激活后超时' }).workId
  let timeoutStarts = 0
  let timeoutCode = ''
  try {
    await runChild({
      service: {
        async startActivation() {
          timeoutStarts += 1
          return { childId: 'child', result: new Promise(() => {}), dispose: async () => {} }
        },
      },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 20,
      telemetry: { work: timeoutWork, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, timeoutWork, call) },
    })
  } catch (error) { timeoutCode = error?.code }
  const timeoutRows = rowsOf(root, timeoutWork)
  check('activation timeouts are not retried', timeoutCode === 'delegation-failed' && timeoutStarts === 1 && timeoutRows.length === 1, `${timeoutCode}/${timeoutStarts}`)
  check('timeout rows keep the timeout outcome', timeoutRows[0]?.outcome === 'timeout', JSON.stringify(timeoutRows))

  const startTimeoutWork = initWork(root, { title: '启动超时' }).workId
  let startTimeoutStarts = 0
  let startTimeoutCode = ''
  try {
    await runChild({
      service: {
        async startActivation({ signal }) {
          startTimeoutStarts += 1
          return await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('503 startup timeout')), { once: true }))
        },
      },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 20,
      telemetry: { work: startTimeoutWork, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, startTimeoutWork, call) },
    })
  } catch (error) { startTimeoutCode = error?.code }
  check('startup timeout is not retried despite transient text', startTimeoutCode === 'delegation-failed' && startTimeoutStarts === 1 && rowsOf(root, startTimeoutWork).length === 1, `${startTimeoutCode}/${startTimeoutStarts}`)
  check('startup timeout writes outcome timeout', rowsOf(root, startTimeoutWork)[0]?.outcome === 'timeout', JSON.stringify(rowsOf(root, startTimeoutWork)))

  const abortWork = initWork(root, { title: '退避中断' }).workId
  const abort = new AbortController()
  setTimeout(() => abort.abort(), 20)
  let abortCode = ''
  try {
    await runChild({
      service: { async startActivation() { throw new Error('503 service unavailable') } },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000, signal: abort.signal,
      telemetry: { work: abortWork, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, abortWork, call) },
    })
  } catch (error) { abortCode = error?.code }
  check('aborting during backoff stops without a new row', abortCode === 'delegation-failed' && rowsOf(root, abortWork).length === 1, `${abortCode}/${rowsOf(root, abortWork).length}`)

  const exhaustedWork = initWork(root, { title: '重试耗尽' }).workId
  let exhaustedCode = ''
  try {
    await runChild({
      service: { async startActivation() { throw new Error('429 rate limit exceeded') } },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
      telemetry: { work: exhaustedWork, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, exhaustedWork, call) },
    })
  } catch (error) { exhaustedCode = error?.code }
  check('transient exhaustion reports a retry error', exhaustedCode === 'delegation-transient-exhausted' && rowsOf(root, exhaustedWork).length === 3, exhaustedCode)

  const capWork = initWork(root, { title: '成本上限' }).workId
  updateSettings(root, { work: capWork, maxChapterTokens: 5 })
  recordCall(root, capWork, {
    chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:01.000Z', durationMs: 1,
    outcome: 'accepted', promptChars: 1, outputChars: 1, usageSource: 'session', totalTokens: 10,
  })
  const beforeCap = rowsOf(root, capWork).length
  let capCode = ''
  let capStarts = 0
  try {
    await runChild({
      service: { async startActivation() { capStarts += 1; return child() } },
      agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
      telemetry: { work: capWork, chapter: 1, role: 'writer', scope: 'writer:r2', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, capWork, call) },
    })
  } catch (error) { capCode = error?.code }
  check('token cap blocks before starting a child', capCode === 'chapter-budget-exceeded' && capStarts === 0, `${capCode}/${capStarts}`)
  check('blocked dispatch writes no call row', rowsOf(root, capWork).length === beforeCap, String(rowsOf(root, capWork).length))

  const freeWork = initWork(root, { title: '不设限' }).workId
  recordCall(root, freeWork, {
    chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:01.000Z', durationMs: 1,
    outcome: 'accepted', promptChars: 1, outputChars: 1, usageSource: 'session', totalTokens: 10,
  })
  const free = await runChild({
    service: { async startActivation() { return child() } },
    agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
    telemetry: { work: freeWork, chapter: 1, role: 'writer', scope: 'writer:r2', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, freeWork, call) },
  })
  check('unset cap does not block', free.call.retries === 0)
  await free.dispose()

  const cleared = updateSettings(root, { work: capWork, maxChapterTokens: null })
  check('cap can be cleared', cleared.maxChapterTokens === null)
  check('cap aggregate still exposes observed tokens', callSummary(root, capWork).count === 1)

  updateSettings(root, { work: capWork, maxChapterTokens: 5 })
  const architect = await runChild({
    service: { async startActivation() { return child() } },
    agent: { id: 'parent' }, cwd: root, prompt: '写设定', label: 'fixture', timeoutMs: 5000,
    telemetry: { work: capWork, chapter: null, role: 'architect', scope: 'architect:frame', attempt: 1, trigger: 'first', sink: (call) => recordCall(root, capWork, call) },
  })
  check('architect is exempt from the chapter cap', architect.call.usage.usageSource === 'unavailable')
  await architect.dispose()

  let invalidCap = ''
  try { updateSettings(root, { work: capWork, maxChapterTokens: 0 }) } catch (error) { invalidCap = error?.code }
  check('non-positive cap is refused', invalidCap === 'chapter-token-limit-invalid', invalidCap)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
