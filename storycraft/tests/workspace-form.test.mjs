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
const exec = (sessionId, agentPreset = 'storycraft') => ({ agent: { id: sessionId, session: { header: { cwd: root, agentPreset } } } })
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

  const unknownPreset = await byName.get('story_propose').execute({
    title: '未知预设', form: 'longform', premise: '未知预设。',
  }, exec('s4', 'unknown-preset'))
  check('an unknown preset is refused instead of coerced',
    unknownPreset.ok === false && unknownPreset.error.code === 'preset-form-unknown', JSON.stringify(unknownPreset))

  const shortProposal = await byName.get('story_propose').execute({
    title: '短篇入口', form: 'short', premise: '短篇入口。',
  }, exec('s5', 'storycraft-short'))
  const shortEntry = await byName.get('story_init').execute({ title: '短篇入口', proposal: shortProposal.proposal }, exec('s5', 'storycraft-short'))
  check('the short preset creates a short work',
    shortProposal.ok === true && shortEntry.ok === true
    && s.readManifest(root, shortEntry.workId).form === 'short', JSON.stringify(shortEntry))

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
