// Shared 250-chapter fixture for F13 performance checks (public storage APIs only).
import * as bible from '../src/bible.ts'
import * as store from '../src/store-db.ts'
import { reviewFixture } from './review-fixture.mjs'

export async function buildPerfFixture(root, options = {}) {
  const chapters = options.chapters ?? 250
  const smallWorks = options.smallWorks ?? 20
  const smallChapters = options.smallChapters ?? 10
  const { workId: work } = store.initWork(root, { title: '性能夹具' })
  await bible.writeBible(root, work, 'world', '# 世界观\n\n井台。\n')
  await bible.writeBible(root, work, 'style', '# 文风\n\n短句。\n')
  await bible.writeBible(root, work, 'intent', '# 意图\n\n找钥匙。\n')
  store.writeOutline(root, { work, mainline: '长篇。' })
  await bible.writeBible(root, work, 'characters', '[]')

  for (let number = 1; number <= chapters; number += 1) {
    store.writePlan(root, {
      work, chapter: number, perspective: '周砚', goal: `目标${number}`,
      obstacle: '阻力', cost: '代价', turn: `变化${number}`,
    })
    store.approveChapterPlan(root, { work, chapter: number })
  }
  const started = performance.now()
  for (let number = 1; number <= chapters; number += 1) {
    store.writeChapter(root, {
      work, chapter: number, title: `第${number}章`,
      body: `第 ${number} 章正文：周砚摸井台，找到一把旧钥匙。`.repeat(4),
    })
  }
  const bulkAppendMs = performance.now() - started
  for (let number = 1; number <= chapters; number += 1) {
    store.writeSummary(root, { work, chapter: number, text: `第 ${number} 章摘要：周砚在井台边找到旧钥匙。` })
    store.appendStateEvent(root, {
      work, chapter: number, kind: 'fact',
      payload: { ops: [{ op: 'upsert', fact: { subject: '周砚', predicate: '持有物', object: '旧钥匙' } }] },
    })
    store.appendStateEvent(root, {
      work, chapter: number, kind: 'fact',
      payload: { ops: [{ op: 'upsert', fact: { subject: '井台', predicate: '状态', object: '潮湿' } }] },
    })
  }

  for (let number = 1; number <= chapters; number += 1) {
    const problems = number > 20 && number % 25 === 0
      ? [{ problem: '节奏偏慢', severity: 'minor', fix: '压缩一句' }]
      : []
    reviewFixture(root, { work, chapter: number, problems })
  }
  for (let number = 1; number <= Math.min(20, chapters); number += 1) {
    store.settleState(root, { work, chapter: number, newHooks: [{ text: '旧钥匙', type: '悬念' }] })
  }

  const small = []
  for (let index = 0; index < smallWorks; index += 1) {
    const { workId } = store.initWork(root, { title: `小作品${index + 1}` })
    for (let number = 1; number <= smallChapters; number += 1) {
      store.writePlan(root, { work: workId, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
      store.approveChapterPlan(root, { work: workId, chapter: number })
      store.writeChapter(root, { work: workId, chapter: number, title: `第${number}章`, body: `小作品 ${index + 1} 第 ${number} 章。`.repeat(10) })
    }
    small.push(workId)
  }
  return { root, work, smallWorks: small, chapters, bulkAppendMs }
}
