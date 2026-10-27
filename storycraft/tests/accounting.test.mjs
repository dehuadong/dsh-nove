// Token accounting: the one estimator every budget in this package uses.
import { BUDGET_UNIT, accountOf, estimateTokens, sumAccounts } from '../src/accounting.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

check('the package speaks tokens', BUDGET_UNIT === 'tokens')
check('empty text has no size', estimateTokens('') === 0 && accountOf('').chars === 0 && accountOf('').tokens === 0)
check('cjk counts one token per character', estimateTokens('雨里的灯') === 4, String(estimateTokens('雨里的灯')))
check('ascii counts one token per four characters', estimateTokens('abcdefgh') === 2, String(estimateTokens('abcdefgh')))
check('a partial ascii group still counts', estimateTokens('abcde') === 2, String(estimateTokens('abcde')))
check('mixed text adds both halves', estimateTokens('雨a') === 2, String(estimateTokens('雨a')))
check('account keeps characters beside tokens',
  accountOf('雨里的灯').chars === 4 && accountOf('雨里的灯').tokens === 4,
  JSON.stringify(accountOf('雨里的灯')))
check('sums add both units',
  JSON.stringify(sumAccounts([accountOf('雨'), accountOf('abcd')])) === JSON.stringify({ chars: 5, tokens: 2 }),
  JSON.stringify(sumAccounts([accountOf('雨'), accountOf('abcd')])))

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('\nALL CHECKS PASSED')
}
