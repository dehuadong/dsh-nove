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

function fakeHost(workspace) {
  const commands = {}
  const handlers = {}
  const ctx = {
    on: (name, handler) => { handlers[name] = handler },
    inject: (_deps, callback) => callback(ctx),
    get: name => name === 'sandboxPolicy' ? { workspaceRoot: workspace, resolve: () => ({ workspaceRoot: workspace }) } : undefined,
    systemPrompt: { section: () => {}, getSectionOrder: () => 500 },
    skills: { register: () => {} },
    commands: { register: definition => { commands[definition.name] = definition; return () => {} } },
    tools: { register: () => {} },
  }
  apply(ctx)
  return { ctx, commands, handlers }
}

const workspace = mkdtempSync(path.join(os.tmpdir(), 'gate-core-'))
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

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
