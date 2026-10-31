// E7: call-log cursor paging, failure filter, and field boundary.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { readCallLogs, recordCall } from '../src/telemetry.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
function rejects(name, code, fn) {
  try { fn(); check(name, false, '没有抛错') }
  catch (error) { check(name, error?.code === code, `${error?.code}: ${error?.message}`) }
}

function addCall(root, work, index, outcome) {
  return recordCall(root, work, {
    chapter: 1, role: index % 2 === 0 ? 'reviewer' : 'writer', scope: 'log:' + index, attempt: 1,
    trigger: 'first', startedAt: '2026-10-31T00:00:00.000Z', endedAt: '2026-10-31T00:00:01.000Z',
    durationMs: 100, outcome, promptChars: 10, outputChars: 20,
    usageSource: index % 5 === 0 ? 'unavailable' : 'session',
    ...(index % 5 === 0 ? {} : { totalTokens: index }),
    model: 'model-a', provider: 'p', errorCode: outcome === 'accepted' ? null : 'fixture-' + outcome,
  })
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-logs-'))
try {
  const { workId: work } = s.initWork(root, { title: '日志' })
  for (let index = 1; index <= 25; index += 1) {
    addCall(root, work, index, index % 3 === 0 ? (index % 6 === 0 ? 'rejected' : 'error') : 'accepted')
  }
  addCall(root, work, 26, 'completed')
  const first = readCallLogs(root, work)
  check('default page is 20 newest first', first.rows.length === 20 && first.rows[0]?.id > first.rows.at(-1)?.id, String(first.rows.length))
  check('cursor points at the last row', first.nextBefore === first.rows.at(-1)?.id, String(first.nextBefore))
  const second = readCallLogs(root, work, { before: first.nextBefore ?? undefined })
  check('cursor returns the older page', second.rows.length === 6 && second.nextBefore === null, JSON.stringify(second.rows.map(row => row.id)))
  const failed = readCallLogs(root, work, { failed: true })
  check('failure filter excludes accepted and includes completed', failed.rows.length === 9 && failed.rows.every(row => row.outcome !== 'accepted') && failed.rows.some(row => row.outcome === 'completed'), JSON.stringify(failed.rows.map(row => row.outcome)))
  check('error code and submission fields are present', failed.rows.every(row => row.errorCode?.startsWith('fixture-')) && failed.rows.every(row => row.submissionAttempts === null && row.stopReason === null))
  const json = JSON.stringify(failed)
  check('logs carry no prompt/output or session text', !json.includes('"prompt"') && !json.includes('"body"') && !json.includes('"content"')
    && !json.includes('childSession') && !json.includes('delegationId')
    && !json.includes('child_session') && !json.includes('delegation_id'), json.slice(0, 200))
  rejects('invalid limit is refused', 'invalid-query', () => readCallLogs(root, work, { limit: 0 }))
  rejects('non-integer limit is refused', 'invalid-query', () => readCallLogs(root, work, { limit: 1.5 }))
  rejects('invalid before is refused', 'invalid-query', () => readCallLogs(root, work, { before: 0 }))

  const empty = s.initWork(root, { title: '空日志' }).workId
  const emptyPage = readCallLogs(root, empty)
  check('empty work has no logs', emptyPage.rows.length === 0 && emptyPage.nextBefore === null)

  const perfWork = s.initWork(root, { title: '日志性能' }).workId
  for (let index = 1; index <= 250; index += 1) addCall(root, perfWork, index, index % 2 === 0 ? 'error' : 'accepted')
  const firstFailed = readCallLogs(root, perfWork, { failed: true, limit: 100 })
  const times = []
  let deep
  for (let sample = 0; sample < 3; sample += 1) {
    const started = performance.now()
    deep = readCallLogs(root, perfWork, { failed: true, limit: 100, before: firstFailed.nextBefore ?? undefined })
    times.push(performance.now() - started)
  }
  const median = times.sort((left, right) => left - right)[1]
  check('250-call deep failure cursor under 300ms', median < 300 && firstFailed.nextBefore !== null, median.toFixed(1) + 'ms')
  check('deep failure page is bounded', deep.rows.length === 25 && deep.rows.every(row => row.outcome !== 'accepted'), String(deep.rows.length))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
