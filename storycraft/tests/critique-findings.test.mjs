// Findings layer: mechanical results with stable codes, derived from the metrics.
import { critique, findingsOf } from '../src/critique.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const short = findingsOf('太短。', critique('太短。', { min: 50, max: 100 }))
check('short text reports word-range', short.some(finding => finding.code === 'word-range'), JSON.stringify(short))

const long = '他把门关上以后，院子里的雨声就慢慢小了下来。'.repeat(3)
const repeated = findingsOf(long, critique(long))
check('a repeated sentence reports itself',
  repeated.some(finding => finding.code === 'repeated-sentence'), JSON.stringify(repeated))

const ai = findingsOf('他仿佛听见门外有人走过。', critique('他仿佛听见门外有人走过。'))
check('an AI phrase reports with its quote',
  ai.some(finding => finding.code === 'ai-phrase'), JSON.stringify(ai))

const person = findingsOf('雨停了。', critique('雨停了。', undefined), '沈砚')
check('a missing perspective character reports itself',
  person.some(finding => finding.code === 'person-consistency'), JSON.stringify(person))

check('every finding carries a known severity',
  [...short, ...repeated, ...ai, ...person].every(finding => ['blocking', 'major', 'minor'].includes(finding.severity)),
  JSON.stringify([...short, ...repeated, ...ai, ...person].map(finding => finding.severity)))

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
