// Fact whitelist: derived from landed files only, shared by every consumer.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { deriveWhitelist, summariseWhitelist } from '../facts.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-facts-'))
try {
  const work = (await s.initWork(root, { title: '白名单测试' })).workId
  await s.writeOutline(root, { work, mainline: '一条主线', volumes: '第一卷：从白草滩到黑水滩' })
  await s.approveOutline(root, { work })
  await s.writePlan(root, { work, chapter: 1, perspective: '周观', goal: '把墙立起来，用到十六口人和七尺的料', obstacle: 'o', cost: 'c', turn: 't' })
  await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '周观', role: '主视角', want: '立墙', fear: '塌方', limit: '不拿人命换速度', voice: '短句' },
  ]))
  await writeFile(join(root, 'works', work, 'bible', 'intent.md'), '# 意图\n故事发生在白草滩。\n', 'utf8')

  // A secondary character introduced in an earlier chapter is established even
  // when there is no character card for him.
  await s.writePlan(root, { work, chapter: 2, perspective: '周观', goal: 'g2', obstacle: 'o', cost: 'c', turn: 't' })
  await s.writeChapter(root, { work, chapter: 1, body: '阿六道：“我去提水。”'.repeat(20) })
  await b.writeSummary(root, work, 1, '阿六去提水。')

  const whitelist = await deriveWhitelist(root, { work, chapter: 2 })
  check('earlier chapters establish secondary names', whitelist.names.includes('阿六'), whitelist.names.join(','))

  const firstChapter = await deriveWhitelist(root, { work, chapter: 1 })
  check('names come from the character cards', firstChapter.names.includes('周观'), firstChapter.names.join(','))
  check('places come from the intent file', firstChapter.places.includes('白草滩'), whitelist.places.join(','))
  check('places come from the volume text', firstChapter.places.includes('黑水滩'), whitelist.places.join(','))
  check('numbers keep the Chinese spelling', firstChapter.numbers.includes('十六') && firstChapter.numbers.includes('七'), firstChapter.numbers.join(','))
  check('numbers also carry digits', firstChapter.numbers.includes('16') && firstChapter.numbers.includes('7'), firstChapter.numbers.join(','))

  const summary = summariseWhitelist(firstChapter)
  check('summary exposes counts', summary.counts.names === 1 && summary.counts.places >= 2, JSON.stringify(summary))
  check('summary exposes only samples', summary.sample.names.length <= 5 && summary.sample.numbers.length <= 5, JSON.stringify(summary.sample))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
