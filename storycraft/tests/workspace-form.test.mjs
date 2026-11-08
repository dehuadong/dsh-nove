// One workspace may hold works of different forms; the preset still scopes proposals.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tools from '../src/tools/index.ts'
import * as s from '../src/storage.ts'
import { openCatalog } from '../src/storage/db.ts'

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

const root = await mkdtemp(join(tmpdir(), 'storycraft-workspace-form-'))
const exec = (sessionId) => ({ agent: { id: sessionId, session: { header: { cwd: root, agentPreset: 'storycraft' } } } })
try {
  const short = s.initWork(root, { title: '短篇', form: 'short' })
  check('a short work exists first', s.listWorks(root).some(work => work.workId === short.workId), JSON.stringify(s.listWorks(root)))

  const propose = await byName.get('story_propose').execute({
    title: '长篇', form: 'longform', premise: '一条前提。',
  }, exec('s1'))
  check('longform proposal accepted', propose.ok === true, JSON.stringify(propose))
  const longform = await byName.get('story_init').execute({ title: '长篇', proposal: propose.proposal }, exec('s1'))
  check('longform work joins the existing short work', longform.ok === true, JSON.stringify(longform))
  check('one workspace holds both forms',
    s.listWorks(root).filter(work => work.trashed !== true).length === 2, JSON.stringify(s.listWorks(root)))

  const forms = s.listWorks(root).map(work => s.readManifest(root, work.workId).form).sort()
  check('each work keeps its own form', forms.join(',') === 'longform,short', JSON.stringify(forms))

  const badProposal = await byName.get('story_propose').execute({
    title: '错形态', form: 'short', premise: '错误形态。',
  }, exec('s3'))
  check('the active preset still refuses another form',
    badProposal.ok === false && badProposal.error.code === 'workspace-form-mismatch', JSON.stringify(badProposal))

  const catalog = openCatalog(root, { create: false })
  try {
    check('workspace form table is gone',
      catalog.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'workspace'").get().n === 0)
  } finally {
    catalog?.close()
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
