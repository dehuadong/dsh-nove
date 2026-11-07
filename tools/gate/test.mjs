// Core checks for the replacement gate: state, docs, commands, gate_record.
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

function fakeHost(workspace) {
  const commands = {}
  const tools = {}
  const handlers = {}
  const ctx = {
    on: (name, handler) => { handlers[name] = handler },
    inject: (_deps, callback) => callback(ctx),
    get: name => name === 'sandboxPolicy' ? { workspaceRoot: workspace, resolve: () => ({ workspaceRoot: workspace }) } : undefined,
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    skills: { register: () => {} },
    commands: { register: definition => { commands[definition.name] = definition } },
    tools: { register: definition => { tools[definition.name] = definition } },
  }
  apply(ctx)
  return { commands, tools, handlers }
}

function makeWorkspace() {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'gate-core-'))
  mkdirSync(path.join(workspace, '.agents', 'notes', 'proposed', 'feature'), { recursive: true })
  writeFileSync(path.join(workspace, '.agents', 'gate.json'), JSON.stringify({
    enabled: true, version: 2, codeExtensions: ['.ts'], codePaths: [],
  }))
  writeFileSync(path.join(workspace, '.agents', 'notes', 'proposed', 'feature', '2026-11-07-work.md'), '---\nStatus: proposed\n---\n')
  return workspace
}

const workspace = makeWorkspace()
const host = fakeHost(workspace)
const agent = { id: 'session-test', session: { header: {} } }
const exec = (name, args) => host.handlers['tools/pre-execute']({ name, arguments: args, agent, signal: new AbortController().signal }, async () => ({ kind: 'allow' }))
const run = (name, input) => host.commands[name].handler({ agent, rawInput: input, attachments: [] })
const record = args => host.tools.gate_record.execute(args, { agent, signal: new AbortController().signal })

check('docs command registered', typeof host.commands['gate-docs']?.handler === 'function')
check('status command registered', typeof host.commands['gate-status']?.handler === 'function')
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

await run('gate-plan', 'work')
check('plan command enters orchestrating', loadState(workspace, agent).phase === 'orchestrating' && loadState(workspace, agent).node === 'plan')
check('plan review can start', (await record({ node: 'plan' })).ok === true && loadState(workspace, agent).node === 'plan-review')
check('empty plan review returns to discuss', (await record({ node: 'plan-review', findings: [] })).phase === 'discuss')

await run('gate-plan', 'work')
await record({ node: 'plan' })
const needsDiscussion = await record({ node: 'plan-review', findings: [{ id: 'P1' }], requiresDiscussion: true, discussionReason: 'product choice' })
check('plan findings can require discussion', needsDiscussion.phase === 'discuss' && loadState(workspace, agent).blockReason === 'needs-user-decision')

await run('gate-plan', 'work')
await record({ node: 'plan' })
for (let index = 0; index < 5; index += 1) {
  await record({ node: 'plan-review', findings: [{ id: `P${index}` }] })
  if (index < 4) await record({ node: 'plan-revise' })
}
check('plan review cap blocks', loadState(workspace, agent).work === 'blocked' && loadState(workspace, agent).blockReason === 'plan-review-rounds-exhausted')

await run('gate-implement', 'work')
check('implement command enters orchestrating', loadState(workspace, agent).phase === 'orchestrating' && loadState(workspace, agent).node === 'implement')
await record({ node: 'implement' })
check('implement moves to code review', loadState(workspace, agent).node === 'code-review')
check('empty code review moves to verify', (await record({ node: 'code-review', findings: [] })).node === 'verify')
check('verify passes', (await record({ node: 'verify', ok: true })).phase === 'complete')

await run('gate-implement', 'work')
await record({ node: 'implement' })
await record({ node: 'code-review', findings: [{ id: 'C1' }] })
check('code findings route to implement revise', loadState(workspace, agent).node === 'implement-revise')
await record({ node: 'implement-revise' })
await record({ node: 'code-review', findings: [] })
const failedVerify = await record({ node: 'verify', ok: false })
check('verify failure routes to revise', failedVerify.node === 'implement-revise')

const missing = mkdtempSync(path.join(os.tmpdir(), 'gate-missing-'))
mkdirSync(path.join(missing, '.agents'), { recursive: true })
writeFileSync(path.join(missing, '.agents', 'gate.json'), JSON.stringify({ enabled: true, version: 2 }))
const missingHost = fakeHost(missing)
const missingAgent = { id: 'session-missing', session: { header: {} } }
const rejected = await missingHost.commands['gate-plan'].handler({ agent: missingAgent, rawInput: 'no-such-note', attachments: [] })
check('plan without a work item is rejected', rejected.kind === 'error' && loadState(missing, missingAgent).phase === 'discuss')

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
