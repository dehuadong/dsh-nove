// The session's current work: memory only, explicit id wins, defaults resolve.
import { clearCurrent, getCurrent, resolveWork, setCurrent } from '../src/current.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

setCurrent('s1', 'book-a')
check('recorded per session', getCurrent('s1') === 'book-a')
check('other sessions stay empty', getCurrent('s2') === undefined)
check('resolve prefers the explicit id', resolveWork('s1', 'book-b') === 'book-b')
check('resolve falls back to the session', resolveWork('s1', undefined) === 'book-a')
check('blank explicit id falls back', resolveWork('s1', '  ') === 'book-a')
check('no source resolves to undefined', resolveWork('s3', undefined) === undefined)
clearCurrent('s1')
check('clear forgets the session', getCurrent('s1') === undefined)
setCurrent(undefined, 'book-a')
check('missing session is ignored', getCurrent(undefined) === undefined)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
