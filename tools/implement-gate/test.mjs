// Pure checks for the implement gate; no Harness required.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess, shellOutside } from './classify.js'
import { apply } from './index.js'
import { loadConfig } from './config.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

const root = process.cwd()
const loaded = loadConfig(root)
if (loaded.kind !== 'ok') { console.error('invalid test config', loaded); process.exit(1) }
const policy = loaded.policy
const commands = policy.commands

const userMessage = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })

check('implement command accepted', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9 技能证据'), {}, commands)?.kind === 'implement')
check('implement command without skill accepted', gateCommand(userMessage('批准，使用implement 执行实现 A9'), {}, commands)?.kind === 'implement')
check('planning command accepted', gateCommand(userMessage('批准，使用技能 planning 执行规划 A9'), {}, commands)?.kind === 'planning')
check('docs command accepted', gateCommand(userMessage('批准，执行文档治理 docs/'), {}, commands)?.kind === 'docs')
check('quoted command is not authorization', gateCommand(userMessage('文档说：批准，使用技能 implement 执行实现 A9'), {}, commands) === undefined)
check('question is not authorization', gateCommand(userMessage('是不是批准，使用技能 implement 执行实现 A9？'), {}, commands) === undefined)
check('principal caller is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'user', principal: 'other' } }, {}, commands) === undefined)
check('subagent origin is not owner', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { origin: 'subagent' }, commands) === undefined)
check('schedule source is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'schedule' } }, {}, commands) === undefined)

check('source TypeScript is code', classifyPath(root, 'storycraft/src/client.ts', policy).code === true)
check('source markdown is not code', classifyPath(root, 'storycraft/src/storage.md', policy).code === false)
check('proposed Note is proposed', classifyPath(root, '.agents/notes/proposed/x.md', policy).proposed === true)
check('docs is documentation', classifyPath(root, 'docs/agents/GATES.md', policy).docs === true)
check('AGENTS is documentation', classifyPath(root, 'AGENTS.md', policy).docs === true)
check('outside path is rejected', classifyPath(root, '../outside.txt', policy).outside === true)
check('doc scope shell exposes targets', shellAccess('node scripts/trash.mjs docs/x', root, policy).targets.length === 1)

check('read command is allowed', shellAccess('git status', root, policy).write === false)
check('write command is gated', shellAccess('Set-Content src\\x.ts -Value x', root, policy).write === true)
check('compound docs command sees source write', shellAccess('Set-Content src\\x.ts -Value x; git add docs', root, policy).docsOnly === false)
check('read-only redirect is not a write', shellAccess('node -e "console.log(1)" 2>&1', root, policy).write === false)
check('build command is gated', shellAccess('npm run build', root, policy).write === true)
check('proposed trash is marked', shellAccess('node scripts/trash.mjs .agents/notes/proposed/x.md', root, policy).touchesProposed === true)
check('source trash is not docs', shellAccess('node scripts/trash.mjs storycraft/src/client.ts', root, policy).docsOnly === false)
check('docs-only git add is docs', shellAccess('git add .agents/notes docs', root, policy).docsOnly === true)
check('source git add is gated', shellAccess('git add storycraft/src/client.ts', root, policy).docsOnly === false)
check('git push does not write tree', shellAccess('git push origin main', root, policy).write === false)
check('pipeline stays one statement', shellAccess('echo x | xargs rm', root, policy).write === true)

const hereString = [
  "Set-Location E:\\dsh-nove\\storycraft",
  "$p = '.tmp-tools\\analysis-perf.mjs'",
  "@'",
  "import { select } from '../src/retrieval.ts'",
  "'@ | Set-Content -LiteralPath $p",
].join('\n')
check('here-string imports are not outside', shellOutside(hereString, root) === false)
check('real outside target is detected', shellOutside('Set-Content C:\\outside\\x.txt x', root) === true)

function mockHost(approval, workspace) {
  if (workspace === undefined) {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-'))
    mkdirSync(path.join(workspace, '.agents'), { recursive: true })
    writeFileSync(path.join(workspace, '.agents', 'implement-gate.json'), readFileSync(path.join(root, '.agents', 'implement-gate.json')))
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
  check('discuss denies source', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('discuss denies docs without scope', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')
  await preStep(host, agent, [gateMessage('批准，执行文档治理 docs/')])
  check('docs scope allows docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'allow')
  check('docs scope rejects AGENTS', (await preExec(host, agent, 'write', { file_path: 'AGENTS.md' })).kind === 'deny')
  check('docs scope rejects source', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('docs scope allows shell docs', (await preExec(host, agent, 'pwsh', { command: 'node scripts/trash.mjs docs/x.md' })).kind === 'allow')
  check('docs scope rejects out-of-scope shell', (await preExec(host, agent, 'pwsh', { command: 'node scripts/trash.mjs AGENTS.md' })).kind === 'deny')
  const scoped = await call(host, agent, 'status')
  check('status reports docScope', scoped.docScope === 'docs')
  await call(host, agent, 'end-docs')
  check('end-docs removes docs access', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')

  await preStep(host, agent, [gateMessage('批准，使用技能 planning 执行规划 integration')])
  check('planning allows proposed Note', (await preExec(host, agent, 'write', { file_path: '.agents/notes/proposed/x.md' })).kind === 'allow')
  check('planning denies source', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  await call(host, agent, 'end-planning')
  check('end-planning denies proposed Note', (await preExec(host, agent, 'write', { file_path: '.agents/notes/proposed/x.md' })).kind === 'deny')

  await preStep(host, agent, [gateMessage('批准，使用技能 implement 执行实现 integration')])
  check('implement allows source', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
  await call(host, agent, 'block', 'contract changed')
  check('blocked denies source', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  await call(host, agent, 'complete')
  check('complete denies source', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('complete denies docs without scope', (await preExec(host, agent, 'write', { file_path: '.agents/notes/implemented/x.md' })).kind === 'deny')
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
  const empty = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-empty-'))
  const host = mockHost(undefined, empty)
  const agent = agentFor('other')
  const status = await call(host, agent, 'status')
  check('no marker is disabled', status.enabled === false)
  check('no marker passes writes', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
}

{
  const custom = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-custom-'))
  mkdirSync(path.join(custom, '.agents'), { recursive: true })
  writeFileSync(path.join(custom, '.agents', 'implement-gate.json'), JSON.stringify({
    enabled: true,
    version: 1,
    codeRoots: ['src'],
    commands: { implement: '^go\\s+(.+)$', docs: '^doc\\s+(.+)$' },
  }))
  const host = mockHost(undefined, custom)
  const agent = agentFor('custom')
  const status = await call(host, agent, 'status')
  check('custom project enabled', status.enabled === true && status.configVersion === 1)
  check('custom code root gated', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
  check('custom docs gated in discuss', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')
  await preStep(host, agent, [gateMessage('go custom task')])
  check('custom implement unlocks', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
  await call(host, agent, 'complete')
  await preStep(host, agent, [gateMessage('doc docs/')])
  check('custom docs unlocks', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'allow')
}

{
  const broken = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-broken-'))
  mkdirSync(path.join(broken, '.agents'), { recursive: true })
  writeFileSync(path.join(broken, '.agents', 'implement-gate.json'), '{"enabled":true}')
  const host = mockHost(undefined, broken)
  const agent = agentFor('broken')
  const status = await call(host, agent, 'status')
  check('invalid marker is misconfigured', status.ok === false && status.code === 'misconfigured')
  check('misconfigured denies writes', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
