// R10b: architect stages produce foundation artifacts; author confirms; consumers read them.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { delegateRole } from '../delegate.js'
import { submitPayload } from '../submission.js'
import * as s from '../storage.js'
import * as b from '../bible.js'
import { assembleRoleContext } from '../context.js'
import { readFoundationDocuments, readTextArtifact } from '../artifact-store.js'

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

function fakeService(results) {
  return {
    startActivation(spec) {
      const result = results.shift()
      if (result === undefined) throw new Error('no fake result queued')
      return {
        result: (async () => {
          const id = /delegationId 是 ([0-9a-f-]+)/u.exec(spec.request.prompt[0].text)?.[1]
          await submitPayload({ delegationId: id, depth: 1, root: spec.request.cwd, payload: result.payload })
          return { stopReason: 'completed' }
        })(),
        dispose: async () => {},
      }
    },
  }
}

const agent = { id: 'parent' }
const signal = new AbortController().signal
const frame = {
  storyFrame: '# 故事框架\n\n## 前提\n荒原工程队。\n\n## 核心冲突\n旧秩序与新建立。\n\n## 主角动机\n救父。\n\n## 约束\n不杀人。\n\n## 因果解决\n立国。\n',
  volumeMap: '## 第一卷\n- 卷目标：立住脚。\n- 起止章：1–20。\n- 关键节拍：搭棚。\n- 卷末承诺：活下来。\n',
  currentFocus: '# 当前焦点\n\n先立第一根梁。\n',
}
const bookRules = {
  version: '2', narrativePerson: '第三人称', prohibitions: ['禁止无代价的奇迹'],
  protagonist: { name: '甲', personalityLock: ['不撒谎'], behavioralConstraints: ['不杀人'] },
  genreLock: { primary: '废土', forbidden: ['玄幻'] }, enableFullCastTracking: false,
  allowedDeviations: [], markdown: '# 作品规则\n\n禁止无代价的奇迹。\n',
}
const rolesIndex = {
  roles: [
    { name: '甲', tier: 'major', role: '主角', want: '救父', fear: '失去', limit: '不杀人', voice: '短句' },
    { name: '乙', tier: 'minor', role: '对手', want: '守铺', fear: '旧案', limit: '不亲自动手', voice: '慢' },
  ],
}
const card = {
  slug: 'jia', name: '甲', tier: 'major', motivation: '救父', knowledge: '知道账本',
  relationshipPressure: '欠人情', limits: '不杀人', arc: '学会求助', markdown: '# 甲\n\n主角。\n',
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-foundation-production-'))
try {
  const work = (await s.initWork(root, { title: '基础生成', wordRange: { min: 50, max: 5000 } })).workId
  const shortWork = (await s.initWork(root, { title: '短篇不生成基础', form: 'short' })).workId
  const shortNext = await s.nextStep(root, shortWork)
  check('short works skip foundation', shortNext.action !== 'story_architect', JSON.stringify(shortNext))
  const first = await s.nextStep(root, work)
  check('a new work starts with the architect frame', first.action === 'story_architect'
    && first.foundationStage === 'frame' && first.delegate?.role === 'architect', JSON.stringify(first))

  await rejects('unknown stage is refused', 'foundation-stage-invalid', () => delegateRole(root, {
    work, role: 'architect', stage: 'world',
  }, { service: fakeService([]), agent, signal }))

  const invalid = frame.storyFrame.replace('## 约束\n', '')
  await rejects('an invalid frame lands nothing', 'delegation-no-submission', () => delegateRole(root, {
    work, role: 'architect', stage: 'frame',
  }, { service: fakeService([{ payload: { ...frame, storyFrame: invalid } }]), agent, signal }))
  check('a rejected frame writes no artifact', s.readFoundationState(root, work).stages.frame === false)

  const landed = await delegateRole(root, { work, role: 'architect', stage: 'frame' }, {
    service: fakeService([{ payload: frame }]), agent, signal,
  })
  check('frame lands three artifacts', landed.foundationStage === 'frame'
    && landed.artifacts.length === 3 && landed.foundation.stages.frame === true, JSON.stringify(landed))
  const rerun = await delegateRole(root, { work, role: 'architect', stage: 'frame' }, {
    service: fakeService([{ payload: frame }]), agent, signal,
  })
  check('identical content rerun is a no-op', rerun.artifacts[0].revisionId === landed.artifacts[0].revisionId, JSON.stringify(rerun.artifacts))
  const changedFocus = frame.currentFocus.replace('第一根梁', '第二根梁')
  const changed = await delegateRole(root, { work, role: 'architect', stage: 'frame' }, {
    service: fakeService([{ payload: { ...frame, currentFocus: changedFocus } }]), agent, signal,
  })
  check('changed content adds a revision', changed.artifacts[2].revisionId !== landed.artifacts[2].revisionId)
  const oldRevision = readTextArtifact(root, {
    work, artifactId: 'bible:current_focus', kind: 'current_focus', revisionId: landed.artifacts[2].revisionId,
  })
  check('old foundation revisions stay readable', oldRevision.artifact.content.includes('第一根梁'))
  const frameDocs = readFoundationDocuments(root, work)
  check('frame is readable through the artifact API',
    frameDocs.storyFrame.content.includes('荒原工程队') && frameDocs.volumeMap.content.includes('立住脚'), JSON.stringify(frameDocs.storyFrame))

  await delegateRole(root, { work, role: 'architect', stage: 'rules' }, {
    service: fakeService([{ payload: { bookRules } }]), agent, signal,
  })
  await delegateRole(root, { work, role: 'architect', stage: 'roles' }, {
    service: fakeService([{ payload: { rolesIndex } }]), agent, signal,
  })
  await rejects('a card for a non-major role lands nothing', 'artifact-invalid', () => delegateRole(root, {
    work, role: 'architect', stage: 'cards',
  }, { service: fakeService([{ payload: { roleCards: [{ ...card, name: '乙', slug: 'yi' }] } }]), agent, signal }))
  check('a rejected card keeps the stage incomplete', s.readFoundationState(root, work).stages.cards === false)

  const cards = await delegateRole(root, { work, role: 'architect', stage: 'cards' }, {
    service: fakeService([{ payload: { roleCards: [card] } }]), agent, signal,
  })
  check('cards complete the foundation', cards.foundation.complete === true && cards.foundation.nextStage === undefined,
    JSON.stringify(cards.foundation))

  const pending = await s.nextStep(root, work)
  check('complete foundation waits for author approval',
    pending.action === 'story_architect' && pending.blocked?.includes('foundation-approval') && pending.delegate === undefined,
    JSON.stringify(pending))
  await rejects('approval needs a complete foundation', 'foundation-incomplete', () => {
    const other = s.initWork(root, { title: '空基础' }).workId
    s.approveFoundation(root, { work: other })
  })
  s.approveFoundation(root, { work })
  check('approval is recorded', s.readFoundationState(root, work).approvedAt !== undefined)
  const after = await s.nextStep(root, work)
  check('approved foundation moves to the outline', after.action === 'story_outline', JSON.stringify(after))

  await delegateRole(root, { work, role: 'architect', stage: 'rules' }, {
    service: fakeService([{ payload: { bookRules: { ...bookRules, narrativePerson: '第一人称' } } }]), agent, signal,
  })
  check('a rerun clears approval', s.readFoundationState(root, work).approvedAt === undefined)

  s.writeOutline(root, { work, mainline: '一条线' })
  const manual = s.nextStep(root, work)
  check('an outline written manually skips the foundation gate', manual.action !== 'story_architect', JSON.stringify(manual))

  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveOutline(root, { work })
  s.approveChapterPlan(root, { work, chapter: 1 })
  const brief = await b.assembleBrief(root, work, 1)
  const storyFrame = brief.sections.find(section => section.name === 'storyFrame')
  const bookRulesSection = brief.sections.find(section => section.name === 'bookRules')
  check('brief reads the generated foundation', storyFrame?.content.includes('荒原工程队') && bookRulesSection?.content.includes('作品规则'),
    JSON.stringify({ storyFrame, bookRulesSection }))
  const writer = await assembleRoleContext({ root, work, chapter: 1, role: 'writer', task: '写第一章' })
  const constraints = writer.sections.find(section => section.name === 'constraints')
  check('context reads the generated rules', constraints?.content.includes('作品规则'), JSON.stringify(constraints?.content?.slice(0, 120)))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
