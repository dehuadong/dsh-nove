// One workspace carries one form: the first init fixes it, later works must match.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tools from '../src/tools/index.ts'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const registered = []
const ctx = {
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {} },
  effect: (fn) => { const dispose = fn(); return () => dispose?.() },
  get: () => undefined,
}
tools.apply(ctx, { mode: 'longform' })
const byName = new Map(registered.map(definition => [definition.name, definition]))
const exec = (sessionId) => ({ agent: { id: sessionId, session: { header: { cwd: root, agentPreset: 'storycraft' } } } })

const root = await mkdtemp(join(tmpdir(), 'storycraft-workspace-form-'))
try {
  const propose = await byName.get('story_propose').execute({
    title: '第一篇', form: 'longform', premise: '一条前提。',
  }, exec('s1'))
  check('longform proposal accepted', propose.ok === true, JSON.stringify(propose))
  const first = await byName.get('story_init').execute({ title: '第一篇', proposal: propose.proposal }, exec('s1'))
  check('first work initialized', first.ok === true, JSON.stringify(first))
  check('workspace form fixed on first init', s.readWorkspaceForm(root)?.form === 'longform', JSON.stringify(s.readWorkspaceForm(root)))

  const proposeTwo = await byName.get('story_propose').execute({
    title: '第二篇', form: 'longform', premise: '另一条前提。',
  }, exec('s2'))
  const second = await byName.get('story_init').execute({ title: '第二篇', proposal: proposeTwo.proposal }, exec('s2'))
  check('a second longform work is allowed', second.ok === true, JSON.stringify(second))
  check('one work per database', s.listWorks(root).filter(work => work.trashed !== true).length === 2, JSON.stringify(s.listWorks(root)))

  const badProposal = await byName.get('story_propose').execute({
    title: '短篇', form: 'short', premise: '错误形态。',
  }, exec('s3'))
  check('cross-form proposal is refused', badProposal.ok === false && badProposal.error.code === 'workspace-form-mismatch', JSON.stringify(badProposal))

  let storageCode
  try {
    s.ensureWorkspaceForm(root, 'short', 'storycraft-short')
  } catch (error) {
    storageCode = error?.code
  }
  check('workspace form cannot change in storage', storageCode === 'workspace-form-mismatch', String(storageCode))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
