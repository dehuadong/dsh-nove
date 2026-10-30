// story_read must not treat every state:* id as the event log.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as tools from '../src/tools.ts'
import { setCurrent } from '../src/current.ts'

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
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
}
tools.apply(ctx, { mode: 'longform' })
const readTool = registered.find(definition => definition.name === 'story_read')

const root = await mkdtemp(join(tmpdir(), 'storycraft-state-read-'))
try {
  const { workId: work } = s.initWork(root, { title: '状态读取', wordRange: { min: 10, max: 5000 } })
  setCurrent('state-read', work)
  s.writeOutline(root, { work, mainline: '主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  s.writeChapter(root, { work, chapter: 1, title: '第1章', body: '甲把账本收好。'.repeat(20) })
  s.writeReview(root, { work, chapter: 1, observations: [] })
  s.writeSummary(root, { work, chapter: 1, text: '甲收好账本。' })
  const draft = s.writeStateDraft(root, {
    work, chapter: 1,
    factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好账本' }] },
    ready: true,
  })
  const exec = { agent: { id: 'state-read', session: { header: { cwd: root } } } }
  const read = (artifactId, extra = {}) => readTool.execute({ work, artifactId, ...extra }, exec)
  const codeOfRead = async (artifactId) => {
    try {
      const result = await read(artifactId)
      return result?.ok === false ? result.error?.code ?? '' : ''
    } catch (error) { return error?.code ?? String(error) }
  }

  const state = await read('state')
  check('state still returns the event log', state.ok === true && state.artifact.kind === 'state'
    && state.artifact.revisionId === 'seq:0' && state.content === '', JSON.stringify(state))

  const draftRead = await read(`state:draft:1:r${draft.revision}`)
  check('a draft is readable by its artifact id',
    draftRead.ok === true && draftRead.artifact.kind === 'state_draft'
    && draftRead.artifact.revisionId === draft.revisionId
    && JSON.parse(draftRead.content).revision === draft.revision,
    JSON.stringify(draftRead))

  const staleCode = await codeOfRead('state:draft:1:r9')
  check('a stale draft revision is not found', staleCode === 'revision-not-found', staleCode)
  const otherCode = await codeOfRead('state:other')
  check('other state ids are not readable', otherCode === 'artifact-not-readable', otherCode)
  const malformedCode = await codeOfRead('state:draft:1')
  check('malformed draft ids are not readable', malformedCode === 'artifact-not-readable', malformedCode)

  s.finalizeChapter(root, { work, chapter: 1 })
  const consumedCode = await codeOfRead(`state:draft:1:r${draft.revision}`)
  check('a consumed draft is gone', consumedCode === 'artifact-not-found', consumedCode)
  s.reopenChapter(root, { work, chapter: 1 })
  const reopenedCode = await codeOfRead('state:draft:1:r1')
  check('a reopened chapter has no draft', reopenedCode === 'artifact-not-found', reopenedCode)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
