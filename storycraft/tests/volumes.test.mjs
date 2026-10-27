// Volumes and the rolling summary window.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as b from '../src/bible.ts'
import { readVolumes, volumeOf, writeVolume } from '../src/volumes.ts'

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

const root = await mkdtemp(join(tmpdir(), 'storycraft-volumes-'))
try {
  const work = (await s.initWork(root, { title: '卷测试' })).workId
  const plan = { work, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' }
  for (let chapter = 1; chapter <= 8; chapter += 1) {
    await s.writePlan(root, { ...plan, chapter })
    await s.approveChapterPlan(root, { work, chapter })
    await s.writeChapter(root, { work, chapter, body: `第${chapter}章正文。`.repeat(30) })
    await b.writeSummary(root, work, chapter, `第${chapter}章摘要`)
  }

  // Create and read back.
  const first = await writeVolume(root, { work, title: '第一折', from: 1, to: 4, summary: '开局的四章' })
  check('volume created', first.volumes.length === 1 && first.volumes[0].id === 'v1', JSON.stringify(first.volumes))
  check('readVolumes returns it', (await readVolumes(root, work)).length === 1)

  // A second volume and the owning-volume lookup.
  await writeVolume(root, { work, title: '第二折', from: 5, to: 8 })
  check('volumeOf finds the owner', volumeOf(await readVolumes(root, work), 6)?.title === '第二折')

  // Validation.
  await rejects('from > to refused', 'volume-invalid', () => writeVolume(root, { work, title: '坏卷', from: 9, to: 8 }))
  await rejects('overlap refused', 'volume-overlap', () => writeVolume(root, { work, title: '重叠', from: 3, to: 6 }))
  await rejects('chapter must exist', 'chapter-not-found', () => writeVolume(root, { work, title: '越界', from: 9, to: 10 }))

  // Updating keeps the id and re-checks overlap against the others.
  const updated = await writeVolume(root, { work, id: 'v2', title: '第二折·改', from: 5, to: 8 })
  check('update keeps the id', updated.volumes.filter(volume => volume.id === 'v2')[0].title === '第二折·改')
  await rejects('update may not swallow another volume', 'volume-overlap', () => writeVolume(root, { work, id: 'v2', title: '第二折·改', from: 4, to: 8 }))

  // Brief: volume summary plus the rolling window.
  const brief = await b.assembleBrief(root, work, 8)
  const sections = brief.sections.map(section => section.name)
  check('brief order includes the new sections', sections.join(',') === 'intent,storyFrame,bookRules,plan,currentFocus,characters,hooks,volumeMap,volumeSummary,recentSummaries,previous,style,wordPolicy', sections.join(','))
  const volumeSection = brief.sections.find(section => section.name === 'volumeSummary')
  check('volume summary absent when the volume has none', volumeSection.absent === true, JSON.stringify(volumeSection))
  const recent = brief.sections.find(section => section.name === 'recentSummaries')
  check('recent window holds five chapters', (recent.content.match(/^第 \d+ 章：/gm) ?? []).length === 5, recent.content.slice(0, 80))
  check('recent window starts at chapter 3 for chapter 8', recent.content.includes('第 3 章：') && !recent.content.includes('第 2 章：'), recent.content.slice(0, 60))

  // A volume with a summary shows up.
  await writeVolume(root, { work, id: 'v2', title: '第二折', from: 5, to: 8, summary: '后半段' })
  const withSummary = await b.assembleBrief(root, work, 8)
  const filled = withSummary.sections.find(section => section.name === 'volumeSummary')
  check('volume summary carried when present', filled.absent === false && filled.content === '后半段', JSON.stringify(filled))

  // Early chapters carry only the summaries that exist.
  const early = await b.assembleBrief(root, work, 3)
  const earlyRecent = early.sections.find(section => section.name === 'recentSummaries')
  check('early chapter window shrinks', (earlyRecent.content.match(/^第 \d+ 章：/gm) ?? []).length === 2, earlyRecent.content.slice(0, 60))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
