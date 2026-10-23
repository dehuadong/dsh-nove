/** Typed foundation and chapter artifacts in the v6 registry (A0-2). */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateChapterMeta } from '../artifact-contract.js'
import { initWork } from '../storage.js'
import {
  approveChapterPlan, approveOutline, readManifest, updateSettings, writeChapter, writeOutline, writePlan,
} from '../store-db.js'
import {
  FOUNDATION_DOCUMENTS, artifactRevision, listArtifacts,
  putArtifact, readChapterMemo, readChapterMeta, readChapterSummary, readFoundationDocument,
  readRoleCard, writeChapterMemo, writeChapterSummary, writeFoundationDocument, writeRoleCard,
} from '../artifact-store.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function rejects(name, code, fn) {
  try {
    fn()
    check(name, false, '没有抛错')
  } catch (error) {
    check(name, error?.code === code, `${error?.code}: ${error?.message}`)
  }
}

const frame = [
  '# 故事框架', '', '## 前提', '有一个账本。', '', '## 核心冲突', '甲要拿回账本。',
  '', '## 主角动机', '救父亲。', '', '## 约束', '不能惊动掌柜。', '', '## 因果解决', '账本牵出旧案。', '',
].join('\n')
const volumeMap = [
  '## 第一卷 当铺', '- 卷目标：换出账本', '- 起止章：第 1–20 章',
  '- 关键节拍：掌柜刁难、账本到手', '- 卷末承诺：账本内容暴露', '',
  '## 第二卷 旧案', '- 卷目标：查清旧案', '- 起止章：第 21–40 章',
  '- 关键节拍：旧照片、旧案重启', '- 卷末承诺：旧案指向主角父亲', '',
].join('\n')
const bookRules = {
  version: '2', narrativePerson: '第三人称限知', prohibitions: ['不写现代网络梗'],
  protagonist: { name: '甲', personalityLock: ['谨慎'], behavioralConstraints: ['不主动说谎'] },
  genreLock: { primary: '悬疑', forbidden: ['穿越'] }, enableFullCastTracking: true,
  allowedDeviations: ['允许少量方言'], markdown: '# 本书规则\n',
}
const rolesIndex = {
  roles: [
    { name: '甲', tier: 'major', role: '主角', want: '救父', fear: '失去', limit: '不杀人', voice: '短句' },
    { name: '掌柜', tier: 'minor', role: '对手', want: '守住当铺', fear: '旧案翻出', limit: '不亲自动手', voice: '慢' },
  ],
}
const roleCard = {
  slug: 'jia', name: '甲', tier: 'major', motivation: '救父', knowledge: '知道账本存在',
  relationshipPressure: '掌柜欠人情', limits: '不杀人', arc: '学会求助', markdown: '# 甲\n',
}
const memo = {
  chapter: 1, goal: '拿到账本', body: '从当铺换出账本', threadRefs: ['h_1'],
  perspective: '甲', obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
}
const summary = {
  chapter: 1, title: '一', characters: '甲', events: '换账本',
  stateChanges: '甲欠人情', hookActivity: 'h_1 推进', mood: '紧', chapterType: '推进',
  bodyRevision: 1, rawText: '甲从当铺换出账本。',
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-a0-artifact-'))
try {
  const { workId: work } = initWork(root, { title: 'A0 产物', wordRange: { min: 3000, max: 5000 } })
  writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本',
    obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
  })

  // Foundation documents: canonical identity, revision and round trip.
  const frameWrite = writeFoundationDocument(root, { work, name: 'story_frame', content: frame })
  check('story_frame has its canonical artifactId',
    frameWrite.artifact.artifactId === FOUNDATION_DOCUMENTS.story_frame.artifactId, JSON.stringify(frameWrite))
  check('story_frame revision is the content hash',
    frameWrite.artifact.revisionId === artifactRevision(frame), frameWrite.artifact.revisionId)
  const frameRead = readFoundationDocument(root, { work, name: 'story_frame' })
  check('story_frame reads back latest', frameRead.artifact.content === frame, JSON.stringify(frameRead))
  const frameOld = readFoundationDocument(root, {
    work, name: 'story_frame', revisionId: frameWrite.artifact.revisionId,
  })
  check('story_frame reads an explicit revision', frameOld.artifact.content === frame)
  rejects('story_frame rejects the wrong artifactId', 'artifact-invalid', () => putArtifact(root, {
    workId: work, artifactId: 'bible:world', kind: 'story_frame',
    revisionId: 'x', content: frame, provenance: 'generated', createdAt: 'now',
  }))
  rejects('story_frame rejects missing headings', 'artifact-invalid',
    () => writeFoundationDocument(root, { work, name: 'story_frame', content: '# 只有标题\n' }))
  rejects('unknown foundation document name rejected', 'artifact-invalid',
    () => writeFoundationDocument(root, { work, name: 'characters', content: frame }))

  writeFoundationDocument(root, { work, name: 'volume_map', content: volumeMap })
  writeFoundationDocument(root, { work, name: 'book_rules', content: bookRules })
  writeFoundationDocument(root, { work, name: 'roles_index', content: rolesIndex })
  writeRoleCard(root, { work, content: roleCard })
  check('volume_map reads back', readFoundationDocument(root, { work, name: 'volume_map' }).artifact.content === volumeMap)
  check('book_rules reads back JSON', readFoundationDocument(root, { work, name: 'book_rules' }).artifact.content.version === '2')
  check('roles index reads back', readFoundationDocument(root, { work, name: 'roles_index' }).artifact.content.roles.length === 2)
  check('role card reads back', readRoleCard(root, { work, role: 'jia' }).artifact.content.name === '甲')
  check('role card read trims its role segment', readRoleCard(root, { work, role: ' jia ' }).artifact.artifactId === 'role:jia')
  rejects('book_rules rejects version 1', 'artifact-invalid',
    () => writeFoundationDocument(root, { work, name: 'book_rules', content: { ...bookRules, version: '1' } }))
  rejects('roles index rejects duplicate names', 'artifact-invalid',
    () => writeFoundationDocument(root, { work, name: 'roles_index', content: { roles: [rolesIndex.roles[0], rolesIndex.roles[0]] } }))
  rejects('role card cannot duplicate index fields', 'artifact-invalid',
    () => writeRoleCard(root, { work, role: '甲', content: { ...roleCard, want: '救父' } }))
  rejects('role card rejects an empty segment', 'artifact-invalid',
    () => writeRoleCard(root, { work, role: ' ', content: roleCard }))
  rejects('role card identity must match content.slug', 'artifact-invalid',
    () => writeRoleCard(root, { work, role: 'yi', content: roleCard }))
  rejects('role card slug cannot contain a colon', 'artifact-invalid',
    () => writeRoleCard(root, { work, content: { ...roleCard, slug: 'jia:1' } }))
  rejects('volume_map needs all four fields per volume', 'artifact-invalid',
    () => writeFoundationDocument(root, { work, name: 'volume_map', content: '## 第一卷\n只有标题\n' }))

  // Chapter memo: plan:<n> with a matching chapter scope, immutable revisions.
  const memoWrite = writeChapterMemo(root, { work, chapter: 1, content: memo })
  check('chapter memo uses plan:<n>', memoWrite.artifact.artifactId === 'plan:1' && memoWrite.artifact.kind === 'plan')
  check('chapter memo keeps chapter scope', memoWrite.artifact.scope.chapter === 1, JSON.stringify(memoWrite))
  check('chapter memo revision is the content hash',
    memoWrite.artifact.revisionId === artifactRevision(memo), memoWrite.artifact.revisionId)
  const memoSecond = writeChapterMemo(root, {
    work, chapter: 1, content: { ...memo, goal: '拿到真账本' }, provenance: 'edited',
  })
  check('rewritten memo has a new revision', memoSecond.artifact.revisionId !== memoWrite.artifact.revisionId)
  const memoLatest = readChapterMemo(root, { work, chapter: 1 })
  check('chapter memo reads latest', memoLatest.artifact.content.goal === '拿到真账本', JSON.stringify(memoLatest))
  const memoOld = readChapterMemo(root, { work, chapter: 1, revisionId: memoWrite.artifact.revisionId })
  check('chapter memo keeps the old revision immutable', memoOld.artifact.content.goal === '拿到账本')
  rejects('duplicate memo revision is refused', 'artifact-revision-exists',
    () => writeChapterMemo(root, { work, chapter: 1, content: { ...memo, goal: '拿到真账本' }, provenance: 'edited' }))
  check('chapter scope mismatch rejected', (() => {
    try {
      putArtifact(root, {
        workId: work, artifactId: 'plan:1', kind: 'plan', scope: { chapter: 2 },
        revisionId: 'mismatch', content: memo, provenance: 'generated', createdAt: 'now',
      })
      return false
    } catch (error) {
      return error?.code === 'artifact-invalid'
    }
  })())
  rejects('memo without scope rejected', 'artifact-invalid', () => putArtifact(root, {
    workId: work, artifactId: 'plan:1', kind: 'plan',
    revisionId: 'no-scope', content: memo, provenance: 'generated', createdAt: 'now',
  }))
  rejects('memo content chapter must match the ID', 'artifact-invalid',
    () => writeChapterMemo(root, { work, chapter: 1, content: { ...memo, chapter: 2 } }))
  rejects('a memo needs an existing chapter', 'chapter-not-found',
    () => writeChapterMemo(root, { work, chapter: 99, content: { ...memo, chapter: 99 } }))
  check('plan list carries the latest memo and scope', (() => {
    const list = listArtifacts(root, { work, kind: 'plan' })
    return list.artifacts.length === 1
      && list.artifacts[0].revisionId === memoSecond.artifact.revisionId
      && list.artifacts[0].scope.chapter === 1
  })())

  // Structured summary: summary:<n>, chapter bound.
  const summaryWrite = writeChapterSummary(root, { work, chapter: 1, content: summary })
  check('chapter summary uses summary:<n>', summaryWrite.artifact.artifactId === 'summary:1' && summaryWrite.artifact.kind === 'summary')
  check('chapter summary reads back bodyRevision',
    readChapterSummary(root, { work, chapter: 1 }).artifact.content.bodyRevision === 1)
  rejects('summary content chapter must match the ID', 'artifact-invalid',
    () => writeChapterSummary(root, { work, chapter: 1, content: { ...summary, chapter: 2 } }))
  rejects('summary needs bodyRevision', 'artifact-invalid',
    () => writeChapterSummary(root, { work, chapter: 1, content: { ...summary, bodyRevision: 0 } }))

  // ChapterMeta projection and the author's plan gate.
  const unapproved = readChapterMeta(root, { work, chapter: 1 })
  check('chapter meta is contract-valid', validateChapterMeta(unapproved.chapterMeta).number === 1)
  check('chapter meta starts without planRevision', unapproved.chapterMeta.planRevision === undefined, JSON.stringify(unapproved))
  const approvedMemo = approveChapterPlan(root, { work, chapter: 1 })
  check('the author approval binds the latest memo revision',
    approvedMemo.entry.planRevision === memoSecond.artifact.revisionId, JSON.stringify(approvedMemo.entry))
  const approvedMeta = readChapterMeta(root, { work, chapter: 1 }).chapterMeta
  check('chapter meta exposes the approved memo revision',
    approvedMeta.planRevision === memoSecond.artifact.revisionId && typeof approvedMeta.planApprovedAt === 'string',
    JSON.stringify(approvedMeta))
  check('approved chapter meta is contract-valid', validateChapterMeta(approvedMeta).planRevision === memoSecond.artifact.revisionId)
  const memoThird = writeChapterMemo(root, {
    work, chapter: 1, content: { ...memo, goal: '拿到账本与证据' }, provenance: 'edited',
  })
  const invalidated = readChapterMeta(root, { work, chapter: 1 }).chapterMeta
  check('a new memo revision invalidates the earlier confirmation',
    invalidated.planApprovedAt === undefined && invalidated.planRevision === undefined,
    JSON.stringify(invalidated))
  check('manifest reports the plan as not approved after a memo rewrite',
    readManifest(root, work).chapters[0].planApproved === false)
  rejects('the write gate reads the bound memo revision', 'plan-not-approved',
    () => writeChapter(root, { work, chapter: 1, body: '一章正文。', requirePlanApproval: true }))
  const approvedThird = approveChapterPlan(root, { work, chapter: 1 })
  check('re-approval binds the new latest memo revision',
    approvedThird.entry.planRevision === memoThird.artifact.revisionId, JSON.stringify(approvedThird.entry))

  // A chapter without a memo keeps the legacy plan approval and no revision.
  writePlan(root, {
    work, chapter: 2, perspective: '掌柜', goal: '守住当铺',
    obstacle: '旧案翻出', cost: '失去当铺', turn: '账本被夺',
  })
  const legacyApproved = approveChapterPlan(root, { work, chapter: 2 })
  check('legacy plan approval records only its timestamp',
    typeof legacyApproved.entry.planApprovedAt === 'string' && legacyApproved.entry.planRevision === undefined,
    JSON.stringify(legacyApproved.entry))
  check('legacy approval leaves planRevision empty',
    readManifest(root, work).chapters[1].planRevision === undefined,
    JSON.stringify(readManifest(root, work).chapters[1]))
  writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到真账本',
    obstacle: '掌柜刁难', cost: '欠人情', turn: '账本牵出旧案',
  })
  const cleared = readChapterMeta(root, { work, chapter: 1 }).chapterMeta
  check('rewriting a plan clears approval and revision',
    cleared.planApprovedAt === undefined && cleared.planRevision === undefined, JSON.stringify(cleared))
  check('chapter meta lists review observation artifacts', (() => {
    putArtifact(root, {
      workId: work, artifactId: 'review:1:1:1', kind: 'review', scope: { chapter: 1 },
      revisionId: 'review-hash', content: { observations: [] }, provenance: 'generated', createdAt: 'now',
    })
    return readChapterMeta(root, { work, chapter: 1 }).chapterMeta.observationIds.includes('review:1:1:1')
  })())

  // WorkConfig gates: planApproval and outline are readable and writable.
  updateSettings(root, { work, planApproval: 'off' })
  check('planApproval gate can be switched off', readManifest(root, work).planApproval === 'off')
  updateSettings(root, { work, planApproval: 'required' })
  const outlined = writeOutline(root, { work, mainline: '一条主线', volumes: '第一卷', ending: '旧案了结' })
  const pendingOutline = readManifest(root, work).outline
  check('outline gate is written unapproved',
    pendingOutline.writtenAt === outlined.outline.writtenAt && pendingOutline.approvedAt === undefined,
    JSON.stringify(pendingOutline))
  approveOutline(root, { work })
  check('outline gate records approval', typeof readManifest(root, work).outline.approvedAt === 'string')
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
