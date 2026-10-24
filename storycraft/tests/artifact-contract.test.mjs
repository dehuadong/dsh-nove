/** Contract tests for the A0 artifact model. */

import {
  ARTIFACT_CONTRACT_VERSION, ARTIFACT_KINDS, FORM_PIPELINES, HOOK_TRANSITIONS,
  assertHookTransition, validateArtifactEnvelope, validateArtifactRecord, validateBookRules, validateChapterMemo,
  validateChapterMeta, validateChapterSummary, validateChapterTrace, validateContextPackage,
  validateContextSource, validateFact, validateHook, validateObservation, validateReviewObservations,
  validateRoleCard, validateRolesIndex, validateScript, validateShortStory, validateStoryFrame,
  validateVolumeMap, validateWorkConfig,
} from '../dist/artifact-contract.js'

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

const work = {
  workId: '书', title: '书', form: 'longform', language: 'zh',
  status: 'active', planApproval: 'required', outline: { writtenAt: 'now', approvedAt: 'now' },
  chapterWordCount: { min: 3000, max: 5000, target: 4000 }, tags: ['长篇'],
  createdAt: 'now', updatedAt: 'now',
}

const memo = {
  chapter: 1, goal: '拿到账本', body: '从当铺换出账本', threadRefs: ['h_1'],
  perspective: '甲', obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
}

const summary = {
  chapter: 1, title: '一', characters: '甲', events: '换账本',
  stateChanges: '甲欠人情', hookActivity: 'h_1 推进', mood: '紧', chapterType: '推进',
  bodyRevision: 2, rawText: '甲从当铺换出账本。',
}

const hook = {
  hookId: 'h_1', startChapter: 0, type: '物件', status: 'open',
  lastAdvancedChapter: 0, expectedPayoff: '账本真相', notes: '开书伏笔',
  dependsOn: [], paysOffInArc: '第一卷', text: '账本里夹着一张旧照片',
}

const fact = {
  subject: '甲', predicate: '持有', object: '账本',
  validFromChapter: 1, validUntilChapter: null, sourceChapter: 1,
}

const observation = {
  id: 'O1', code: 'hook-unsupported', summary: '伏笔没有推进', evidence: ['账本没有出现'],
  category: 'quality', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter:1', quote: '甲把账本收好。' }],
  severity: 'major', fix: '补账本内容', mode: 'patch',
}

check('contract version is 2', ARTIFACT_CONTRACT_VERSION === 2, String(ARTIFACT_CONTRACT_VERSION))
check('all three form pipelines', Object.keys(FORM_PIPELINES).join(',') === 'longform,short,script')
check('hook states', Object.keys(HOOK_TRANSITIONS).join(',') === 'open,progressing,deferred,resolved,superseded')
check('short/script are separate', !FORM_PIPELINES.short.includes('chapter') && !FORM_PIPELINES.script.includes('chapter'))

check('work config valid', validateWorkConfig(work).workId === '书')
rejects('work config rejects unknown field', 'artifact-invalid',
  () => validateWorkConfig({ ...work, artifactContract: 'v2' }))
rejects('work config rejects bad approval', 'artifact-invalid',
  () => validateWorkConfig({ ...work, planApproval: 'optional' }))

const frame = '# 故事框架\n\n## 前提\n有一个账本。\n\n## 核心冲突\n甲要拿回账本。\n\n## 主角动机\n救父亲。\n\n## 约束\n不能惊动掌柜。\n\n## 因果解决\n账本牵出旧案。'
check('story frame valid', validateStoryFrame(frame) === frame)
rejects('story frame needs headings', 'artifact-invalid', () => validateStoryFrame('# 故事框架\n'))
check('volume map valid', validateVolumeMap('## 第一卷\n- 卷目标：换账本\n- 起止章：第 1–20 章\n- 关键节拍：当铺对峙\n- 卷末承诺：账本暴露') !== '')
rejects('volume map needs a volume heading', 'artifact-invalid', () => validateVolumeMap('随便写'))
rejects('volume map needs every volume field', 'artifact-invalid',
  () => validateVolumeMap('## 第一卷\n- 卷目标：换账本\n'))

const rules = {
  version: '2', narrativePerson: '第三人称限知', prohibitions: ['不写现代网络梗'],
  protagonist: { name: '甲', personalityLock: ['谨慎'], behavioralConstraints: ['不主动说谎'] },
  genreLock: { primary: '悬疑', forbidden: ['穿越'] }, enableFullCastTracking: true,
  allowedDeviations: ['允许少量方言'], markdown: '# 本书规则\n',
}
check('book rules valid', validateBookRules(rules).version === '2')
rejects('book rules reject version 1', 'artifact-invalid', () => validateBookRules({ ...rules, version: '1' }))

const roles = { roles: [{ name: '甲', tier: 'major', role: '主角', want: '救父', fear: '失去', limit: '不杀人', voice: '短句' }] }
check('roles index valid', validateRolesIndex(roles).roles.length === 1)
rejects('roles index rejects duplicate names', 'artifact-invalid',
  () => validateRolesIndex({ roles: [...roles.roles, ...roles.roles] }))
const card = { slug: 'jia', name: '甲', tier: 'major', motivation: '救父', knowledge: '知道账本存在', relationshipPressure: '掌柜欠人情', limits: '不杀人', arc: '学会求助', markdown: '# 甲\n' }
check('role card valid', validateRoleCard(card).slug === 'jia')
rejects('role card does not duplicate six fields', 'artifact-invalid',
  () => validateRoleCard({ ...card, want: '救父' }))
rejects('role card needs a slug', 'artifact-invalid', () => validateRoleCard({ ...card, slug: '' }))

check('chapter memo valid', validateChapterMemo(memo).threadRefs[0] === 'h_1')
rejects('chapter memo rejects missing goal', 'artifact-invalid', () => validateChapterMemo({ ...memo, goal: '' }))
const meta = { number: 1, title: '一', wordCount: 3200, stage: 'written', planApprovedAt: 'now', planRevision: 'hash', provenance: 'generated', observationIds: ['review:1:2:1'] }
check('chapter meta valid', validateChapterMeta(meta).stage === 'written')
rejects('chapter meta rejects clean stage', 'artifact-invalid', () => validateChapterMeta({ ...meta, stage: 'clean' }))
check('summary valid', validateChapterSummary(summary).bodyRevision === 2)
rejects('summary needs bodyRevision', 'artifact-invalid', () => validateChapterSummary({ ...summary, bodyRevision: 0 }))

check('observation valid', validateObservation(observation).sourceRefs.length === 1)
rejects('observation needs source quote', 'artifact-invalid',
  () => validateObservation({ ...observation, sourceRefs: [{ sourceId: 'chapter:1' }] }))
rejects('observation needs at least one source ref', 'artifact-invalid',
  () => validateObservation({ ...observation, sourceRefs: [] }))
rejects('observation rejects unknown severity', 'artifact-invalid',
  () => validateObservation({ ...observation, severity: 'critical' }))
check('review observations valid', validateReviewObservations({ observations: [observation] }).observations.length === 1)
rejects('review observations reject a missing quote', 'artifact-invalid',
  () => validateReviewObservations({ observations: [{ ...observation, sourceRefs: [{ sourceId: 'chapter:1' }] }] }))
check('review envelope valid', validateArtifactEnvelope({
  workId: '书', artifactId: 'review:1:r2:1', kind: 'review', scope: { chapter: 1 },
  revisionId: 'hash', content: { observations: [observation] }, provenance: 'generated', createdAt: 'now',
}).artifactId === 'review:1:r2:1')
rejects('review identity needs matching scope', 'artifact-invalid', () => validateArtifactRecord({
  workId: '书', artifactId: 'review:1:r2:1', kind: 'review', scope: { chapter: 2 },
  revisionId: 'hash', content: { observations: [] }, provenance: 'generated', createdAt: 'now',
}))
rejects('review identity rejects an incomplete ID', 'artifact-invalid', () => validateArtifactRecord({
  workId: '书', artifactId: 'review:1', kind: 'review', scope: { chapter: 1 },
  revisionId: 'hash', content: { observations: [] }, provenance: 'generated', createdAt: 'now',
}))

check('hook valid', validateHook(hook).hookId === 'h_1')
rejects('hook rejects bad transition helper', 'hook-transition-invalid', () => assertHookTransition('resolved', 'open'))
check('hook transition open to progressing', assertHookTransition('open', 'progressing') === 'progressing')
rejects('hook rejects lastAdvanced before start', 'artifact-invalid',
  () => validateHook({ ...hook, lastAdvancedChapter: -1 }))

check('fact valid', validateFact(fact).object === '账本')
rejects('fact rejects negative validity', 'artifact-invalid',
  () => validateFact({ ...fact, validUntilChapter: 0 }))

const source = { source: 'summary:1', reason: '本章涉及', protection: 'compressible', excerpt: '甲换账本' }
check('context source valid', validateContextSource(source).protection === 'compressible')
check('context package valid', validateContextPackage({ chapter: 1, selectedContext: [source] }).selectedContext.length === 1)
rejects('context package needs a source', 'artifact-invalid',
  () => validateContextPackage({ chapter: 1, selectedContext: [] }))
const trace = {
  chapter: 1, plannerInputs: ['outline'], composerInputs: ['summary:1'], selectedSources: ['summary:1'],
  contextTiers: { protectedSources: ['bible:book_rules'], compressibleSources: ['summary:1'] },
  tokenBudget: { protectedTokens: 10, compressibleTokens: 20, totalSelectedTokens: 30 },
  notes: [], sections: [{ name: 'summary', protection: 'compressible', sourceIds: ['summary:1'] }],
  trimmed: [], dropped: [], budget: { limit: 100, used: 30, unit: 'characters' },
}
check('chapter trace valid', validateChapterTrace(trace).tokenBudget.totalSelectedTokens === 30)
rejects('trace rejects negative tokens', 'artifact-invalid',
  () => validateChapterTrace({ ...trace, tokenBudget: { ...trace.tokenBudget, totalSelectedTokens: -1 } }))

const short = {
  storyTitle: '短篇', openingHook: '开头', chapters: [{ number: 1, title: '一', content: '正文', charCount: 2 }],
  rawContent: '正文', outline: '大纲', draftReview: '审稿', revisionPlan: '修订',
  salesPackage: { title: '短篇', intro: '简介', sellingPoints: ['卖点'], coverPrompt: '封面' },
  measurements: { chapterCount: 1, totalLength: 2, unit: 'non-whitespace-characters', openingHookLength: 2, chapterLengths: [{ number: 1, length: 2 }] },
}
check('short story valid', validateShortStory(short).chapters.length === 1)
rejects('short story rejects duplicate chapters', 'artifact-invalid',
  () => validateShortStory({ ...short, chapters: [...short.chapters, { ...short.chapters[0] }] }))

const script = {
  title: '剧本', targetFormat: 'vertical_short_drama', episodeCount: 2, episodeDuration: '60s',
  spec: '规格', script: '剧本',
  episodes: [{ number: 1, title: '一', scenes: [{ slug: '1-1', location: '当铺', time: '夜', action: '甲进门', dialogue: [] }] }],
}
check('script valid', validateScript(script).episodes.length === 1)
rejects('script rejects bad format', 'artifact-invalid', () => validateScript({ ...script, targetFormat: 'novel' }))

const envelope = { workId: '书', artifactId: 'plan:1', kind: 'plan', scope: { chapter: 1 }, revisionId: 'hash', content: memo, provenance: 'generated', createdAt: 'now' }
check('envelope valid', validateArtifactEnvelope(envelope).artifactId === 'plan:1')
rejects('envelope rejects paths', 'artifact-invalid', () => validateArtifactEnvelope({ ...envelope, artifactId: 'works/书/plan' }))
rejects('envelope rejects scalar content', 'artifact-invalid', () => validateArtifactEnvelope({ ...envelope, content: 42 }))
rejects('envelope rejects unknown kind', 'artifact-invalid', () => validateArtifactEnvelope({ ...envelope, kind: 'bible' }))
rejects('envelope requires chapter scope', 'artifact-invalid', () => validateArtifactEnvelope({ ...envelope, scope: {} }))
rejects('envelope rejects legacy field', 'artifact-invalid', () => validateArtifactEnvelope({ ...envelope, verification: 'unverified' }))

if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
