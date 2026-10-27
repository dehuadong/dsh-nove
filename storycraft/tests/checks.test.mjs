// Deterministic checks: stable codes, fixed severities, no taste.
import { checkChapter } from '../src/checks.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const codes = findings => findings.map(finding => finding.code).sort()

const long = [
  '他把门关上，雨声小了。',
  '院里的灯闪了两下，他抬头看了一眼。',
  '“谁在外面？”他压低声音问。',
  '没有人回答，只有风从窗缝里钻进来。',
  '他摸到桌上的钥匙，手心全是汗。',
  '门外传来脚步，停在台阶下面。',
  '他数着自己的呼吸，一直数到第七下。',
  '灯又闪了一次，这次彻底灭了。',
  '“我数三下，你最好自己走。”他说。',
  '外面的脚步没有动，反而更近了。',
  '他退到墙角，把钥匙攥进掌心。',
  '雨声忽然大起来，盖住了一切。',
].join('')
const clean = checkChapter({ text: long, perspective: '他' })
check('a clean chapter reports nothing mechanical', clean.length === 0, JSON.stringify(clean))

const short = checkChapter({ text: '太短。', wordRange: { min: 50, max: 100 } })
check('a short chapter reports word-range', codes(short).includes('word-range'), JSON.stringify(short))

const tooLong = checkChapter({ text: long, wordRange: { min: 10, max: 40 } })
check('an overlong chapter reports word-range', codes(tooLong).includes('word-range'), JSON.stringify(tooLong))

const repeated = checkChapter({ text: '他推开门，雨声进来了。他推开门，雨声进来了。' })
check('a repeated sentence reports itself', codes(repeated).includes('repeated-sentence'), JSON.stringify(repeated))

const ai = checkChapter({ text: `${long}值得注意的是，他走了。` })
check('an AI phrase is reported with its quote',
  ai.some(finding => finding.code === 'ai-phrase' && finding.quote === '值得注意的是'), JSON.stringify(ai))

const missingPerson = checkChapter({ text: long, perspective: '沈砚' })
check('a perspective character never on the page is reported',
  missingPerson.some(finding => finding.code === 'person-consistency'), JSON.stringify(missingPerson))

const noDialogue = checkChapter({ text: '他把门关上，雨声小了。院里的灯闪了两下，他抬头看了一眼。没有人回答，只有风从窗缝里钻进来。' })
check('a chapter with almost no dialogue reports the ratio', codes(noDialogue).includes('dialogue-ratio'), JSON.stringify(noDialogue))

check('every finding carries a known severity',
  [...short, ...repeated, ...ai, ...missingPerson].every(finding => ['blocking', 'major', 'minor'].includes(finding.severity)),
  JSON.stringify([...short, ...repeated, ...ai, ...missingPerson].map(finding => finding.severity)))

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
