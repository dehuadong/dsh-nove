// Chapter length: markdown metadata is not prose, and explicit min/max is a hard gate.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { countChapterLength } from '../src/domain.ts'

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

check('markdown headings and fences are not prose',
  countChapterLength('# 标题\n\n正文。\n\n```\ncode\n```\n') === [...'正文。'].length,
  String(countChapterLength('# 标题\n\n正文。\n\n```\ncode\n```\n')))

const root = await mkdtemp(join(tmpdir(), 'storycraft-chapter-length-'))
try {
  const { workId: work } = s.initWork(root, { title: '字数边界', wordRange: { min: 10, max: 20 } })
  s.writeOutline(root, { work, mainline: '一条线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1 })

  check('below the minimum is refused', codeOf(() => s.writeChapter(root, {
    work, chapter: 1, body: '甲'.repeat(5), wordRange: { min: 10, max: 20 },
  })) === 'chapter-length-out-of-range')
  check('above the maximum is refused', codeOf(() => s.writeChapter(root, {
    work, chapter: 1, body: '甲'.repeat(25), wordRange: { min: 10, max: 20 },
  })) === 'chapter-length-out-of-range')

  const written = s.writeChapter(root, {
    work, chapter: 1, body: `# 标题\n\n${'甲'.repeat(15)}`, wordRange: { min: 10, max: 20 },
  })
  check('in-range prose is written', written.words === 15, JSON.stringify(written))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
