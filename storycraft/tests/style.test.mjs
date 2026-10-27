// Style sampling: pure metrics/block merge plus current-revision extraction.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { assembleBrief, extractStyleSamples, readBible, writeBible } from '../src/bible.ts'
import { mergeBlock, styleBlock, styleProfile, stripBlock, STYLE_END, STYLE_START } from '../src/style.ts'
import { openWork } from '../src/db.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const paragraph = `这是用于测试文风抽样的段落。${'句子。'.repeat(18)}`
const profile = styleProfile([
  { number: 1, body: `${paragraph}\n\n${paragraph.replaceAll('这是', '那是')}` },
  { number: 2, body: `${paragraph}\n\n${paragraph.replaceAll('这是', '另一')}` },
  { number: 3, body: `${paragraph}\n\n${paragraph.replaceAll('这是', '第三')}` },
])
check('profile reports sentence metrics', profile.metrics.sentences > 0 && profile.metrics.paragraphs === 6
  && profile.metrics.dialogueRatio === 0, JSON.stringify(profile.metrics))
check('style profile exposes metrics and sample shapes', typeof profile.metrics.avgSentence === 'number'
  && Array.isArray(profile.samples)
  && profile.samples.every(sample => typeof sample.chapter === 'number' && typeof sample.text === 'string'),
JSON.stringify(profile.metrics))
check('samples are 120–240 characters and at most 3', profile.samples.length === 3
  && profile.samples.every(sample => [...sample.text].length >= 120 && [...sample.text].length <= 240),
JSON.stringify(profile.samples.map(sample => [...sample.text].length)))
check('samples prefer different chapters', new Set(profile.samples.map(sample => sample.chapter)).size === 3)
const boundary = styleProfile([{ number: 1, body: `${'甲'.repeat(119)}\n\n${'乙'.repeat(120)}` }])
check('joined newlines count toward the 240 limit', boundary.samples.every(sample => [...sample.text].length <= 240),
  JSON.stringify(boundary.samples.map(sample => [...sample.text].length)))
const tail = styleProfile([{ number: 1, body: `${'甲'.repeat(118)}\n\n${'乙'.repeat(118)}\n\n${'丙'.repeat(2)}` }])
check('tail merge counts its separator', tail.samples.every(sample => [...sample.text].length <= 240),
  JSON.stringify(tail.samples.map(sample => [...sample.text].length)))

const block = styleBlock(profile.metrics, profile.samples)
const author = '# 作者文风\n\n短句，克制。'
const merged = mergeBlock(author, block)
check('merge keeps author text and one managed block', merged.startsWith(author) && merged.includes(STYLE_START)
  && merged.split(STYLE_START).length === 2 && merged.trimEnd().endsWith(STYLE_END))
const repeated = mergeBlock(merged, block)
check('merge replaces an existing block idempotently', repeated === merged)
check('strip removes duplicate and unclosed blocks', stripBlock(`${author}\n\n${block}\n\n${block}`) === author
  && stripBlock(`${author}\n\n${STYLE_START}\ntruncated`) === author)

const root = await mkdtemp(join(tmpdir(), 'storycraft-style-'))
try {
  const work = (await s.initWork(root, { title: '文风测试' })).workId
  await s.writeOutline(root, { work, mainline: '一条线' })
  await s.approveOutline(root, { work })
  for (const number of [1, 2, 3]) {
    await s.writePlan(root, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work, chapter: number })
    await s.writeChapter(root, {
      work,
      chapter: number,
      body: `${paragraph.replaceAll('这是', `第${number}章`)}\n\n${paragraph.replaceAll('这是', `续${number}`)}`,
    })
  }
  await writeBible(root, work, 'style', author)
  const first = await extractStyleSamples(root, work)
  const style = (await readBible(root, work, 'style')).files[0]
  check('extract writes samples into style', first.sampleCount === 3 && first.sampleChars > 0
    && style.content.startsWith(author) && style.content.includes(STYLE_START), JSON.stringify(first))
  check('version is the content hash', style.version === first.version)
  const second = await extractStyleSamples(root, work)
  check('repeat extraction is byte-identical', second.version === first.version, `${first.version} ${second.version}`)
  await s.writeChapter(root, { work, chapter: 1, body: `改后的正文。${'另一句。'.repeat(80)}`, rewrite: true })
  const changed = await extractStyleSamples(root, work)
  check('changed body changes the version', changed.version !== first.version, `${first.version} ${changed.version}`)
  const changedStyle = (await readBible(root, work, 'style')).files[0].content
  check('author text survives re-extraction', changedStyle.startsWith(author), changedStyle.slice(0, 60))
  check('old revision is not sampled after rewrite', !changedStyle.includes('第1章用于测试'), changedStyle.slice(0, 300))
  const brief = await assembleBrief(root, work, 3)
  const styleSection = brief.sections.find(section => section.name === 'style')
  check('brief style contains the managed block', String(styleSection?.content).includes(STYLE_START)
    && String(styleSection?.content).includes('样例 1'), JSON.stringify(styleSection))

  const empty = await s.initWork(root, { title: '无正文' })
  let noSource
  try {
    await extractStyleSamples(root, empty.workId)
  } catch (error) {
    noSource = error.code
  }
  check('no bodies is style-no-source', noSource === 'style-no-source', String(noSource))

  const missing = openWork(root, work)
  missing.prepare("DELETE FROM artifacts WHERE artifact_id = 'bible:style'").run()
  missing.close()
  let missingStyle
  try {
    await extractStyleSamples(root, work)
  } catch (error) {
    missingStyle = error.code
  }
  check('missing style is bible-missing', missingStyle === 'bible-missing', String(missingStyle))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
