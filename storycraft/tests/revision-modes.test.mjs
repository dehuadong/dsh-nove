// Revision mode vocabulary: source names plus the two legacy aliases.
import { assertRevisionMode, canonicalReviseMode } from '../src/revision.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function codeOf(fn) {
  try {
    fn()
    return 'none'
  } catch (error) {
    return error?.code ?? String(error)
  }
}

check('patch aliases spot-fix', canonicalReviseMode('patch') === 'spot-fix', canonicalReviseMode('patch'))
check('deslop aliases anti-detect', canonicalReviseMode('deslop') === 'anti-detect', canonicalReviseMode('deslop'))
for (const mode of ['polish', 'rewrite', 'rework', 'anti-detect', 'spot-fix']) {
  check(`accepts ${mode}`, codeOf(() => assertRevisionMode({ mode, chapter: 1, oldBody: '甲乙丙。', body: '甲乙丙。' })) === 'none')
}
check('unknown mode is refused', codeOf(() => canonicalReviseMode('freestyle')) === 'revise-mode-violation')
check('rework keeps its own vocabulary', canonicalReviseMode('rework') === 'rework')

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
