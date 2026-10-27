// The work mode mounts one skill row that serves every form and every role.
import { apply } from '../src/skills.ts'
import { FORM_META, planApprovalPolicy } from '../src/domain.ts'
import { ROLE_META, writerSkills } from '../src/delegate.ts'

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
check('all serves every form, every role, the shared catalog, the shared methods and the state tools', names.length === 18, names.join(','))
check('the studio entry skill is shared', names.includes('storycraft-studio-entry'))
check('the long-form director is mounted', names.includes('storycraft-long-director'))
check('long form skill present', names.includes('storycraft-longform-chapter'))
check('long stage skills present', ['storycraft-long-foundation', 'storycraft-long-plan', 'storycraft-long-prose', 'storycraft-long-settle'].every(name => names.includes(name)))
check('short stage skills present', names.includes('storycraft-short-outline') && names.includes('storycraft-short-prose'))
check('script stage skills present', names.includes('storycraft-script-spec') && names.includes('storycraft-script-scene'))
check('state check skill present', names.includes('storycraft-state-check'))
check('state settler skill present', names.includes('storycraft-state-settler'))
check('short form skill present', names.includes('storycraft-short-story'))
check('script skill present', names.includes('storycraft-short-drama'))
check('every role and form craft is reachable from the work mode',
  ['storycraft-long-prose', 'storycraft-short-prose', 'storycraft-script-scene',
    'storycraft-review', 'storycraft-revise-craft', 'storycraft-architect'].every(name => names.includes(name)),
  names.join(','))
check('no warning for all', all.warnings.length === 0, all.warnings.join('; '))
const routed = [...Object.values(ROLE_META).map(meta => meta.skill), ...Object.values(FORM_META).map(meta => meta.skill)].filter(Boolean)
check('every routed role/form skill is mounted', routed.every(name => names.includes(name)), routed.join(','))
check('writerSkills loads only the form craft',
  writerSkills('longform').join() === 'storycraft-long-prose'
  && writerSkills('short').join() === 'storycraft-short-prose'
  && writerSkills('script').join() === 'storycraft-script-scene')
check('plan approval defaults to required and honors off', planApprovalPolicy({}) === 'required' && planApprovalPolicy({ planApproval: 'off' }) === 'off')
try {
  planApprovalPolicy(undefined)
  check('plan approval requires a manifest', false, 'did not throw')
} catch (error) {
  check('plan approval requires a manifest', error instanceof TypeError, String(error))
}

const revise = mount('revise')
const reviseNames = (await revise.provider.list()).map(skill => skill.name)
check('the revise catalog holds the revise skill', reviseNames.length === 1 && reviseNames[0] === 'storycraft-revise-craft', reviseNames.join(','))

const review = mount('review')
const reviewNames = (await review.provider.list()).map(skill => skill.name)
check('the review catalog holds review, state-check and state-settler skills',
  reviewNames.length === 3 && reviewNames.includes('storycraft-review')
  && reviewNames.includes('storycraft-state-check') && reviewNames.includes('storycraft-state-settler'),
  reviewNames.join(','))

const one = mount('longform')
const oneNames = (await one.provider.list()).map(skill => skill.name)
check('one form serves its flow and stage skills',
  oneNames.length === 7 && oneNames.includes('storycraft-architect') && oneNames.includes('storycraft-longform-chapter')
  && oneNames.includes('storycraft-long-prose') && oneNames.includes('storycraft-long-plan')
  && oneNames.includes('storycraft-long-director'),
  oneNames.join(','))

const short = mount('shortform')
const shortNames = (await short.provider.list()).map(skill => skill.name)
check('short form serves its contract and shared method',
  shortNames.length === 3 && shortNames.includes('storycraft-short-story') && shortNames.includes('storycraft-short-prose'),
  shortNames.join(','))

const screenplay = mount('screenplay')
const screenplayNames = (await screenplay.provider.list()).map(skill => skill.name)
check('screenplay serves its contract and stage skills',
  screenplayNames.length === 3 && screenplayNames.includes('storycraft-short-drama')
  && screenplayNames.includes('storycraft-script-scene'),
  screenplayNames.join(','))

const bad = mount('novella')
check('unknown mode warns and serves nothing', bad.warnings.length === 1, bad.warnings.join('; '))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
