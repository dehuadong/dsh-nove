// Truth files, summaries, and the pre-write brief.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function rejects(name, code, fn) {
  try {
    await fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-bible-'))
try {
  // A fresh work ships the five truth files.
  await s.initWork(root, { title: '潮汐记事' })
  const work = '潮汐记事'
  for (const file of ['world.md', 'characters.json', 'style.md', 'plan.md', 'intent.md']) {
    check(`init creates bible/${file}`, (await stat(join(root, 'works', work, 'bible', file))).isFile())
  }
  const initial = await b.readBible(root, work)
  check('readBible returns five draft files', initial.files.length === 5 && initial.files.every(file => file.draft === false || file.draft === true))

  // Character-sheet validation, and no clobber on failure.
  await rejects('characters must be an array', 'bible-invalid', () => b.writeBible(root, work, 'characters', '{"name":"x"}'))
  await rejects('characters need every field', 'bible-invalid', () => b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '林澈', role: '主角', want: '拿回合同', fear: '失去妹妹', limit: '不伤人' },
  ])))
  const before = (await b.readBible(root, work, 'characters')).files[0].version
  await rejects('duplicate names refused', 'bible-invalid', () => b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '林澈', role: 'a', want: 'b', fear: 'c', limit: 'd', voice: 'e' },
    { name: '林澈', role: 'a', want: 'b', fear: 'c', limit: 'd', voice: 'e' },
  ])))
  check('failed write keeps version', (await b.readBible(root, work, 'characters')).files[0].version === before)

  const written = await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '林澈', role: '主角', want: '拿回合同', fear: '失去妹妹', limit: '不伤人', voice: '短句、克制' },
  ], null, 2))
  check('valid characters accepted', typeof written.version === 'string' && written.version.length === 12)
  check('version advances', written.version !== before)

  await b.writeBible(root, work, 'world', '# 世界观\n\n荒原上以前有过城与人。\n')
  await b.writeBible(root, work, 'style', '# 文风基准\n\n第三人称、短句、少形容词。\n')
  await b.writeBible(root, work, 'intent', '# 作者意图\n\n写工程队如何在荒原立国。\n')
  await b.writeBible(root, work, 'plan', '# 写作计划\n\n第一章塌方，第二章找水。\n')

  // Plan + chapter + summary.
  await s.writePlan(root, { work, chapter: 1, perspective: '林澈', goal: '救人', obstacle: '塌方', cost: '设备受损', turn: '决定北上' })
  const body = '他在雨里站了很久。'.repeat(40)
  await s.writeChapter(root, { work, chapter: 1, title: '塌方', body })
  await rejects('summary needs a body', 'body-not-found', () => b.writeSummary(root, work, 2, '摘要'))

  const long = '甲'.repeat(520)
  const receipt = await b.writeSummary(root, work, 1, long)
  check('summary truncates at 400', receipt.truncated === true)
  const summary = await b.readSummary(root, work, 1)
  check('summary length capped', [...summary.trim()].length === 400, String([...summary.trim()].length))

  // Brief for chapter 2: previous chapter uses the summary.
  await s.writePlan(root, { work, chapter: 2, perspective: '林澈', goal: '找水', obstacle: '荒原', cost: '体力', turn: '发现旧墙' })
  const brief = await b.assembleBrief(root, work, 2)
  const names = brief.sections.map(section => section.name)
  check('brief order', names.join(',') === 'intent,plan,characters,hooks,previous,style,wordPolicy', names.join(','))
  const previous = brief.sections.find(section => section.name === 'previous')
  check('previous uses the summary', previous.source === 'summaries/ch-0001.md' && previous.absent === false, previous.source)
  check('characters matched or fallback', brief.sections.find(section => section.name === 'characters').content.includes('林澈'))

  const again = await b.assembleBrief(root, work, 2)
  check('brief is deterministic', JSON.stringify(brief) === JSON.stringify(again))

  // Chapter 1 has no previous section.
  const first = await b.assembleBrief(root, work, 1)
  check('chapter 1 previous absent', first.sections.find(section => section.name === 'previous').absent === true)

  // Budget trimming drops the lowest-priority sections first.
  await b.writeBible(root, work, 'style', `# 文风基准\n\n${'长'.repeat(9000)}`)
  const trimmed = await b.assembleBrief(root, work, 2)
  check('budget trims sections', trimmed.dropped.some(item => item.name === 'style') || trimmed.dropped.some(item => item.name === 'wordPolicy'), JSON.stringify(trimmed.dropped))
  check('budget reports usage', trimmed.budget.used <= trimmed.budget.limit || trimmed.budget.overBudget === true, JSON.stringify(trimmed.budget))

  // Missing truth is an error, not an invented section.
  await rm(join(root, 'works', work, 'bible', 'style.md'))
  await rejects('missing truth refuses a brief', 'bible-missing', () => b.assembleBrief(root, work, 1))
  await rejects('unknown chapter refused', 'chapter-not-found', () => b.assembleBrief(root, work, 9))

  // Import from an older work's design/ folder.
  const older = await s.initWork(root, { title: '旧作' })
  const olderDir = join(root, 'works', older.workId)
  await mkdir(join(olderDir, 'design'), { recursive: true })
  await writeFile(join(olderDir, 'design', 'world.md'), '# 世界观\n\n旧稿的世界。\n')
  await writeFile(join(olderDir, 'design', 'outline.md'), '# 大纲\n\n第一章：开局。\n')
  await writeFile(join(olderDir, 'design', 'cast.md'), '# 人物\n\n## 沈彻\n## 齐大山\n')
  const report = await b.importBible(root, older.workId)
  check('import copies world and plan', report.imported.length === 2, JSON.stringify(report.imported))
  check('import extracts names', report.names.join(',') === '沈彻,齐大山', report.names.join(','))
  check('import reports pending', report.pending.some(item => item.includes('characters')))
  const imported = await readFile(join(olderDir, 'bible', 'world.md'), 'utf8')
  check('imported content landed', imported.includes('旧稿的世界'))
  check('import never fabricates characters', (await readFile(join(olderDir, 'bible', 'characters.json'), 'utf8')).trim() === '[]')
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
