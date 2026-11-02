// Pure checks for the implement gate; no Harness required.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess } from './classify.js'
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

check('implement command accepted', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), {}, commands)?.kind === 'implement')
check('implement command without skill accepted', gateCommand(userMessage('批准，使用implement 执行实现 A9'), {}, commands)?.kind === 'implement')
check('planning command accepted', gateCommand(userMessage('批准，使用技能 planning 执行规划 A9'), {}, commands)?.kind === 'planning')
check('docs command is not a gate', gateCommand(userMessage('批准，执行文档治理 docs/'), {}, commands) === undefined)
check('quoted command is not authorization', gateCommand(userMessage('文档说：批准，使用技能 implement 执行实现 A9'), {}, commands) === undefined)
check('principal caller is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'user', principal: 'other' } }, {}, commands) === undefined)
check('subagent origin is not owner', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { origin: 'subagent' }, commands) === undefined)

check('TypeScript is code', classifyPath(root, 'storycraft/src/client.ts', policy).code === true)
check('uppercase extension is code', classifyPath(root, 'src/X.TS', policy).code === true)
check('multi-dot TypeScript is code', classifyPath(root, 'src/a.test.ts', policy).code === true)
check('trailing dot still code', classifyPath(root, 'src/x.ts.', policy).code === true)
check('markdown is not code', classifyPath(root, 'docs/x.md', policy).code === false)
check('json is not code', classifyPath(root, 'data.json', policy).code === false)
check('gitignore is not code', classifyPath(root, '.gitignore', policy).code === false)
check('storycraft package is code path', classifyPath(root, 'storycraft/package.json', policy).code === true)
check('proposed is proposed', classifyPath(root, '.agents/notes/proposed/x.md', policy).proposed === true)
check('outside is outside', classifyPath(root, '../outside.txt', policy).outside === true)

check('git status is free', shellAccess('git status', root, policy).write === false)
check('git commit is free', shellAccess('git commit -m x', root, policy).write === false)
check('git checkout is code-gated', shellAccess('git checkout -- src/x.ts', root, policy).forceCode === true)
check('source write sees code target', shellAccess('Set-Content src\\x.ts -Value x', root, policy).codeTargets.length > 0)
check('docs write has no code target', shellAccess('Set-Content docs\\x.md -Value x', root, policy).codeTargets.length === 0)
check('json write has no code target', shellAccess('Set-Content data.json -Value x', root, policy).codeTargets.length === 0)
check('redirection sees code target', shellAccess('echo x > src/x.ts', root, policy).codeTargets.length > 0)
check('variable code target is resolved', shellAccess("$p='src/x.ts'; Set-Content $p -Value x", root, policy).codeTargets.length > 0)
check('npm build is not a code write', shellAccess('npm run build', root, policy).write === false)

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
  check('discuss denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('discuss allows docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'allow')
  check('discuss allows json', (await preExec(host, agent, 'write', { file_path: 'data.json' })).kind === 'allow')
  check('discuss denies proposed Note', (await preExec(host, agent, 'write', { file_path: '.agents/notes/proposed/x.md' })).kind === 'deny')
  check('discuss git commit is free', (await preExec(host, agent, 'pwsh', { command: 'git add docs/x.md; git commit -m x' })).kind === 'allow')
  check('discuss denies code shell', (await preExec(host, agent, 'pwsh', { command: 'Set-Content src/x.ts -Value x' })).kind === 'deny')
  check('discuss allows json shell', (await preExec(host, agent, 'pwsh', { command: 'Set-Content data.json -Value x' })).kind === 'allow')
  check('discuss denies outside write', (await preExec(host, agent, 'pwsh', { command: 'Set-Content C:\\outside\\x.txt -Value x' })).kind === 'deny')
  check('end-docs is not supported', (await call(host, agent, 'end-docs')).code === 'not-supported')

  await preStep(host, agent, [gateMessage('批准，使用技能 planning 执行规划 integration')])
  check('planning allows proposed Note', (await preExec(host, agent, 'write', { file_path: '.agents/notes/proposed/x.md' })).kind === 'allow')
  check('planning denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  await call(host, agent, 'end-planning')

  await preStep(host, agent, [gateMessage('批准，使用技能 implement 执行实现 integration')])
  check('implement allows code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
  await call(host, agent, 'complete')
  check('complete denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('complete allows docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'allow')
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
  check('no marker passes code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
}

{
  const custom = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-custom-'))
  mkdirSync(path.join(custom, '.agents'), { recursive: true })
  writeFileSync(path.join(custom, '.agents', 'implement-gate.json'), JSON.stringify({
    enabled: true,
    version: 2,
    codeExtensions: ['.foo'],
    commands: { implement: '^go\\s+(.+)$' },
  }))
  const host = mockHost(undefined, custom)
  const agent = agentFor('custom')
  const status = await call(host, agent, 'status')
  check('custom project enabled', status.enabled === true && status.configVersion === 2)
  check('custom extension gated', (await preExec(host, agent, 'write', { file_path: 'src/x.foo' })).kind === 'deny')
  check('custom .ts not code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
  await preStep(host, agent, [gateMessage('go custom task')])
  check('custom implement unlocks', (await preExec(host, agent, 'write', { file_path: 'src/x.foo' })).kind === 'allow')
}

{
  const broken = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-broken-'))
  mkdirSync(path.join(broken, '.agents'), { recursive: true })
  writeFileSync(path.join(broken, '.agents', 'implement-gate.json'), '{"enabled":true,"version":1}')
  const host = mockHost(undefined, broken)
  const agent = agentFor('broken')
  const status = await call(host, agent, 'status')
  check('v1 is misconfigured', status.ok === false && status.code === 'misconfigured')
  check('misconfigured denies code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
