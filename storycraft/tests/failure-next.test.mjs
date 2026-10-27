// Failure receipts carry the next step, so callers do not parse prose.
import { StoryError } from '../src/domain.ts'
import { failureOf } from '../src/tools.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const coded = failureOf(new StoryError('plan-not-approved', '章纲没确认', '请作者在面板确认章纲'))
check('a coded failure keeps its code and message',
  coded.ok === false && coded.error.code === 'plan-not-approved' && coded.error.message === '章纲没确认',
  JSON.stringify(coded.error))
check('a coded failure carries next when the thrower supplied it',
  coded.error.next === '请作者在面板确认章纲', JSON.stringify(coded.error))

const bare = failureOf(new StoryError('empty-state', '没有可写入的变化'))
check('next is absent when the thrower did not supply it', !('next' in bare.error), JSON.stringify(bare.error))

const retryable = failureOf(new StoryError('delegation-no-submission', '没收到提交', undefined, true))
check('a retryable failure says so', retryable.error.retryable === true, JSON.stringify(retryable.error))
check('retryable is absent when not set', !('retryable' in coded.error), JSON.stringify(coded.error))

const unknown = failureOf(new Error('boom'))
check('an unknown error is internal and has no next',
  unknown.error.code === 'internal' && !('next' in unknown.error), JSON.stringify(unknown.error))

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
