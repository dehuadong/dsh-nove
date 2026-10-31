// Pure checks for the implement gate; no Harness required.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess, shellOutside } from './classify.js'
import { apply } from './index.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

const userMessage = text => ({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

check('implement command accepted', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9 技能证据'), {})?.kind === 'implement')
check('implement command without skill accepted', gateCommand(userMessage('批准，使用implement 执行实现 A9'), {})?.kind === 'implement')
check('planning command accepted', gateCommand(userMessage('批准，使用技能 planning 执行规划 A9'), {})?.kind === 'planning')
check('quoted command is not authorization', gateCommand(userMessage('文档说：批准，使用技能 implement 执行实现 A9'), {}) === undefined)
check('question is not authorization', gateCommand(userMessage('是不是批准，使用技能 implement 执行实现 A9？'), {}) === undefined)
check('planning does not unlock implement', gateCommand(userMessage('批准，使用技能 planning 执行规划 A9'), {})?.kind !== 'implement')
check('principal caller is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'user', principal: 'other' } }, {}) === undefined)
check('historical parentSession alone is not a subagent', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { parentSession: 'p' })?.kind === 'implement')
check('subagent origin is not owner', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { origin: 'subagent' }) === undefined)
check('schedule source is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'schedule' } }, {}) === undefined)

const root = process.cwd()
check('source path needs authorization', classifyPath(root, 'storycraft/src/client.ts').docs === false)
check('note path is documentation', classifyPath(root, '.agents/notes/proposed/x.md').docs === true)
check('docs path is documentation', classifyPath(root, 'docs/agents/GATES.md').docs === true)
check('root AGENTS is documentation', classifyPath(root, 'AGENTS.md').docs === true)
check('outside path is rejected', classifyPath(root, '../outside.txt').outside === true)

check('read command is allowed', shellAccess('git status', root).write === false)
check('write command is gated', shellAccess('Set-Content src\\x.ts -Value x', root).write === true)
check('compound docs command still sees the source write', shellAccess('Set-Content src\\x.ts -Value x; git add docs', root).docsOnly === false)
check('read-only redirect is not a write', shellAccess('node -e "console.log(1)" 2>&1', root).write === false)
check('build command is gated', shellAccess('npm run build', root).write === true)
check('docs trash is a docs operation', shellAccess('node scripts/trash.mjs .agents/notes/proposed/x.md', root).docsOnly === true)
check('source trash is not a docs operation', shellAccess('node scripts/trash.mjs storycraft/src/client.ts', root).docsOnly === false)
check('docs-only git add is a docs operation', shellAccess('git add .agents/notes docs', root).docsOnly === true)
check('source git add is gated', shellAccess('git add storycraft/src/client.ts', root).docsOnly === false)
check('git push does not write the tree', shellAccess('git push origin main', root).write === false)
check('docs-only git mv is a docs operation', shellAccess('git mv .agents/notes/a.md .agents/notes/b.md', root).docsOnly === true)
check('source git mv is gated', shellAccess('git mv storycraft/src/a.ts storycraft/src/b.ts', root).docsOnly === false)

function mockHost(approval, workspace) {
  if (workspace === undefined) {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-'))
    mkdirSync(path.join(workspace, '.agents'), { recursive: true })
    writeFileSync(path.join(workspace, '.agents', 'implement-gate.json'), '{"enabled":true}')
  }
  const handlers = {}
  const tools = {}
  const ctx = {
    on: (name, handler) => { handlers[name] = handler },
    get: name => name === 'approval' ? approval : name === 'sandboxPolicy' ? { workspaceRoot: workspace, resolve: () => ({ workspaceRoot: workspace }) } : undefined,
    tools: { register: definition => { tools[definition.name] = definition } },
  }
  apply(ctx)
  return { handlers, tools }
}

function agentFor(id, header = {}) { return { id, session: { header } } }
const gateMessage = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const preStep = (host, agent, messages) => host.handlers['agent/pre-step']({ agent, messages }, async () => ({ kind: 'allow' }))
const preExec = (host, agent, name, args) => host.handlers['tools/pre-execute']({ name, arguments: args, agent, signal: new AbortController().signal, callId: 'c1' }, async () => ({ kind: 'allow' }))
const call = (host, agent, action, reason) => host.tools.implement_gate.execute({ action, reason }, { agent, signal: new AbortController().signal })

{
  const host = mockHost(undefined)
  const agent = agentFor('a1')
  const gate = { execute: (args, exec) => host.tools.implement_gate.execute(args, exec) }
  check('discuss denies source write', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('discuss denies planning Note write', (await preExec(host, agent, 'write', { file_path: '.agents/notes/x.md' })).kind === 'deny')
  await preStep(host, agent, [gateMessage('批准，使用技能 planning 执行规划 integration')])
  check('planning allows Note write', (await preExec(host, agent, 'write', { file_path: '.agents/notes/x.md' })).kind === 'allow')
  check('planning still denies source write', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  await call(host, agent, 'end-planning')
  check('end-planning denies Note write', (await preExec(host, agent, 'write', { file_path: '.agents/notes/x.md' })).kind === 'deny')
  await preStep(host, agent, [gateMessage('批准，使用技能 implement 执行实现 integration')])
  check('implement allows source write', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
  await call(host, agent, 'block', 'contract changed')
  check('blocked denies source write', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('blocked allows Note write', (await preExec(host, agent, 'write', { file_path: '.agents/notes/x.md' })).kind === 'allow')
  await call(host, agent, 'complete')
  check('complete denies source write', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('complete allows Note write', (await preExec(host, agent, 'write', { file_path: '.agents/notes/x.md' })).kind === 'allow')
  const status = await call(host, agent, 'status')
  check('status reports complete', status.phase === 'complete')
}

{
  const host = mockHost({ overrideOf: () => undefined, request: async () => 'allowed-once' })
  const agent = agentFor('a2')
  const approved = await call(host, agent, 'authorize')
  check('approval allowed-once authorizes', approved.ok === true && (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
}

{
  const host = mockHost({ overrideOf: () => undefined, request: async () => 'rejected' })
  const agent = agentFor('a3')
  const rejected = await call(host, agent, 'authorize')
  check('approval rejected falls back to command', rejected.ok === false && rejected.code === 'approval-rejected')
  check('approval rejected does not authorize', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
}

{
  const empty = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-'))
  const host = mockHost(undefined, empty)
  const agent = agentFor('other')
  const status = await call(host, agent, 'status')
  check('workspace without marker is disabled', status.enabled === false)
  check('workspace without marker passes writes through', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
}

check('compound shell outside is detected', shellOutside('Set-Content C:\\outside\\x.txt x', root) === true)

check('relative ./path is not outside', shellOutside('node -e "./tools/x"', root) === false)
check('parent escape is outside', shellOutside('Set-Content ..\\x.txt x', root) === true)

check('piped docs trash keeps docs classification', shellAccess('node scripts/trash.mjs .agents/notes/x | Select-Object -Last 1', root).docsOnly === true)

const hereStringCommand = [
  "Set-Location E:\\dsh-nove\\storycraft",
  "$p = '.tmp-tools\\analysis-perf.mjs'",
  "@'",
  "import { select } from '../src/retrieval.ts'",
  "'@ | Set-Content -LiteralPath $p",
].join('\n')
check('here-string relative imports are not outside', shellOutside(hereStringCommand, root) === false)
check('here-string does not hide a real outside target', shellOutside("Set-Content C:\\outside\\x.txt x", root) === true)

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
