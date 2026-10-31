// F8: dispatch telemetry, usage evidence and aggregate summaries.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runChild } from '../src/delegate.ts'
import * as s from '../src/storage.ts'
import { callSummary, finishCall, recordCall } from '../src/telemetry.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-calls-'))
try {
  const { workId: work } = s.initWork(root, { title: '调用观测' })
  const first = recordCall(root, work, {
    chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-10-30T00:00:00.000Z', endedAt: '2026-10-30T00:00:01.000Z', durationMs: 1000,
    outcome: 'completed', promptChars: 10, outputChars: 20, usageSource: 'session',
    inputTokens: 3, outputTokens: 4, totalTokens: 7, model: 'm', provider: 'p',
  })
  finishCall(root, work, first, { outcome: 'accepted', submissionAttempts: 1 })
  const second = recordCall(root, work, {
    chapter: 1, role: 'reviewer', scope: 'review:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-10-30T00:00:00.000Z', endedAt: '2026-10-30T00:00:02.000Z', durationMs: 2000,
    outcome: 'rejected', promptChars: 10, outputChars: 20, usageSource: 'unavailable',
    errorCode: 'observation-source-unverified',
  })
  recordCall(root, work, {
    chapter: 1, role: 'reviser', scope: 'reviser:r1', attempt: 1, trigger: 'first',
    startedAt: '2026-11-01T00:00:00.000Z', endedAt: '2026-11-01T00:00:01.000Z', durationMs: 1000,
    outcome: 'accepted', promptChars: 10, outputChars: 20, usageSource: 'partial',
    inputTokens: 1, outputTokens: 3, totalTokens: 4,
  })
  const summary = callSummary(root, work)
  check('aggregate counts calls', summary.count === 3, JSON.stringify(summary))
  check('aggregate marks partial usage', summary.callsPartial === 1 && summary.usageComplete === false, JSON.stringify(summary))
  check('aggregate sums duration', summary.totalDurationMs === 4000, JSON.stringify(summary))
  check('aggregate keeps partial/unavailable visible', summary.callsWithUsage === 1 && summary.callsPartial === 1 && summary.callsWithoutUsage === 1 && summary.usageComplete === false, JSON.stringify(summary))
  check('aggregate by role', summary.byRole.writer === 1 && summary.byRole.reviewer === 1 && summary.byRole.reviser === 1, JSON.stringify(summary.byRole))

  const rows = []
  const sessions = {
    get(id) {
      if (id !== 'child-1') return undefined
      return {
        ownEvents: () => [
          { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已提交' }] }, usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 } } },
          { type: 'tool/call', data: { arguments: '{"body":"正文"}' } },
        ],
        requestContext: () => ({ provider: 'fixture', model: 'fixture-model' }),
      }
    },
  }
  const result = { stopReason: 'completed', output: [{ type: 'text', text: '已提交' }] }
  const service = {
    async startActivation() {
      return { childId: 'child-1', result: Promise.resolve(result), dispose: async () => {} }
    },
  }
  const child = await runChild({
    service, agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000, sessions,
    telemetry: {
      work, chapter: 1, role: 'writer', scope: 'writer:r1', attempt: 1, trigger: 'first',
      sessions, sink: (call) => recordCall(root, work, call),
    },
  })
  check('runChild returns a call summary', child.call.durationMs >= 0 && child.call.usage.inputTokens === 11, JSON.stringify(child.call))
  check('runChild captured model identity', child.call.usage.model === 'fixture-model' && child.call.usage.provider === 'fixture')
  check('runChild captured output chars without body text', child.call.usage.outputChars > 0)
  await child.dispose()

  const noSessions = await runChild({
    service, agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
    telemetry: {
      work, chapter: 1, role: 'writer', scope: 'writer:r2', attempt: 1, trigger: 'first',
      sink: (call) => recordCall(root, work, call),
    },
  })
  check('missing sessions yields unavailable usage', noSessions.call.usage.usageSource === 'unavailable' && noSessions.call.usage.totalTokens === null)
  await noSessions.dispose()

  const beforeFailure = callSummary(root, work).count
  const failing = { async startActivation() { throw new Error('provider unavailable') } }
  let failedStart = ''
  try {
    await runChild({
      service: failing, agent: { id: 'parent' }, cwd: root, prompt: '写正文', label: 'fixture', timeoutMs: 5000,
      telemetry: {
        work, chapter: 1, role: 'writer', scope: 'writer:r3', attempt: 1, trigger: 'first',
        sink: (call) => recordCall(root, work, call),
      },
    })
  } catch (error) { failedStart = error?.code ?? String(error) }
  check('a start failure records exactly one row', failedStart !== '' && callSummary(root, work).count === beforeFailure + 1, failedStart)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
