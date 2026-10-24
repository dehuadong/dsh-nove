// Truth files, summaries, and the pre-write brief.
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { openWork } from '../db.js'

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
const exists = path => stat(path).then(() => true).catch(() => false)

const root = await mkdtemp(join(tmpdir(), 'storycraft-bible-'))
try {
  // A fresh work ships the five truth entries inside its database.
  await s.initWork(root, { title: '潮汐记事' })
  const work = '潮汐记事'
  const initial = await b.readBible(root, work)
  check('init creates five truth entries', initial.files.length === 5, initial.files.map(file => file.name).join(','))
  check('truth paths are virtual', initial.files.every(file => file.path === `works/${work}/outline/plan.md` || file.path.startsWith(`works/${work}/bible/`)), initial.files[0].path)
  check('truth content is not a file on disk', await exists(join(root, 'works', work, 'bible', 'world.md')) === false)

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
  s.writeOutline(root, { work, mainline: '第一章塌方，第二章找水。' })

  // Plan + chapter + summary.
  await s.writePlan(root, { work, chapter: 1, perspective: '林澈', goal: '救人', obstacle: '塌方', cost: '设备受损', turn: '决定北上' })
  await s.approveChapterPlan(root, { work, chapter: 1 })
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
  check('brief order', names.join(',') === 'intent,storyFrame,bookRules,plan,currentFocus,characters,hooks,volumeMap,volumeSummary,recentSummaries,previous,style,wordPolicy', names.join(','))
  const previous = brief.sections.find(section => section.name === 'previous')
  check('previous uses the summary', previous.source === `works/${work}/summaries/ch-0001.md` && previous.absent === false, previous.source)
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

  // B4: material is a supplement for a work with at least three written chapters.
  const b4 = (await s.initWork(root, { title: '素材装配' })).workId
  await b.writeBible(root, b4, 'world', '# 世界观\n\n荒原。\n')
  await b.writeBible(root, b4, 'style', '# 文风\n\n短句。\n')
  await b.writeBible(root, b4, 'intent', '# 意图\n\n找旧井。\n')
  s.writeOutline(root, { work: b4, mainline: '三章。' })
  await b.writeBible(root, b4, 'characters', '[]')
  for (const number of [1, 2, 3]) {
    await s.writePlan(root, { work: b4, chapter: number, perspective: '甲', goal: number === 3 ? '找旧井' : 'g', obstacle: 'o', cost: 'c', turn: 't' })
    await s.approveChapterPlan(root, { work: b4, chapter: number })
    await s.writeChapter(root, { work: b4, chapter: number, body: '正文。'.repeat(30) })
    if (number === 2) {
      const early = await b.assembleBrief(root, b4, 2)
      check('brief retrieval is off before three written chapters', early.retrieval.enabled === false
        && !early.sections.some(section => section.name === 'retrieval'), JSON.stringify(early.retrieval))
    }
  }
  const baseline = await b.assembleBrief(root, b4, 3)
  const material = await s.importMaterial(root, b4, {
    name: '旧井参考.md',
    title: '旧井参考',
    purpose: 'setting',
    contentBase64: Buffer.from('旧井边的作者参考资料。'.repeat(30), 'utf8').toString('base64'),
  })
  const extraOne = await s.importMaterial(root, b4, {
    name: '旧井参考二.md',
    title: '旧井参考二',
    purpose: 'scene',
    contentBase64: Buffer.from('旧井边的第二份资料。', 'utf8').toString('base64'),
  })
  const extraTwo = await s.importMaterial(root, b4, {
    name: '旧井参考三.md',
    title: '旧井参考三',
    purpose: 'character',
    contentBase64: Buffer.from('旧井边的第三份资料。', 'utf8').toString('base64'),
  })
  const extraThree = await s.importMaterial(root, b4, {
    name: '旧井参考四.md',
    title: '旧井参考四',
    purpose: 'setting',
    contentBase64: Buffer.from('旧井边的第四份资料。', 'utf8').toString('base64'),
  })
  const referenceMaterial = await s.importMaterial(root, b4, {
    name: '旧井参考五.md',
    title: '旧井参考五',
    purpose: 'reference',
    contentBase64: Buffer.from('旧井边的第五份参考资料。', 'utf8').toString('base64'),
  })
  const titleOnly = await s.importMaterial(root, b4, {
    name: '标题独有.md',
    title: '旧井标题独有',
    purpose: 'setting',
    contentBase64: Buffer.from('普通正文，不含标题词。', 'utf8').toString('base64'),
  })
  const withMaterial = await b.assembleBrief(root, b4, 3)
  const retrievalSection = withMaterial.sections.find(section => section.name === 'retrieval')
  check('brief appends material retrieval last', withMaterial.sections.at(-1)?.name === 'retrieval', withMaterial.sections.map(section => section.name).join(','))
  const sentMaterial = withMaterial.retrieval.hits.find(hit => hit.kind === 'material' && hit.sent === true)
  check('brief retrieval carries material ids', withMaterial.retrieval.enabled === true
    && sentMaterial !== undefined && sentMaterial.sourceIds[0]?.startsWith('material:'), JSON.stringify(withMaterial.retrieval))
  check('brief retrieval section has ids and no path', retrievalSection?.sourceIds?.length === 3
    && retrievalSection.sourceIds.every(id => id.startsWith('material:'))
    && retrievalSection.source === undefined && !retrievalSection.content.includes('.storycraft'), JSON.stringify(retrievalSection))
  check('brief retrieval stays bounded', withMaterial.retrieval.chars <= 1200 && withMaterial.budget.used <= 8192,
    JSON.stringify({ chars: withMaterial.retrieval.chars, budget: withMaterial.budget }))
  check('brief retrieval sends exactly three of five eligible materials', withMaterial.retrieval.hits.filter(hit => hit.sent).length === 3,
    JSON.stringify(withMaterial.retrieval.hits))
  check('brief excludes reference material before selection', !withMaterial.retrieval.hits.some(hit => hit.id === `material:${referenceMaterial.material.id}`)
    && withMaterial.retrieval.candidateCount === 5, JSON.stringify(withMaterial.retrieval))
  check('brief retrieves a title-only material candidate', withMaterial.retrieval.hits.some(hit => hit.id === `material:${titleOnly.material.id}`),
    JSON.stringify(withMaterial.retrieval.hits))
  const delta = JSON.stringify(withMaterial).length - JSON.stringify(baseline).length
  check('brief retrieval is deterministic and adds bounded bytes', JSON.stringify(withMaterial) === JSON.stringify(await b.assembleBrief(root, b4, 3))
    && delta > 0 && delta < 4096, `${JSON.stringify(baseline).length}->${JSON.stringify(withMaterial).length}`)
  check('brief section order declares retrieval', b.BRIEF_SECTION_ORDER.at(-1) === 'retrieval', b.BRIEF_SECTION_ORDER.join(','))

  const failed = await b.assembleBrief(root, b4, 3, {
    searchMemory: () => { const error = new Error('busy'); error.code = 'work-busy'; throw error },
  })
  check('brief retrieval fails open', failed.retrieval.enabled === true && failed.retrieval.error === 'work-busy'
    && !failed.sections.some(section => section.name === 'retrieval'), JSON.stringify(failed.retrieval))

  await b.writeBible(root, b4, 'style', `# 文风\n\n${'长'.repeat(9000)}`)
  const trimmedB4 = await b.assembleBrief(root, b4, 3)
  check('budget drops retrieval first', trimmedB4.dropped.some(item => item.name === 'retrieval')
    && trimmedB4.retrieval.hits.every(hit => hit.sent === false), JSON.stringify(trimmedB4.dropped))
  await b.writeBible(root, b4, 'style', '# 文风\n\n短句。\n')

  for (const item of [material, extraOne, extraTwo, extraThree, referenceMaterial, titleOnly]) {
    await s.deleteMaterial(root, b4, item.material.id)
  }
  const deleted = await b.assembleBrief(root, b4, 3)
  check('deleted material disappears from the brief', !deleted.sections.some(section => section.name === 'retrieval')
    && deleted.retrieval.candidateCount === 0, JSON.stringify(deleted.retrieval))
  const unrelated = await s.importMaterial(root, b4, {
    name: '无关.md',
    title: '无关',
    contentBase64: Buffer.from('完全无关的参考。', 'utf8').toString('base64'),
  })
  const noMatch = await b.assembleBrief(root, b4, 3)
  check('unmatched material is not pushed', !noMatch.sections.some(section => section.name === 'retrieval')
    && noMatch.retrieval.candidateCount === 0, JSON.stringify(noMatch.retrieval))
  await s.deleteMaterial(root, b4, unrelated.material.id)
  const noPlan = openWork(root, b4)
  noPlan.prepare("DELETE FROM artifacts WHERE artifact_id = 'plan:3'").run()
  noPlan.close()
  const emptyQuery = await b.assembleBrief(root, b4, 3)
  check('empty query disables brief retrieval', emptyQuery.retrieval.enabled === false
    && emptyQuery.retrieval.query === '', JSON.stringify(emptyQuery.retrieval))

  // Missing truth is an error, not an invented section.
  const dropStyle = openWork(root, work)
  dropStyle.prepare("DELETE FROM artifacts WHERE artifact_id = 'bible:style'").run()
  dropStyle.close()
  await rejects('missing truth refuses a brief', 'bible-missing', () => b.assembleBrief(root, work, 1))
  await rejects('unknown chapter refused', 'chapter-not-found', () => b.assembleBrief(root, work, 9))


  // Review round 1 additions.
  await rejects('world refuses pending markers', 'bible-invalid', () => b.writeBible(root, work, 'world', '# 世界观\n\n待定：主角身世\n'))
  const intent = await b.writeBible(root, work, 'intent', '')
  check('intent may be empty', typeof intent.version === 'string')

  const partial = await b.readBible(root, work)
  check('read-all reports missing instead of throwing', Array.isArray(partial.missing) && partial.missing.includes('style'), JSON.stringify(partial.missing))

  const index = await b.summaryIndex(root, work)
  check('summary index lists the chapter', index.chapters.length === 1 && index.chapters[0].number === 1, JSON.stringify(index))

  // Plan order, not insertion order.
  await b.writeBible(root, work, 'characters', JSON.stringify([
    { name: '乙', role: 'r', want: 'w', fear: 'f', limit: 'l', voice: 'v' },
    { name: '甲', role: 'r', want: 'w', fear: 'f', limit: 'l', voice: 'v' },
  ]))
  await s.writePlan(root, { work, chapter: 3, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work, chapter: 3 })
  await s.writeChapter(root, { work, chapter: 3, title: '三', body })
  await b.writeBible(root, work, 'style', '# 文风基准\n\n短句。\n')
  const ordered = await b.assembleBrief(root, work, 2)
  const characters = ordered.sections.find(section => section.name === 'characters')
  check('characters follow plan order', characters.content.indexOf('乙') < characters.content.indexOf('甲'), characters.content.slice(0, 40))

  // Fallback marker when no name appears in the plan.
  s.writeOutline(root, { work, mainline: '与人物无关。' })
  await s.writePlan(root, { work, chapter: 4, perspective: '路人', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  const fallback = await b.assembleBrief(root, work, 4)
  check('fallback section is marked', fallback.sections.find(section => section.name === 'characters').fallback === true)


  // Previous chapter falls back to the body tail when no summary exists.
  const noSummary = await b.assembleBrief(root, work, 3)
  const tailSection = noSummary.sections.find(section => section.name === 'previous')
  check('body fallback marked', tailSection.bodyFallback === true || tailSection.absent === true, JSON.stringify({ absent: tailSection.absent, bodyFallback: tailSection.bodyFallback }))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
