// Consistency checks between a writer output and the context whitelist.
import { checkConsistency } from '../consistency.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const whitelist = { names: ['周观', '韩松'], places: ['白草滩'], numbers: ['七尺', '十六'] }

const clean = checkConsistency({
  body: '周观说：“今晚挪人。”\n韩松问：“几尺？”\n周观答：“七尺。”\n十六口人进了白草滩。',
  whitelist,
})
check('known speakers pass', clean.unknownNames.length === 0, clean.unknownNames.join(','))
check('known places pass', clean.unknownPlaces.length === 0, clean.unknownPlaces.join(','))
check('no warnings on a clean body', clean.warnings.length === 0, clean.warnings.join(';'))

const invented = checkConsistency({
  body: '周三说：“走。”\n李四点头：“好。”',
  whitelist,
})
check('invented speakers are flagged', invented.unknownNames.includes('周三') && invented.unknownNames.includes('李四'), invented.unknownNames.join(','))

const unknownPlace = checkConsistency({ body: '队伍开往黑水滩。', whitelist })
check('unknown places warn', unknownPlace.unknownPlaces.includes('黑水滩') && unknownPlace.warnings.length === 1, unknownPlace.warnings.join(';'))

const unknownSize = checkConsistency({ body: '墙高一丈二。', whitelist })
check('unknown measurements warn', unknownSize.unknownNumbers.includes('1丈'), unknownSize.unknownNumbers.join(','))
check('known measurements pass', checkConsistency({ body: '墙高七尺。', whitelist }).unknownNumbers.length === 0)

// The live failure: prose ran through the old window heuristic as "names".
const prose = checkConsistency({
  body: '他道：“走。”\n她道：“等。”\n书吏道：“画。”\n绳上有一道印。',
  whitelist,
})
check('prose is not a new name', prose.unknownNames.length === 0, prose.unknownNames.join(','))

const namedWithNumber = checkConsistency({ body: '郑三道：“再量一遍。”', whitelist })
check('a surname with a number is still a name', namedWithNumber.unknownNames.includes('郑三'), namedWithNumber.unknownNames.join(','))

const verboseAttribution = checkConsistency({
  body: '周观冷笑道：“挪。”\n韩松低声道：“量。”',
  whitelist,
})
check('verb-laden attribution is not a new name', verboseAttribution.unknownNames.length === 0, verboseAttribution.unknownNames.join(','))

const numberWords = checkConsistency({ body: '三个时辰，七尺高。', whitelist: { ...whitelist, numbers: ['3', '7尺'] } })
check('number spellings match across Chinese and digits', numberWords.unknownNumbers.length === 0, numberWords.unknownNumbers.join(','))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
