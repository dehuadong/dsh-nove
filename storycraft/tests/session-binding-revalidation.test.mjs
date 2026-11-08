// Session binding: catalog CAS for creation-time retarget, memory rebind only after CAS.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as tools from '../src/tools/index.ts'
import { setCurrent, getCurrent, clearCurrent } from '../src/current.ts'
import { writeCurrentBinding } from '../src/current-binding.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function codeOf(fn) {
  try { fn(); return 'none' } catch (error) { return error?.code ?? String(error) }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-binding-'))
try {
  const a = s.initWork(root, { title: '绑定甲' }).workId
  const b = s.initWork(root, { title: '绑定乙' }).workId
  s.setSessionCurrent(root, 's-cas', a)
  s.setSessionCurrent(root, 's-cas', b, { expectedWorkId: a })
  check('expected binding moves to the new work', (await s.readSessionCurrent(root))['s-cas'] === b)
  check('stale expected binding conflicts',
    codeOf(() => s.setSessionCurrent(root, 's-cas', a, { expectedWorkId: a })) === 'work-binding-conflict')
  check('conflict keeps the old binding', (await s.readSessionCurrent(root))['s-cas'] === b)
  check('manual rebind without expected is refused',
    codeOf(() => s.setSessionCurrent(root, 's-cas', a)) === 'work-binding-mismatch')

  check('memory rebind is refused without allowRebind',
    codeOf(() => { setCurrent('s-mem', a); setCurrent('s-mem', b) }) === 'work-binding-mismatch')
  setCurrent('s-mem', b, { allowRebind: true })
  check('memory accepts the catalog-authorized rebind', getCurrent('s-mem') === b)
  clearCurrent('s-mem')

  s.setSessionCurrent(root, 's-route', a)
  setCurrent('s-route', a)
  await writeCurrentBinding(root, 's-route', b).then(
    () => check('a bound route write is refused', false, 'expected rejection'),
    error => check('a bound route write is refused', error?.code === 'work-binding-mismatch', String(error?.code)),
  )
  check('the refused route write leaves the old memory', getCurrent('s-route') === a)
  clearCurrent('s-route')

  const registered = []
  const ctx = {
    tools: { register: definition => { registered.push(definition); return () => {} }, guard: () => () => {} },
    effect: fn => { const dispose = fn(); return () => dispose?.() },
    get: () => undefined,
  }
  tools.apply(ctx)
  const byName = new Map(registered.map(definition => [definition.name, definition]))
  const exec = { agent: { id: 's-init', session: { header: { cwd: root, agentPreset: 'storycraft' } } } }

  const firstProposal = await byName.get('story_propose').execute({ title: '绑定一', form: 'longform', premise: '一。' }, exec)
  const first = await byName.get('story_init').execute({ title: '绑定一', proposal: firstProposal.proposal }, exec)
  check('first init binds the session', (await s.readSessionCurrent(root))['s-init'] === first.workId)
  const secondProposal = await byName.get('story_propose').execute({ title: '绑定二', form: 'longform', premise: '二。' }, exec)
  const second = await byName.get('story_init').execute({ title: '绑定二', proposal: secondProposal.proposal }, exec)
  check('a creation action retargets the session binding',
    second.ok === true && (await s.readSessionCurrent(root))['s-init'] === second.workId,
    JSON.stringify(second))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
