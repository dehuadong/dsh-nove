// The studio preset mounts one skill row that serves every form.
import { apply } from '../skills.js'

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
check('all serves every form', names.length === 3, names.join(','))
check('long form skill present', names.includes('storycraft-longform-chapter'))
check('short form skill present', names.includes('storycraft-short-story'))
check('script skill present', names.includes('storycraft-short-drama'))
check('no warning for all', all.warnings.length === 0, all.warnings.join('; '))

const one = mount('longform')
check('one form serves one catalog', (await one.provider.list()).length === 1)

const bad = mount('novella')
check('unknown mode warns and serves nothing', bad.warnings.length === 1, bad.warnings.join('; '))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
