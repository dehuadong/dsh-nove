// Deterministic polish rules: mechanical changes only, all recorded, idempotent.
import { applyPolishRules, BANNED_OPENERS } from '../src/polish-rules.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const sample = '值得注意的是，他推开门。天很黑……真的黑了......走了！！！屋里  很静。'
const first = applyPolishRules(sample)

check('the opening phrase is removed and recorded',
  !first.text.startsWith('值得注意的是') && first.text.startsWith('他推开门'),
  first.text)
check('the opener change is recorded', first.changes.some(change => change.kind === 'opener'), JSON.stringify(first.changes))
check('every ellipsis style becomes one form', !first.text.includes('......') && first.text.includes('……'), first.text)
check('repeated punctuation collapses', !first.text.includes('！！！'), first.text)
check('runs of spaces collapse', !first.text.includes('  '), first.text)

const second = applyPolishRules(first.text)
check('a second pass changes nothing', second.changes.length === 0, JSON.stringify(second.changes))
check('a second pass returns the same text', second.text === first.text)

const clean = '他把门关上，雨声小了。'
const untouched = applyPolishRules(clean)
check('clean prose is left alone', untouched.text === clean && untouched.changes.length === 0, JSON.stringify(untouched.changes))

check('the banned opener list is exported for the prompt', BANNED_OPENERS.length >= 4)

// The rules must not touch a phrase that merely contains an opener mid-sentence.
const midSentence = '他说，综上所述并不可靠。'
const mid = applyPolishRules(midSentence)
check('an opener mid-sentence is left to the reviser', mid.text === midSentence, mid.text)

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
