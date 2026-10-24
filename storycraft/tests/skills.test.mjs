// The work mode mounts one skill row that serves every form and every role.
import { apply } from '../skills.js'
import { FORM_META, planApprovalPolicy } from '../dist/domain.js'
import { ROLE_META, writerSkills } from '../dist/delegate.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function mount(mode) {
  let provider
  const warnings = []
  const ctx = {
    skills: { registerProvider: factory => { provider = factory(); return () => {} } },
    effect: register => { register(); },
    logger: { warn: message => warnings.push(message) },
  }
  apply(ctx, { mode })
  return { provider, warnings }
}

const all = mount('all')
const names = (await all.provider.list()).map(skill => skill.name)
check('all serves every form, every role, the shared catalog, the shared methods and the state tools', names.length === 15, names.join(','))
check('the orchestration skill is shared', names.includes('storycraft-studio-orchestration'))
check('long form skill present', names.includes('storycraft-longform-chapter'))
check('long form method present', names.includes('storycraft-longform-method'))
check('shared long-form method present', names.includes('storycraft-long-writing'))
check('shared short-form method present', names.includes('storycraft-short-writing'))
check('shared script method present', names.includes('storycraft-script-writing'))
check('state check skill present', names.includes('storycraft-state-check'))
check('state settler skill present', names.includes('storycraft-state-settler'))
check('short form skill present', names.includes('storycraft-short-story'))
check('script skill present', names.includes('storycraft-short-drama'))
check('every role craft is reachable from the work mode',
  ['storycraft-write-craft', 'storycraft-review', 'storycraft-revise-craft', 'storycraft-plan-craft', 'storycraft-architect'].every(name => names.includes(name)),
  names.join(','))
check('no warning for all', all.warnings.length === 0, all.warnings.join('; '))
const routed = [...Object.values(ROLE_META).map(meta => meta.skill), ...Object.values(FORM_META).map(meta => meta.skill)].filter(Boolean)
check('every routed role/form skill is mounted', routed.every(name => names.includes(name)), routed.join(','))
check('writerSkills dedupes longform and adds short/script skills', writerSkills('longform').length === 1 && writerSkills('short').length === 2 && writerSkills('script').length === 2)
check('plan approval defaults to required and honors off', planApprovalPolicy({}) === 'required' && planApprovalPolicy({ planApproval: 'off' }) === 'off')
try {
  planApprovalPolicy(undefined)
  check('plan approval requires a manifest', false, 'did not throw')
} catch (error) {
  check('plan approval requires a manifest', error instanceof TypeError, String(error))
}

const write = mount('write')
const writeNames = (await write.provider.list()).map(skill => skill.name)
check('the writing catalog holds the craft skill', writeNames.length === 1 && writeNames[0] === 'storycraft-write-craft', writeNames.join(','))

const revise = mount('revise')
const reviseNames = (await revise.provider.list()).map(skill => skill.name)
check('the revise catalog holds the revise skill', reviseNames.length === 1 && reviseNames[0] === 'storycraft-revise-craft', reviseNames.join(','))

const plan = mount('plan')
const planNames = (await plan.provider.list()).map(skill => skill.name)
check('the plan catalog holds the planning skill', planNames.length === 1 && planNames[0] === 'storycraft-plan-craft', planNames.join(','))

const review = mount('review')
const reviewNames = (await review.provider.list()).map(skill => skill.name)
check('the review catalog holds review, state-check and state-settler skills',
  reviewNames.length === 3 && reviewNames.includes('storycraft-review')
  && reviewNames.includes('storycraft-state-check') && reviewNames.includes('storycraft-state-settler'),
  reviewNames.join(','))

const one = mount('longform')
const oneNames = (await one.provider.list()).map(skill => skill.name)
check('one form serves its flow, legacy alias and shared method',
  oneNames.length === 4 && oneNames.includes('storycraft-architect') && oneNames.includes('storycraft-longform-chapter')
  && oneNames.includes('storycraft-longform-method') && oneNames.includes('storycraft-long-writing'),
  oneNames.join(','))

const short = mount('shortform')
const shortNames = (await short.provider.list()).map(skill => skill.name)
check('short form serves its contract and shared method',
  shortNames.length === 2 && shortNames.includes('storycraft-short-story') && shortNames.includes('storycraft-short-writing'),
  shortNames.join(','))

const screenplay = mount('screenplay')
const screenplayNames = (await screenplay.provider.list()).map(skill => skill.name)
check('screenplay serves its contract and shared method',
  screenplayNames.length === 2 && screenplayNames.includes('storycraft-short-drama')
  && screenplayNames.includes('storycraft-script-writing'),
  screenplayNames.join(','))

const bad = mount('novella')
check('unknown mode warns and serves nothing', bad.warnings.length === 1, bad.warnings.join('; '))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
