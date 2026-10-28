// Deleting the current work must release the session binding, in the catalog and
// in the host's in-memory pointer, or the session is stuck with a dead pointer.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as tools from '../src/tools.ts'
import { clearCurrent, getCurrent, setCurrent } from '../src/current.ts'

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
const deleteAction = registered.find(definition => definition.name === 'story_delete')

const root = await mkdtemp(join(tmpdir(), 'storycraft-delete-binding-'))
try {
  const { workId: work } = s.initWork(root, { title: '删当前作品' })
  s.setSessionCurrent(root, 'delete-session', work)
  check('the session binding exists before deletion',
    s.readSessionCurrent(root)['delete-session'] === work, JSON.stringify(s.readSessionCurrent(root)))

  const exec = { agent: { id: 'delete-session', session: { header: { cwd: root } } } }
  setCurrent('delete-session', work)
  await deleteAction.execute({ work }, exec)

  check('the catalog binding is gone after deletion',
    s.readSessionCurrent(root)['delete-session'] === undefined, JSON.stringify(s.readSessionCurrent(root)))
  check('the in-memory pointer is cleared after deletion', getCurrent('delete-session') === undefined, String(getCurrent('delete-session')))

  // A fresh work can be created right away in the same session.
  const next = s.initWork(root, { title: '删后重建' })
  check('a new work can be created in the same session', next.workId === '删后重建', JSON.stringify(next))
} finally {
  clearCurrent('delete-session')
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
