// Core checks for the replacement gate: marker, state, docs phase, commands.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'
import { loadState } from './src/state.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

function fakeHost(workspace, subagents) {
  const commands = {}
  const handlers = {}
  const ctx = {
    on: (name, handler) => { handlers[name] = handler },
    inject: (_deps, callback) => callback(ctx),
    get: name => name === 'sandboxPolicy' ? { workspaceRoot: workspace, resolve: () => ({ workspaceRoot: workspace }) }
      : name === 'subagents' ? subagents : undefined,
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    skills: { register: () => {} },
    commands: { register: definition => { commands[definition.name] = definition; return () => {} } },
    tools: { register: () => {} },
  }
  apply(ctx)
  return { ctx, commands, handlers }
}

const workspace = mkdtempSync(path.join(os.tmpdir(), 'gate-core-'))
mkdirSync(path.join(workspace, '.agents', 'notes', 'proposed', 'feature'), { recursive: true })
writeFileSync(path.join(workspace, '.agents', 'notes', 'proposed', 'feature', '2026-11-07-orchestrate-check.md'), '---\nStatus: proposed\n---\n')
mkdirSync(path.join(workspace, '.agents'), { recursive: true })
writeFileSync(path.join(workspace, '.agents', 'gate.json'), JSON.stringify({
  enabled: true, version: 2, codeExtensions: ['.ts'], codePaths: [],
}))
const { commands, handlers } = fakeHost(workspace)
const agent = { id: 'session-test', session: { header: {} } }
const exec = (name, args) => handlers['tools/pre-execute']({ name, arguments: args, agent, signal: new AbortController().signal }, async () => ({ kind: 'allow' }))
const run = (name, input) => commands[name].handler({ agent, rawInput: input, attachments: [] })

check('docs command registered', typeof commands['gate-docs']?.handler === 'function')
check('status command registered', typeof commands['gate-status']?.handler === 'function')
check('discuss denies code', (await exec('write', { file_path: 'src/x.ts' })).kind === 'deny')
check('discuss denies docs', (await exec('write', { file_path: 'docs/x.md' })).kind === 'deny')
await run('gate-docs', 'docs/')
check('docs command enters docs', loadState(workspace, agent).phase === 'docs')
check('docs phase allows docs', (await exec('write', { file_path: 'docs/x.md' })).kind === 'allow')
check('docs phase denies code', (await exec('write', { file_path: 'src/x.ts' })).kind === 'deny')
await run('gate-return', '')
check('return enters discuss', loadState(workspace, agent).phase === 'discuss')
const status = await run('gate-status', '')
check('status is factual', status.text.includes('状态：discuss') && status.text.includes('blockReason：无') && !status.text.includes('下一步'))

const calls = []
const subagents = {
  startActivation: async spec => {
    calls.push(/Gate phase worker: (\S+)/u.exec(spec.prompt[0].text)?.[1])
    return {
      childId: spec.childId,
      name: 'gate-worker',
      result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, findings: [] } }),
      dispose: async () => {},
    }
  },
}
const second = fakeHost(workspace, subagents)
const secondAgent = { id: 'session-orchestrate', session: { header: {} } }
const runSecond = (name, input) => second.commands[name].handler({ agent: secondAgent, rawInput: input, attachments: [] })
const planned = await runSecond('gate-plan', 'orchestrate-check')
check('plan command starts', planned.kind === 'success')
await new Promise(resolve => setTimeout(resolve, 50))
check('plan workers dispatched', calls.includes('plan') && calls.includes('plan-review'), calls.join(','))
check('plan returns to discuss', loadState(workspace, secondAgent).phase === 'discuss', JSON.stringify(loadState(workspace, secondAgent)))
calls.length = 0
const implemented = await runSecond('gate-implement', 'orchestrate-check')
check('implement command starts', implemented.kind === 'success')
await new Promise(resolve => setTimeout(resolve, 50))
check('implement workers dispatched', calls.includes('implement') && calls.includes('code-review') && calls.includes('verify'), calls.join(','))
check('implement completes after verify', loadState(workspace, secondAgent).phase === 'complete', JSON.stringify(loadState(workspace, secondAgent)))

const blockedCalls = []
const findingHost = fakeHost(workspace, {
  startActivation: async spec => {
    const node = /Gate phase worker: (\S+)/u.exec(spec.prompt[0].text)?.[1]
    blockedCalls.push(node)
    return {
      childId: spec.childId,
      name: 'gate-worker',
      result: Promise.resolve({ stopReason: 'completed', structured: node === 'plan-review' ? { ok: true, findings: [{ id: 'F1' }] } : { ok: true, findings: [] } }),
      dispose: async () => {},
    }
  },
})
const blockedAgent = { id: 'session-blocked', session: { header: {} } }
const blockedStart = await findingHost.commands['gate-plan'].handler({ agent: blockedAgent, rawInput: 'orchestrate-check', attachments: [] })
await new Promise(resolve => setTimeout(resolve, 50))
check('plan review cap blocks instead of passing',
  blockedStart.kind === 'success'
  && blockedCalls.filter(node => node === 'plan-review').length === 5
  && loadState(workspace, blockedAgent).work === 'blocked'
  && loadState(workspace, blockedAgent).blockReason === 'plan-review-rounds-exhausted',
  JSON.stringify({ calls: blockedCalls, state: loadState(workspace, blockedAgent) }))

const codeReviewCalls = []
const codeFindingHost = fakeHost(workspace, {
  startActivation: async spec => {
    const node = /Gate phase worker: (\S+)/u.exec(spec.prompt[0].text)?.[1]
    codeReviewCalls.push(node)
    return {
      childId: spec.childId,
      name: 'gate-worker',
      result: Promise.resolve({ stopReason: 'completed', structured: node === 'code-review' ? { ok: true, findings: [{ id: 'C1' }] } : { ok: true, findings: [] } }),
      dispose: async () => {},
    }
  },
})
const codeBlockedAgent = { id: 'session-code-blocked', session: { header: {} } }
const codeStart = await codeFindingHost.commands['gate-implement'].handler({ agent: codeBlockedAgent, rawInput: 'orchestrate-check', attachments: [] })
await new Promise(resolve => setTimeout(resolve, 50))
check('code review cap blocks instead of passing',
  codeStart.kind === 'success'
  && codeReviewCalls.filter(node => node === 'code-review').length === 10
  && loadState(workspace, codeBlockedAgent).work === 'blocked'
  && loadState(workspace, codeBlockedAgent).blockReason === 'code-review-rounds-exhausted',
  JSON.stringify({ calls: codeReviewCalls, state: loadState(workspace, codeBlockedAgent) }))

const missingWorkspace = mkdtempSync(path.join(os.tmpdir(), 'gate-missing-'))
mkdirSync(path.join(missingWorkspace, '.agents'), { recursive: true })
writeFileSync(path.join(missingWorkspace, '.agents', 'gate.json'), JSON.stringify({ enabled: true, version: 2 }))
const missingHost = fakeHost(missingWorkspace)
const missingAgent = { id: 'session-missing', session: { header: {} } }
const rejected = await missingHost.commands['gate-plan'].handler({ agent: missingAgent, rawInput: 'no-such-note', attachments: [] })
check('plan without a work item is rejected', rejected.kind === 'error' && loadState(missingWorkspace, missingAgent).phase === 'discuss', JSON.stringify(rejected))

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
