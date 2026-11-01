// E18: server-side work/chapter summary filters.
import { filterChapters, filterWorks, workStatus } from '../src/work-filters.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

const works = [
  { workId: 'a', title: '旧井', form: 'longform', chapters: 0, writtenChapters: 0, latestStage: null, openProblems: 0 },
  { workId: 'b', title: '灰旗', form: 'longform', chapters: 2, writtenChapters: 0, latestStage: 'planned', openProblems: 0 },
  { workId: 'c', title: '长夜', form: 'longform', chapters: 3, writtenChapters: 2, latestStage: 'revised', openProblems: 2 },
  { workId: 'd', title: '收束', form: 'longform', chapters: 3, writtenChapters: 3, latestStage: 'settled', openProblems: 0 },
  { workId: 'e', title: '短篇', form: 'short', chapters: 0, writtenChapters: 0, latestStage: null, openProblems: 0 },
  { workId: 'f', title: '坏库', form: 'longform', chapters: null, writtenChapters: null, latestStage: null, openProblems: null, degraded: true },
]

check('work status empty', workStatus(works[0]) === 'empty')
check('work status planning', workStatus(works[1]) === 'planning')
check('work status writing', workStatus(works[2]) === 'writing')
check('work status settled', workStatus(works[3]) === 'settled')
check('work status degraded', workStatus(works[5]) === 'degraded')
check('short work has no derived status', workStatus(works[4]) === null)
check('title filter is substring', filterWorks(works, { q: '夜' }).map(work => work.workId).join(',') === 'c')
check('status filter ignores short works', filterWorks(works, { status: 'writing' }).map(work => work.workId).join(',') === 'c,e')
check('issues true excludes degraded null', filterWorks(works, { issues: true }).map(work => work.workId).join(',') === 'c')
check('issues false excludes degraded null', filterWorks(works, { issues: false }).map(work => work.workId).join(',') === 'a,b,d,e')
check('combined filters are AND', filterWorks(works, { q: '旗', status: 'planning' }).map(work => work.workId).join(',') === 'b')
check('empty filter returns all', filterWorks(works, {}).length === works.length)

const chapters = [
  { number: 1, title: '灰旗', stage: 'settled', openProblems: 0 },
  { number: 2, title: '旧井', stage: 'planned', openProblems: 0 },
  { number: 12, title: '归途', stage: 'written', openProblems: 3 },
]
check('numeric q matches chapter number exactly', filterChapters(chapters, { q: '12' }).map(item => item.number).join(',') === '12')
check('# number q matches exactly', filterChapters(chapters, { q: '#12' }).map(item => item.number).join(',') === '12')
check('title q matches title substring', filterChapters(chapters, { q: '井' }).map(item => item.number).join(',') === '2')
check('stage filter', filterChapters(chapters, { stage: 'settled' }).map(item => item.number).join(',') === '1')
check('chapter issues filter', filterChapters(chapters, { issues: true }).map(item => item.number).join(',') === '12')
check('chapter combined filters', filterChapters(chapters, { q: '12', stage: 'written' }).length === 1)
check('chapter empty filter', filterChapters(chapters, {}).length === chapters.length)
check('unknown stage gives no matches', filterChapters(chapters, { stage: 'missing' }).length === 0)

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
