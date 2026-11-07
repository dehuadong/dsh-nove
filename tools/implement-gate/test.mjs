// Pure checks for the implement gate; no Harness required.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess } from './classify.js'
import { apply, formatStatus } from './index.js'
import { findGateRoot, findProjectRoot, loadConfig } from './config.js'

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
check('docs command accepted', gateCommand(userMessage('批准，执行文档治理 docs/'), {}, commands)?.kind === 'docs')
check('quoted command is not authorization', gateCommand(userMessage('文档说：批准，使用技能 implement 执行实现 A9'), {}, commands) === undefined)
check('principal caller is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'user', principal: 'other' } }, {}, commands) === undefined)
check('subagent origin is not owner', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { origin: 'subagent' }, commands) === undefined)

const statusText = formatStatus({ ok: true, enabled: true, configPath: 'x', configVersion: 2, phase: 'complete', work: 'active', task: 'gate-status-render', blockReason: null })
check('status renders the GATES block', statusText.includes('状态：complete')
  && statusText.includes('工作项：gate-status-render')
  && statusText.includes('work：active')
  && statusText.includes('blockReason：无')
  && !statusText.includes('下一步'), statusText)
check('status renders blocked work', formatStatus({ ok: true, enabled: true, phase: 'implement', work: 'blocked', task: 'x', blockReason: 'contract' }).includes('blockReason：contract'))
check('status renders work-item-required', formatStatus({ ok: true, enabled: true, phase: 'discuss', work: 'active', task: 'x', blockReason: 'work-item-required' }).includes('blockReason：work-item-required'))
check('status renders misconfigured', formatStatus({ ok: false, code: 'misconfigured', reason: 'bad', configPath: 'x' }).includes('状态：misconfigured'))
check('status renders disabled', formatStatus({ ok: true, enabled: false, configPath: 'x' }).includes('状态：not-enabled'))

check('TypeScript is code', classifyPath(root, 'storycraft/src/client.ts', policy).code === true)
check('uppercase extension is code', classifyPath(root, 'src/X.TS', policy).code === true)
check('multi-dot TypeScript is code', classifyPath(root, 'src/a.test.ts', policy).code === true)
check('trailing dot still code', classifyPath(root, 'src/x.ts.', policy).code === true)
check('markdown is not code', classifyPath(root, 'docs/x.md', policy).code === false)
check('json is not code', classifyPath(root, 'data.json', policy).code === false)
check('gitignore is not code', classifyPath(root, '.gitignore', policy).code === false)
check('storycraft package is docs by default', classifyPath(root, 'storycraft/package.json', policy).docs === true)
check('proposed note is docs', classifyPath(root, '.agents/notes/proposed/x.md', policy).docs === true)
check('outside is outside', classifyPath(root, '../outside.txt', policy).outside === true)
check('repo marker resolves to the workspace', findGateRoot(root) === path.resolve(root))
check('repo root resolves to the workspace', findProjectRoot(root) === path.resolve(root))
const barren = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-barren-'))
check('bare directory has no gate', findGateRoot(barren) === undefined)
check('bare directory has no project root', findProjectRoot(barren) === undefined)

check('git status is free', shellAccess('git status', root, policy).write === false)
check('git commit is free', shellAccess('git commit -m x', root, policy).write === false)
check('git checkout is code-gated', shellAccess('git checkout -- src/x.ts', root, policy).forceCode === true)
check('source write sees code target', shellAccess('Set-Content src\\x.ts -Value x', root, policy).codeTargets.length > 0)
check('docs write has docs target', shellAccess('Set-Content docs\\x.md -Value x', root, policy).docsTargets.length > 0)
check('json write has docs target', shellAccess('Set-Content data.json -Value x', root, policy).docsTargets.length > 0)
check('redirection sees code target', shellAccess('echo x > src/x.ts', root, policy).codeTargets.length > 0)
check('variable code target is resolved', shellAccess("$p='src/x.ts'; Set-Content $p -Value x", root, policy).codeTargets.length > 0)
check('npm build is not a code write', shellAccess('npm run build', root, policy).write === false)

function mockHost(approval, workspace, { withPolicy = true } = {}) {
  if (workspace === undefined) {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-'))
    mkdirSync(path.join(workspace, '.agents'), { recursive: true })
    writeFileSync(path.join(workspace, '.agents', 'implement-gate.json'), readFileSync(path.join(root, '.agents', 'implement-gate.json')))
  }
  const handlers = {}
  const tools = {}
  const options = {}
  const commands = {}
  const ctx = {
    on: (name, handler) => { handlers[name] = handler },
    effect: fn => { fn() },
    inject: (deps, callback) => { callback(ctx) },
    commands: {
      register: definition => {
        commands[definition.name] = definition
        return () => {}
      },
    },
    get: name => name === 'approval' ? approval
      : name === 'sandboxPolicy' && withPolicy
        ? { workspaceRoot: workspace, resolve: () => ({ workspaceRoot: workspace }) }
        : undefined,
    tools: {
      register: (definition, registrationOptions = {}) => {
        tools[definition.name] = definition
        options[definition.name] = registrationOptions
      },
    },
  }
  apply(ctx)
  return { handlers, tools, options, commands }
}

function agentFor(id, header = {}) { return { id, session: { header } } }
const gateMessage = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const preStep = (host, agent, messages) => host.handlers['agent/pre-step']({ agent, messages }, async () => ({ kind: 'allow' }))
const preExec = (host, agent, name, args) => host.handlers['tools/pre-execute']({ name, arguments: args, agent, signal: new AbortController().signal, callId: 'c1' }, async () => ({ kind: 'allow' }))
const call = (host, agent, action, reason) => host.tools.implement_gate.execute({ action, reason }, { agent, signal: new AbortController().signal })
const visible = (host, agent) => host.options.implement_gate.when({ agent, modelSelection: {}, signal: new AbortController().signal })
const runCommand = (host, agent, input) => host.commands['implement-gate'].handler({
  commandId: 'cmd1',
  agent,
  rawInput: ` ${input}`,
  attachments: [],
  signal: new AbortController().signal,
})

{
  const host = mockHost(undefined)
  const agent = agentFor('a1')
  check('gated workspace shows tool', (await visible(host, agent)) === true)
  check('tool exposes no init action', !host.tools.implement_gate.parameters.properties.action.enum.includes('init'))
  check('discuss denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('discuss denies docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')
  check('discuss denies json', (await preExec(host, agent, 'write', { file_path: 'data.json' })).kind === 'deny')
  check('discuss denies proposed Note', (await preExec(host, agent, 'write', { file_path: '.agents/notes/proposed/x.md' })).kind === 'deny')
  check('discuss git commit is free', (await preExec(host, agent, 'pwsh', { command: 'git add docs/x.md; git commit -m x' })).kind === 'allow')
  check('discuss denies code shell', (await preExec(host, agent, 'pwsh', { command: 'Set-Content src/x.ts -Value x' })).kind === 'deny')
  check('discuss denies json shell', (await preExec(host, agent, 'pwsh', { command: 'Set-Content data.json -Value x' })).kind === 'deny')
  check('discuss denies outside write', (await preExec(host, agent, 'pwsh', { command: 'Set-Content C:\\outside\\x.txt -Value x' })).kind === 'deny')
  check('end-docs only from docs', (await call(host, agent, 'end-docs')).code === 'not-docs')

  await preStep(host, agent, [gateMessage('批准，使用技能 planning 执行规划 integration')])
  check('planning allows proposed Note', (await preExec(host, agent, 'write', { file_path: '.agents/notes/proposed/x.md' })).kind === 'allow')
  check('planning denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  await call(host, agent, 'end-planning')

  await preStep(host, agent, [gateMessage('批准，使用技能 implement 执行实现 mechanical:integration')])
  check('implement allows code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'allow')
  await call(host, agent, 'complete')
  check('complete denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  check('complete denies docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')
  const status = await call(host, agent, 'status')
  check('status reports complete', status.phase === 'complete')
}

{
  const host = mockHost(undefined)
  const agent = agentFor('d1')
  await preStep(host, agent, [gateMessage('批准，执行文档治理 docs/')])
  check('docs phase allows docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'allow')
  check('docs phase denies code', (await preExec(host, agent, 'write', { file_path: 'storycraft/src/x.ts' })).kind === 'deny')
  const ended = await call(host, agent, 'end-docs')
  check('end-docs returns to discuss', ended.ok === true && ended.phase === 'discuss', JSON.stringify(ended))
  check('after end-docs docs need authorization again', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')
}

{
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-work-item-'))
  mkdirSync(path.join(workspace, '.agents'), { recursive: true })
  writeFileSync(path.join(workspace, '.agents', 'implement-gate.json'), readFileSync(path.join(root, '.agents', 'implement-gate.json')))
  mkdirSync(path.join(workspace, '.agents', 'notes', 'proposed', 'feature'), { recursive: true })
  writeFileSync(path.join(workspace, '.agents', 'notes', 'proposed', 'feature', '2026-11-07-work-item.md'), '---\nStatus: proposed\n---\n')
  const host = mockHost(undefined, workspace)
  const proposedAgent = agentFor('work-item-proposed')
  await preStep(host, proposedAgent, [gateMessage('批准，使用技能 implement 执行实现 proposed:work-item')])
  check('proposed work item unlocks implement', (await preExec(host, proposedAgent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
  const blockedComplete = await call(host, proposedAgent, 'complete')
  check('complete is blocked while the work item is still proposed', blockedComplete.code === 'proposed-note-exists', JSON.stringify(blockedComplete))
  const returned = await call(host, proposedAgent, 'return-to-discuss')
  check('return-to-discuss leaves implement', returned.ok === true && returned.phase === 'discuss', JSON.stringify(returned))

  const missingAgent = agentFor('work-item-missing')
  await preStep(host, missingAgent, [gateMessage('批准，使用技能 implement 执行实现 missing-work-item')])
  const missingStatus = await call(host, missingAgent, 'status')
  check('implement without a work item stays in discuss', missingStatus.phase === 'discuss' && missingStatus.blockReason === 'work-item-required', JSON.stringify(missingStatus))

  const mechanicalAgent = agentFor('work-item-mechanical')
  await preStep(host, mechanicalAgent, [gateMessage('批准，使用技能 implement 执行实现 mechanical:format-only')])
  check('mechanical work item unlocks implement', (await preExec(host, mechanicalAgent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
  const mechanicalComplete = await call(host, mechanicalAgent, 'complete')
  check('mechanical work item completes without a note', mechanicalComplete.ok === true, JSON.stringify(mechanicalComplete))
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
  check('no marker hides tool', (await visible(host, agent)) === false)
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
  check('custom .ts is docs in discuss', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
  await preStep(host, agent, [gateMessage('批准，执行文档治理 custom docs')])
  check('custom .ts is docs under docs', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
  check('custom extension still code under docs', (await preExec(host, agent, 'write', { file_path: 'src/x.foo' })).kind === 'deny')
  await call(host, agent, 'end-docs')
  await preStep(host, agent, [gateMessage('go mechanical:custom task')])
  check('custom implement unlocks', (await preExec(host, agent, 'write', { file_path: 'src/x.foo' })).kind === 'allow')
}

{
  const defaults = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-defaults-'))
  mkdirSync(path.join(defaults, '.agents'), { recursive: true })
  writeFileSync(path.join(defaults, '.agents', 'implement-gate.json'), JSON.stringify({
    enabled: true, version: 2, codeExtensions: ['.foo'],
  }))
  const host = mockHost(undefined, defaults)
  const agent = agentFor('defaults')
  await preStep(host, agent, [gateMessage('批准，使用技能 planning 执行规划 default work')])
  check('no commands still accepts default planning', (await call(host, agent, 'status')).phase === 'planning')
  await call(host, agent, 'end-planning')
  await preStep(host, agent, [gateMessage('批准，使用技能 implement 执行实现 mechanical:defaults')])
  check('no commands still accepts default implement', (await preExec(host, agent, 'write', { file_path: 'src/x.foo' })).kind === 'allow')
}

{
  const partial = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-partial-'))
  mkdirSync(path.join(partial, '.agents'), { recursive: true })
  writeFileSync(path.join(partial, '.agents', 'implement-gate.json'), JSON.stringify({
    enabled: true, version: 2, codeExtensions: ['.foo'],
    commands: { planning: '^plan\\s+(.+)$' },
  }))
  const host = mockHost(undefined, partial)
  const agent = agentFor('partial')
  check('custom planning command accepted', gateCommand(gateMessage('plan partial'), {}, loadConfig(partial).policy.commands)?.kind === 'planning')
  check('omit implement command falls back to default', gateCommand(gateMessage('批准，使用技能 implement 执行实现 mechanical:partial'), {}, loadConfig(partial).policy.commands)?.kind === 'implement')
}

{
  const broken = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-broken-'))
  mkdirSync(path.join(broken, '.agents'), { recursive: true })
  writeFileSync(path.join(broken, '.agents', 'implement-gate.json'), '{"enabled":true,"version":1}')
  const host = mockHost(undefined, broken)
  const agent = agentFor('broken')
  const status = await call(host, agent, 'status')
  check('v1 is misconfigured', status.ok === false && status.code === 'misconfigured')
  check('misconfigured still shows tool', (await visible(host, agent)) === true)
  check('misconfigured denies code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
}

{
  const empty = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-init-'))
  const host = mockHost(undefined, empty)
  const agent = agentFor('init')
  const usage = await runCommand(host, agent, 'nope')
  check('command requires init', usage.kind === 'error' && usage.text.includes('/implement-gate init'))
  check('bad command input writes nothing', !existsSync(path.join(empty, '.agents', 'implement-gate.json')))
  check('command is registered with a hint', host.commands['implement-gate']?.input?.hint === 'init')
  check('command target hides tool before init', (await visible(host, agent)) === false)
  const created = await runCommand(host, agent, 'init')
  check('command creates config', created.kind === 'success' && existsSync(path.join(empty, '.agents', 'implement-gate.json')))
  const generated = JSON.parse(readFileSync(path.join(empty, '.agents', 'implement-gate.json'), 'utf8'))
  check('init omits commands and proposed', generated.commands === undefined && generated.proposed === undefined, JSON.stringify(generated))
  check('command enables tool', (await visible(host, agent)) === true)
  const status = await call(host, agent, 'status')
  check('command enables status', status.enabled === true && status.configVersion === 2)
  const again = await runCommand(host, agent, 'init')
  check('command refuses existing config', again.kind === 'error' && again.text.includes('已存在'))
  check('init defaults gate code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
  check('init defaults gate docs', (await preExec(host, agent, 'write', { file_path: 'docs/x.md' })).kind === 'deny')
}

{
  const repo = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-repo-'))
  mkdirSync(path.join(repo, '.git'))
  const pkg = path.join(repo, 'pkg')
  mkdirSync(pkg)
  const host = mockHost(undefined, pkg)
  const agent = agentFor('nested')
  check('nested workspace hides tool', (await visible(host, agent)) === false)
  const refused = await runCommand(host, agent, 'init')
  check('nested init refused with project root', refused.kind === 'error' && refused.text.includes(repo))
  check('nested init writes no marker', !existsSync(path.join(pkg, '.agents', 'implement-gate.json')))
}

{
  const repo = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-root-'))
  mkdirSync(path.join(repo, '.git'))
  const host = mockHost(undefined, repo)
  const agent = agentFor('root-init')
  const created = await runCommand(host, agent, 'init')
  check('project root init succeeds', created.kind === 'success' && existsSync(path.join(repo, '.agents', 'implement-gate.json')))
  check('project root init enables tool', (await visible(host, agent)) === true)
}

{
  const base = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-sub-'))
  mkdirSync(path.join(base, '.agents'), { recursive: true })
  writeFileSync(path.join(base, '.agents', 'implement-gate.json'), readFileSync(path.join(root, '.agents', 'implement-gate.json')))
  const sub = path.join(base, 'pkg')
  mkdirSync(sub)
  const host = mockHost(undefined, sub)
  const agent = agentFor('sub')
  check('subdir inherits ancestor gate', (await visible(host, agent)) === true)
  const status = await call(host, agent, 'status')
  check('subdir status reports ancestor marker', status.configPath === path.join(base, '.agents', 'implement-gate.json'))
  check('subdir denies code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'deny')
  await preStep(host, agent, [gateMessage('批准，使用技能 planning 执行规划 sub')])
  const stateDir = path.join(base, '.agents', 'state', 'implement-gate')
  check('state stays beside the marker', existsSync(stateDir) && !existsSync(path.join(sub, '.agents')))
  const refused = await runCommand(host, agent, 'init')
  check('subdir init refused', refused.kind === 'error' && !existsSync(path.join(sub, '.agents', 'implement-gate.json')))
}

{
  const empty = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-off-'))
  mkdirSync(path.join(empty, '.agents'), { recursive: true })
  writeFileSync(path.join(empty, '.agents', 'implement-gate.json'), JSON.stringify({ enabled: false }))
  const host = mockHost(undefined, empty)
  const agent = agentFor('off')
  check('disabled hides tool', (await visible(host, agent)) === false)
  check('disabled passes code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
}

{
  const base = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-sub-off-'))
  mkdirSync(path.join(base, '.agents'), { recursive: true })
  writeFileSync(path.join(base, '.agents', 'implement-gate.json'), readFileSync(path.join(root, '.agents', 'implement-gate.json')))
  const sub = path.join(base, 'pkg')
  mkdirSync(path.join(sub, '.agents'), { recursive: true })
  writeFileSync(path.join(sub, '.agents', 'implement-gate.json'), JSON.stringify({ enabled: false }))
  const host = mockHost(undefined, sub)
  const agent = agentFor('sub-off')
  check('nearest disabled marker wins', (await visible(host, agent)) === false)
  check('nearest disabled passes code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
}

{
  const base = mkdtempSync(path.join(os.tmpdir(), 'implement-gate-no-policy-'))
  mkdirSync(path.join(base, '.agents'), { recursive: true })
  writeFileSync(path.join(base, '.agents', 'implement-gate.json'), readFileSync(path.join(root, '.agents', 'implement-gate.json')))
  const host = mockHost(undefined, base, { withPolicy: false })
  const agent = agentFor('no-policy')
  check('unresolved workspace hides tool', (await visible(host, agent)) === false)
  check('unresolved workspace passes code', (await preExec(host, agent, 'write', { file_path: 'src/x.ts' })).kind === 'allow')
  const refused = await runCommand(host, agent, 'init')
  check('unresolved workspace refuses init', refused.kind === 'error' && refused.text.includes('无法确定'))
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
