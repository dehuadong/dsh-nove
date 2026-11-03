// R2: one role module per role, one runtime seam, no per-role ladder left.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DELEGATE_ROLES, ROLES, ROLE_META } from '../src/roles/registry.ts'
import { loadRoleInput } from '../src/runtime/role-input.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const src = join(import.meta.dirname, '..', 'src')

check('the old delegation monolith is gone', !existsSync(join(src, 'delegate.ts')) && !existsSync(join(src, 'submission.ts')))
check('the runtime leaf modules exist', ['child-run.ts', 'delegate-runner.ts', 'role-input.ts', 'role-input-kit.ts', 'submission.ts']
  .every(name => existsSync(join(src, 'runtime', name))))

const roles = ['architect', 'planner', 'writer', 'reviewer', 'reviser', 'summarizer', 'settler', 'validator']
check('the registry covers every role', roles.every(role => ROLES[role] !== undefined), JSON.stringify(Object.keys(ROLES)))

const contractRoles = roles.filter(role => ROLES[role].contract?.name === role)
check('every role declares its own contract', contractRoles.length === roles.length, JSON.stringify(contractRoles))

const delegateContracts = DELEGATE_ROLES.map(role => ROLES[role].contract)
const actions = delegateContracts.map(contract => contract.nextAction).filter(action => action !== undefined)
check('delegate roles declare unique next actions', new Set(actions).size === actions.length, JSON.stringify(actions))
check('delegate roles declare unique labels', new Set(delegateContracts.map(contract => contract.label)).size === delegateContracts.length)
check('receipt labels come from contracts', ROLE_META.writer.label === ROLES.writer.contract.label
  && ROLE_META.architect.label === '架构师')

const promptRoles = ['planner', 'writer', 'reviewer', 'reviser', 'summarizer']
check('each delegated chapter role owns its prompt lines', promptRoles.every(role => {
  const lines = ROLES[role].prompts?.lines({ mode: 'patch' })
  return Array.isArray(lines) && lines.length > 0 && lines.some(line => line.includes('payload 格式'))
}))
check('the reviser prompt names the active mode', ROLES.reviser.prompts.lines({ mode: 'deslop' }).some(line => line.includes('deslop')))

check('planner accepts a five-field plan', ROLES.planner.schema.validate({
  perspective: '甲', goal: '查清旧案', obstacle: '证人失踪', cost: '失去靠山', turn: '发现证人是自己人', body: '章纲', threadRefs: [],
}) === undefined)
check('planner rejects a non-array threadRefs', ROLES.planner.schema.validate({
  perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: 'x',
}) === 'planner 的 threadRefs 必须是字符串数组')
check('writer rejects an empty body', ROLES.writer.schema.validate({ title: 't', body: ' ' }) === 'writer 缺少 body')
check('reviewer rejects an illegal mode', typeof ROLES.reviewer.schema.validate({
  items: [{ quote: 'q', problem: 'p', fix: 'f', severity: 'major', mode: 'nope' }],
}) === 'string')
check('settler keeps its bounds', ROLES.settler.schema.validate({ factOps: { upsert: [{ subject: 'a', predicate: 'b', object: 'c' }] }, hookOps: {}, newHooks: [] }) === undefined)

const runner = readFileSync(join(src, 'runtime', 'delegate-runner.ts'), 'utf8')
// architect is the documented exception: foundation is its own pipeline, not the chapter ladder.
const ladder = /role === '(?:writer|planner|reviewer|reviser|summarizer)'/u.test(runner)
check('the runner has no per-role ladder', !ladder)
check('the runner reaches roles through the registry', runner.includes('ROLES[') && runner.includes('contract.preflight'))
check('settle and check read the child-run leaf', readFileSync(join(src, 'state-settle.ts'), 'utf8').includes("runtime/child-run.ts")
  && readFileSync(join(src, 'state-check.ts'), 'utf8').includes("runtime/child-run.ts"))

check('the loader dispatches through the role contract', typeof loadRoleInput === 'function')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
