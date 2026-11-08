// Human command entry: /story-init initializes a longform workspace.
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeWorkspace, registerStoryCommands } from '../src/commands.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-command-'))
try {
  const invocation = { agent: { session: { header: { cwd: root } } }, rawInput: '' }
  const initialized = await initializeWorkspace(invocation)
  check('story-init succeeds', initialized.kind === 'success', JSON.stringify(initialized))
  check('story-init creates the workspace directory', existsSync(root), root)

  const named = await initializeWorkspace({ ...invocation, rawInput: '第二本' })
  check('story-init accepts a project name', named.kind === 'success' && existsSync(join(root, '第二本')), JSON.stringify(named))

  const again = await initializeWorkspace(invocation)
  check('re-running on the same workspace is idempotent', again.kind === 'success', JSON.stringify(again))

  const missing = await initializeWorkspace({ agent: { session: { header: {} } }, rawInput: '' })
  check('missing cwd is a command error', missing.kind === 'error', JSON.stringify(missing))

  const registered = []
  registerStoryCommands({ commands: { register: (definition) => { registered.push(definition); return () => {} } } })
  check('registers the story-init command', registered.length === 1 && registered[0].name === 'story-init', JSON.stringify(registered.map(entry => entry.name)))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
