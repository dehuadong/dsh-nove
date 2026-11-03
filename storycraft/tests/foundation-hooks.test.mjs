// R1b: architect initial hooks seed the v2 ledger at chapter 0, feed the
// existing consumers, re-seed by hookId, and complete the foundation.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as b from '../src/bible/index.ts'
import { readDashboard } from '../src/dashboard.ts'
import { readFoundationDocuments } from '../src/artifact-store.ts'
import { mintHookId } from '../src/state-projection.ts'
import { reviewFixture } from './review-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const storyFrame = '# 故事框架\n\n## 前提\n荒原工程队。\n\n## 核心冲突\n旧秩序与新建立。\n\n## 主角动机\n救父。\n\n## 约束\n不杀人。\n\n## 因果解决\n立国。\n'
const volumeMap = '## 第一卷\n- 卷目标：立住脚。\n- 起止章：1–20。\n- 关键节拍：搭棚。\n- 卷末承诺：活下来。\n'
const currentFocus = '# 当前焦点\n\n先立第一根梁。\n'
const bookRules = {
  version: '2', narrativePerson: '第三人称', prohibitions: ['禁止无代价的奇迹'],
  protagonist: { name: '甲', personalityLock: ['不撒谎'], behavioralConstraints: ['不杀人'] },
  genreLock: { primary: '废土', forbidden: ['玄幻'] }, enableFullCastTracking: false,
  allowedDeviations: [], markdown: '# 作品规则\n\n禁止无代价的奇迹。\n',
}
const rolesIndex = { roles: [{ name: '甲', tier: 'major' }] }
const card = {
  slug: 'jia', name: '甲', tier: 'major', motivation: '救父', knowledge: '知道账本',
  relationshipPressure: '欠人情', limits: '不杀人', markdown: '# 甲\n\n主角。\n',
}
const ledgerHook = {
  hookId: 'ledger-debt', type: '关系债', expectedPayoff: '第三卷由乙亲口承认账本的来历',
  notes: '开篇埋', text: '那本没人认领的旧账本',
}
const watchHook = {
  hookId: 'stopped-watch', type: '物件', expectedPayoff: '第一卷末发现表停在父亲失踪那天',
  notes: '', text: '停摆的怀表',
}
const lensHook = {
  hookId: 'broken-lens', type: '线索', expectedPayoff: '第二卷查出镜片来源', notes: '', text: '碎掉的镜片',
}

function phases(pendingHooks) {
  return {
    outline: { storyFrame, volumeMap, currentFocus },
    details: { bookRules, pendingHooks },
    cast_index: { rolesIndex },
    cards: { roleCards: [card] },
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-foundation-hooks-'))
try {
  const { workId: work } = s.initWork(root, { title: '初始伏笔', wordRange: { min: 50, max: 5000 } })
  const landed = s.writeFoundationBundle(root, { work, phases: phases([ledgerHook, watchHook]) })
  const state = s.readFoundationState(root, work)
  check('the bundle completes a five-section foundation', state.complete === true && state.stages.hooks === true
    && state.stages.frame === true && state.stages.rules === true && state.stages.roles === true
    && state.stages.cards === true, JSON.stringify(state))
  check('the bundle returns the hooks artifact', landed.artifacts.some(artifact => artifact.artifactId === 'bible:hooks'),
    JSON.stringify(landed.artifacts))

  const folded = s.readFoldedState(root, work)
  check('both seeds project at chapter 0 as deferred', folded.hooks.length === 2
    && folded.hooks.every(hook => hook.startChapter === 0 && hook.status === 'deferred' && hook.lastAdvancedChapter === 0)
    && folded.hooks.map(hook => hook.text).sort().join('|') === [ledgerHook.text, watchHook.text].sort().join('|'),
  JSON.stringify(folded.hooks))
  check('the seed ids come from the architect', folded.hooks.some(hook => hook.hookId === 'ledger-debt')
    && folded.hooks.some(hook => hook.hookId === 'stopped-watch'), JSON.stringify(folded.hooks.map(hook => hook.hookId)))
  check('seeds are hook events in the ledger', s.readEvents(root, work).filter(event => event.kind === 'hook').length === 2)

  const documents = readFoundationDocuments(root, work)
  check('the hooks document carries the readable table', documents.hooks.content.markdown.startsWith('# 初始伏笔')
    && documents.hooks.content.markdown.includes('ledger-debt')
    && documents.hooks.content.markdown.includes('停摆的怀表')
    && documents.hooks.content.markdown.includes('开篇'), documents.hooks.content.markdown)

  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work, chapter: 1 })
  const before = await b.assembleBrief(root, work, 1)
  const beforeHooks = before.sections.find(section => section.name === 'hooks')
  check('the brief lists the seeded hooks as unresolved',
    beforeHooks?.content.includes(ledgerHook.text) === true && beforeHooks.content.includes('deferred'), JSON.stringify(beforeHooks))
  const hits = s.searchMemory(root, work, '账本')
  check('retrieval surfaces the seeded hook', hits.some(hit => hit.kind === 'hook' && hit.text.includes(ledgerHook.text)), JSON.stringify(hits))
  const dash = readDashboard(root, work)
  check('the dashboard lists the seeded hook under the opening group',
    dash.hooks.some(hook => hook.hookId === ledgerHook.hookId && hook.startChapter === 0
      && ['open', 'progressing', 'deferred'].includes(hook.status)), JSON.stringify(dash.hooks))

  s.writeChapter(root, { work, chapter: 1, body: '甲翻开账本。'.repeat(30) })
  reviewFixture(root, { work, chapter: 1, observations: [] })
  s.writeSummary(root, { work, chapter: 1, text: '第一章摘要。' })
  throwsCode('an unknown hook id stays refused', 'hook-not-found',
    () => s.settleState(root, { work, chapter: 1, hookOps: { resolve: ['nope'] } }))
  s.settleState(root, { work, chapter: 1, hookOps: { progress: [ledgerHook.hookId] } })
  const advancedHook = s.readFoldedState(root, work).hooks.find(hook => hook.hookId === ledgerHook.hookId)
  check('a chapter settles the seeded hook by id', advancedHook?.status === 'progressing'
    && advancedHook.lastAdvancedChapter === 1, JSON.stringify(advancedHook))

  s.approveFoundation(root, { work })
  check('the complete foundation can be approved', s.readFoundationState(root, work).approvedAt !== undefined)

  const reSeeded = s.writeFoundationBundle(root, {
    work,
    phases: phases([{ ...ledgerHook, notes: '开篇埋；第三卷前不要再提' }, lensHook]),
  })
  const reseeded = s.readFoldedState(root, work)
  const kept = reseeded.hooks.find(hook => hook.hookId === ledgerHook.hookId)
  const removed = reseeded.hooks.find(hook => hook.hookId === watchHook.hookId)
  const added = reseeded.hooks.find(hook => hook.hookId === lensHook.hookId)
  check('re-seeding keeps the advanced status and updates metadata', kept?.status === 'progressing'
    && kept.notes.includes('不要再提'), JSON.stringify(kept))
  check('a removed seed is superseded, not deleted', removed?.status === 'superseded', JSON.stringify(removed))
  check('a new seed lands as deferred', added?.status === 'deferred' && added.startChapter === 0, JSON.stringify(added))
  check('re-seeding clears the author approval', s.readFoundationState(root, work).approvedAt === undefined)
  check('re-seeding rewrites the readable document', reSeeded.artifacts.some(artifact => artifact.artifactId === 'bible:hooks')
    && readFoundationDocuments(root, work).hooks.content.markdown.includes('broken-lens'))

  throwsCode('a removed seed cannot be revived', 'foundation-hooks-retired',
    () => s.writeFoundationBundle(root, {
      work,
      phases: phases([{ ...ledgerHook, notes: '开篇埋；第三卷前不要再提' }, lensHook, watchHook]),
    }))
  throwsCode('a removed seed cannot be revived by the manual hooks stage', 'foundation-hooks-retired',
    () => s.writeFoundationStage(root, { work, stage: 'hooks', payload: { pendingHooks: [ledgerHook, lensHook, watchHook] } }))

  const emptyWork = s.initWork(root, { title: '空伏笔' }).workId
  s.writeFoundationBundle(root, { work: emptyWork, phases: phases([]) })
  check('an empty seed still completes the foundation', s.readFoundationState(root, emptyWork).complete === true
    && s.readFoldedState(root, emptyWork).hooks.length === 0
    && readFoundationDocuments(root, emptyWork).hooks.content.markdown.startsWith('# 初始伏笔'))

  const duplicateWork = s.initWork(root, { title: '重复伏笔' }).workId
  throwsCode('a duplicate hookId is refused', 'foundation-hooks-duplicate',
    () => s.writeFoundationBundle(root, { work: duplicateWork, phases: phases([ledgerHook, { ...watchHook, hookId: ledgerHook.hookId }]) }))
  check('a refused duplicate writes nothing', s.readFoundationState(root, duplicateWork).stages.frame === false
    && s.readFoldedState(root, duplicateWork).hooks.length === 0)
  const duplicateTextWork = s.initWork(root, { title: '重复文本' }).workId
  s.writeFoundationBundle(root, { work: duplicateTextWork, phases: phases([ledgerHook, { ...watchHook, text: ledgerHook.text }]) })
  check('a duplicate display line is allowed because ids are the identity',
    s.readFoldedState(root, duplicateTextWork).hooks.length === 2)
  const fieldWork = s.initWork(root, { title: '非法字段' }).workId
  throwsCode('host-owned fields are refused', 'artifact-invalid',
    () => s.writeFoundationBundle(root, { work: fieldWork, phases: phases([{ ...ledgerHook, status: 'open' }]) }))

  const exportWork = s.initWork(root, { title: '导出伏笔' }).workId
  s.writeFoundationBundle(root, { work: exportWork, phases: phases([ledgerHook]) })
  const exported = s.exportWork(root, exportWork, join(root, 'out', 'one'))
  const foundationFiles = await readdir(join(exported.directory, 'foundation'))
  check('the export ships the initial-hooks document', foundationFiles.includes('hooks.md')
    && (await readFile(join(exported.directory, 'foundation', 'hooks.md'), 'utf8')).includes('ledger-debt'),
  JSON.stringify(foundationFiles))

  // A chapter-minted hook id stays the settler's; the architect cannot take it.
  const conflictWork = s.initWork(root, { title: '章节伏笔冲突', wordRange: { min: 50, max: 5000 } }).workId
  s.writeFoundationBundle(root, { work: conflictWork, phases: phases([]) })
  s.writeOutline(root, { work: conflictWork, mainline: '一条主线' })
  s.approveOutline(root, { work: conflictWork })
  s.writePlan(root, { work: conflictWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: conflictWork, chapter: 1 })
  s.writeChapter(root, { work: conflictWork, chapter: 1, body: '甲捡到一张纸条。'.repeat(30) })
  reviewFixture(root, { work: conflictWork, chapter: 1, observations: [] })
  s.writeSummary(root, { work: conflictWork, chapter: 1, text: '第一章摘要。' })
  const chapterHookText = '门缝里的纸条'
  s.settleState(root, { work: conflictWork, chapter: 1, newHooks: [{ text: chapterHookText, type: '线索', expectedPayoff: '第二卷查清笔迹' }] })
  throwsCode('re-seeding cannot take a chapter-minted id', 'foundation-hooks-conflict',
    () => s.writeFoundationBundle(root, {
      work: conflictWork,
      phases: phases([{ ...lensHook, hookId: mintHookId(chapterHookText) }]),
    }))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
