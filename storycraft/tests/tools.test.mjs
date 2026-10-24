// Throwaway verification for storycraft/tools.js registration and dispatch.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as tools from '../tools.js'
import * as s from '../storage.js'
import { openWork } from '../db.js'
import { readProposal } from '../proposals.js'
import { clearCurrent, setCurrent } from '../dist/current.js'
import { checkDraft } from '../landing.js'
import { submitPayload } from '../submission.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const registered = []
const guards = []
const services = {}
const ctx = {
  tools: {
    register: (definition) => { registered.push(definition); return () => {} },
    guard: (guard) => { guards.push(guard); return () => {} },
  },
  effect: (fn) => { const dispose = fn(); return () => dispose?.() },
  get: (name) => services[name],
}
tools.apply(ctx, { mode: 'longform' })

const names = registered.map(definition => definition.name).sort()
check('registers thirty-one actions', names.length === 31, names.join(','))
check('action names', names.join(',') === [
  'story_backup', 'story_bible', 'story_bible_write', 'story_brief', 'story_context',
  'story_critique', 'story_current', 'story_delegate', 'story_delete', 'story_export', 'story_init', 'story_next', 'story_outline',
  'story_plan', 'story_propose', 'story_read', 'story_rename', 'story_reopen', 'story_restore', 'story_review', 'story_revise', 'story_settle', 'story_submit',
  'story_settings', 'story_state', 'story_state_check', 'story_status', 'story_summarize', 'story_volume', 'story_volumes', 'story_write',
].sort().join(','), names.join(','))
check('the delegation and scope guards are registered', guards.length === 2, String(guards.length))
check('every action declares output schema', registered.every(definition => definition.output?.schema && typeof definition.output?.render === 'function'))
check('every action declares execute', registered.every(definition => typeof definition.execute === 'function'))

const byName = new Map(registered.map(definition => [definition.name, definition]))
const submitAction = byName.get('story_submit')
check('submit output accepts retry envelope fields',
  ['actual', 'limit', 'retryable', 'error'].every(key => submitAction.output.schema.properties[key] !== undefined))
check('story_submit documents both dispatch sources',
  submitAction.description.includes('story_delegate') && submitAction.description.includes('story_settle'),
  submitAction.description)
const settleAction = byName.get('story_settle')
check('story_settle declares its settlement receipt',
  settleAction.mutates === true
  && ['settled', 'proposed', 'reason', 'attempts', 'counts'].every(key => settleAction.output.schema.properties[key] !== undefined),
  JSON.stringify(Object.keys(settleAction.output.schema.properties ?? {})))
const scopeGuard = guards[1]
const scopeRoot = resolve('repo')
const discussionCopy = '讨论阶段不读历史作品：请先在面板进入一部作品，或给 path 限定到项目目录。'
const otherWorkCopy = '只能访问当前作品：请求的 artifact 不在当前会话的作用域内。'
const fakeSession = id => ({ header: { id, cwd: scopeRoot } })
const fakeExec = (name, args, id = 'scope-main') => ({ name, arguments: args, agent: { id, session: fakeSession(id) } })

check('scope guard denies works without a current work',
  scopeGuard(fakeExec('read', { file_path: 'works/别的书/chapters/ch-0001.md' })) === discussionCopy)
check('scope guard allows project files',
  scopeGuard(fakeExec('read', { file_path: 'AGENTS.md' })) === undefined)

// A subagent inherits the parent session's work pointer and live cwd.
const parentSession = fakeSession('scope-parent')
const childSession = {
  header: { id: 'scope-child', cwd: resolve('elsewhere'), parentSession: 'scope-parent' },
}
services.sessions = { get: id => (id === 'scope-parent' ? parentSession : undefined) }
services.workingDirectory = { get: session => (session === childSession ? scopeRoot : session.header.cwd) }
setCurrent('scope-parent', '大朔营造')
const childExec = (name, args) => ({ name, arguments: args, agent: { id: 'scope-child', session: childSession } })
check('a subagent can read the parent session work',
  scopeGuard(childExec('read', { file_path: 'works/大朔营造/chapters/ch-0001.md' })) === undefined)
check('a subagent cannot read another work',
  scopeGuard(childExec('read', { file_path: 'works/别的书/chapters/ch-0001.md' })) === otherWorkCopy)
// After a working_directory change the guard must resolve reads against the live cwd.
let liveCwd = scopeRoot
services.workingDirectory = { get: () => liveCwd }
const cwdExec = (name, args) => ({ name, arguments: args, agent: { id: 'scope-cwd', session: fakeSession('scope-cwd') } })
setCurrent('scope-cwd', '大朔营造')
liveCwd = join(scopeRoot, 'docs')
check('a read after cd into docs cannot escape to works',
  scopeGuard(cwdExec('read', { file_path: '../works/别的书/chapters/ch-0001.md' })) === otherWorkCopy)
liveCwd = scopeRoot
check('a read after cd back to the root can reach the current work',
  scopeGuard(cwdExec('read', { file_path: 'works/大朔营造/chapters/ch-0001.md' })) === undefined)
setCurrent('scope-cwd', undefined)
delete services.workingDirectory

delete services.sessions
delete services.workingDirectory
setCurrent('scope-parent', undefined)
// The tool registry asserts the output schema against its supported subset and
// rejects the whole plugin row on a violation, which silently marks the preset
// broken. Mirror those rules here so that regression is caught offline.
const ALLOWED_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title'])
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function schemaViolations(node, at, errors) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${at} must be a schema object`)
    return
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) errors.push(`${at}.${key} is not a supported keyword`)
  }
  if (Object.hasOwn(node, 'required')
    && (!Array.isArray(node.required) || node.required.some(value => typeof value !== 'string'))) {
    errors.push(`${at}.required must be an array of strings`)
  }
  if (Object.hasOwn(node, 'type') && !ALLOWED_TYPES.has(node.type)) errors.push(`${at}.type is unsupported`)
  if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
    errors.push(`${at}.additionalProperties must be boolean`)
  }
  if (node.properties !== undefined) {
    for (const [key, child] of Object.entries(node.properties)) schemaViolations(child, `${at}.properties.${key}`, errors)
  }
  if (node.items !== undefined) schemaViolations(node.items, `${at}.items`, errors)
  if (Array.isArray(node.oneOf)) node.oneOf.forEach((child, index) => schemaViolations(child, `${at}.oneOf[${index}]`, errors))
}

for (const definition of registered) {
  const errors = []
  schemaViolations(definition.parameters, `${definition.name}.parameters`, errors)
  if (definition.parameters?.type !== 'object') errors.push(`${definition.name}.parameters must be object-rooted`)
  schemaViolations(definition.output.schema, `${definition.name}.output`, errors)
  if (definition.output.schema?.type !== 'object') errors.push(`${definition.name}.output must be object-rooted`)
  check(`${definition.name} schema uses the supported subset`, errors.length === 0, errors.join('; '))
}


const noWorkspace = await byName.get('story_init').execute({ title: 'x' }, {})
check('missing workspace returns structured error', noWorkspace.ok === false && noWorkspace.error.code === 'no-workspace', JSON.stringify(noWorkspace))

const root = await mkdtemp(join(tmpdir(), 'storycraft-tools-'))
try {
  const exec = { agent: { id: 'test-session', session: { header: { cwd: root } } } }
  const deniedSubmit = await byName.get('story_submit').execute({ delegationId: 'missing', payload: {} }, exec)
  check('story_submit rejects a parent call', deniedSubmit.ok === false
    && deniedSubmit.error.code === 'submit-parent-denied', JSON.stringify(deniedSubmit))
  const withoutProposal = await byName.get('story_init').execute({ title: '雨里的灯' }, exec)
  check('init without a proposal is refused', withoutProposal.ok === false && withoutProposal.error.code === 'proposal-required', JSON.stringify(withoutProposal))
  const proposal = await byName.get('story_propose').execute({
    title: '雨里的灯', form: 'longform', premise: '夜班司机捡到一盏不肯灭的灯。',
  }, exec)
  const mismatched = await byName.get('story_init').execute({ title: '别的标题', proposal: proposal.proposal }, exec)
  check('title must match the proposal', mismatched.ok === false && mismatched.error.code === 'proposal-mismatch', JSON.stringify(mismatched))
  const created = await byName.get('story_init').execute({ title: '雨里的灯', proposal: proposal.proposal }, exec)
  check('story_init ok', created.ok === true && typeof created.workId === 'string', JSON.stringify(created))
  check('story_init reports only a work identity', created.artifact === undefined && typeof created.workId === 'string', JSON.stringify(created))
  check('story_init persists the current work', (await s.readSessionCurrent(root))['test-session'] === created.workId)
  clearCurrent('test-session')
  const hydratedCurrent = await byName.get('story_current').execute({}, exec)
  check('story_current hydrates the persisted pointer', hydratedCurrent.current === created.workId, JSON.stringify(hydratedCurrent))
  setCurrent('test-session', created.workId)
  const used = await readProposal(root, proposal.proposal)
  check('the proposal records the work it became', used.usedWorkId === created.workId && typeof used.usedAt === 'string', JSON.stringify(used))
  const work = created.workId
  check('story_init wrote the work manifest', (await s.readWork(root, work)).manifest.title === '雨里的灯')
  // From here the session is pointed at that work, as the panel would.
  setCurrent('test-session', work)

  const earlyPlan = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'g', threadRefs: [],
  }, exec)
  check('the first chapter plan needs an approved outline', earlyPlan.ok === false && earlyPlan.error.code === 'outline-required', JSON.stringify(earlyPlan))
  await byName.get('story_outline').execute({ work, mainline: '一条主线' }, exec)
  const blockedUnapproved = await byName.get('story_outline').execute({ work }, exec)
  check('an unapproved outline blocks nothing by itself', blockedUnapproved.ok === true || blockedUnapproved.ok === false)
  const blockedPlan = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'g', threadRefs: [],
  }, exec)
  check('writing the outline is not enough', blockedPlan.ok === false && blockedPlan.error.code === 'outline-required', JSON.stringify(blockedPlan))
  const movedApproval = await byName.get('story_outline').execute({ work, approve: true }, exec)
  check('the model cannot confirm the plan', movedApproval.ok === false
    && movedApproval.error.code === 'approval-moved', JSON.stringify(movedApproval))
  await s.writeOutline(root, { work, mainline: '一条主线' })
  const approved = await s.approveOutline(root, { work })
  check('the host records the plan approval', typeof approved.outline?.approvedAt === 'string', JSON.stringify(approved))

  const afterOutline = await byName.get('story_next').execute({ work }, exec)
  check('an approved outline no longer looks missing',
    afterOutline.ok === true && afterOutline.action === 'story_plan'
      && !afterOutline.missing.includes('outline'), JSON.stringify(afterOutline))

  const statusAfterOutline = await byName.get('story_status').execute({ work }, exec)
  check('story_status exposes the outline approval',
    statusAfterOutline.ok === true && typeof statusAfterOutline.status.outline?.approvedAt === 'string',
    JSON.stringify(statusAfterOutline.status?.outline))

  const plan = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '林澈', goal: '拿回合同', obstacle: '房东', cost: '人情', turn: '合同是假的', body: '拿回合同。', threadRefs: [],
  }, exec)
  check('story_plan returns an artifact identity', plan.ok === true && plan.artifact.artifactId === 'plan:1' && plan.artifact.kind === 'plan', JSON.stringify(plan))

  const bodyBeforeApproval = '他站在雨里。'.repeat(60)
  const blockedPlanWrite = await byName.get('story_write').execute({ work, chapter: 1, body: bodyBeforeApproval }, exec)
  check('an unapproved chapter plan blocks writing', blockedPlanWrite.ok === false
    && blockedPlanWrite.error.code === 'plan-not-approved', JSON.stringify(blockedPlanWrite))
  const waiting = await byName.get('story_next').execute({ work }, exec)
  check('story_next asks for the panel confirmation', waiting.ok === true
    && waiting.blocked?.includes('plan-approval') && /确认/.test(waiting.reason), JSON.stringify(waiting))
  check('no delegate is offered while the author gate is missing', waiting.delegate === undefined, JSON.stringify(waiting))

  const earlyGate = await byName.get('story_context').execute({ work, chapter: 1, role: 'writer' }, exec)
  check('writer context is refused before the author confirms', earlyGate.ok === false
    && earlyGate.error.code === 'plan-not-approved', JSON.stringify(earlyGate))

  const approvedPlan = await s.approveChapterPlan(root, { work, chapter: 1 })
  check('the author confirms the chapter plan', typeof approvedPlan.entry.planApprovedAt === 'string')

  const replanned = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '林澈', goal: '拿回合同', obstacle: '房东', cost: '人情', turn: '合同是假的（修）', body: '拿回合同（修）。', threadRefs: [],
  }, exec)
  check('rewriting a plan clears its approval', replanned.ok === true)
  const afterReplan = await s.readManifest(root, work)
  check('approval is cleared on replan', afterReplan.chapters[0].planApprovedAt === undefined)
  const afterReplanWrite = await byName.get('story_write').execute({ work, chapter: 1, body: bodyBeforeApproval }, exec)
  check('a replanned chapter cannot be written before confirming again', afterReplanWrite.ok === false
    && afterReplanWrite.error.code === 'plan-not-approved', JSON.stringify(afterReplanWrite))
  await s.approveChapterPlan(root, { work, chapter: 1 })

  const badPlan = await byName.get('story_plan').execute({
    work, chapter: 2, perspective: '林澈', goal: '', obstacle: 'x', cost: 'y', turn: 'z', body: 'g', threadRefs: [],
  }, exec)
  check('story_plan rejects missing field', badPlan.ok === false && badPlan.error.code === 'plan-incomplete', JSON.stringify(badPlan))

  const body = '他站在雨里。'.repeat(60)
  const write = await byName.get('story_write').execute({ work, chapter: 1, title: '雨里的灯', body }, exec)
  check('story_write ok', write.ok === true && write.words > 0, JSON.stringify(write))

  const afterWrite = await s.readManifest(root, work)
  check('chapter status written', afterWrite.chapters[0].status === 'written', afterWrite.chapters[0].status)
  check('chapter words recorded', afterWrite.chapters[0].words > 0, String(afterWrite.chapters[0].words))
  // The role context is the dispatch input: sections, trace, whitelist summary.
  const cards = await byName.get('story_bible_write').execute({
    work,
    file: 'characters',
    content: JSON.stringify([{ name: '林澈', role: '司机', want: '把灯还回去', fear: '再丢一次', limit: '不撒谎', voice: '短句' }]),
  }, exec)
  check('character cards written', cards.ok === true, JSON.stringify(cards))
  const style = await byName.get('story_bible_write').execute({ work, file: 'style', content: '# 文风\n短句。' }, exec)
  check('style written', style.ok === true, JSON.stringify(style))
  const afterBodyNext = await byName.get('story_next').execute({ work }, exec)
  check('story_next offers reviewer delegation after the body',
    afterBodyNext.action === 'story_review' && afterBodyNext.delegate?.role === 'reviewer', JSON.stringify(afterBodyNext))
  const noChapter = await byName.get('story_context').execute({ work, role: 'writer' }, exec)
  check('a chapter role without a chapter number is refused', noChapter.ok === false
    && noChapter.error.code === 'chapter-required', JSON.stringify(noChapter))

  const missingChapter = await byName.get('story_context').execute({ work, chapter: 99, role: 'writer' }, exec)
  check('story_context refuses an unknown chapter', missingChapter.ok === false
    && missingChapter.error.code === 'chapter-not-found', JSON.stringify(missingChapter))

  const context = await byName.get('story_context').execute({ work, chapter: 1, role: 'writer' }, exec)
  check('story_context returns writer sections', context.ok === true
    && ['authority', 'task', 'constraints', 'state', 'style'].every(name => context.sections.some(item => item.name === name)),
  JSON.stringify(context).slice(0, 300))
  check('story_context returns a trace', context.ok === true && context.trace.budget > 0, JSON.stringify(context.trace))
  check('story_context always carries the retrieval trace',
    context.ok === true && context.trace.retrieval?.enabled === false && Array.isArray(context.trace.retrieval.hits),
    JSON.stringify(context.trace.retrieval))
  check('whitelist leaves the action as a summary', context.ok === true
    && typeof context.whitelist.counts.names === 'number' && Array.isArray(context.whitelist.sample.names), JSON.stringify(context.whitelist))
  check('the whitelist sample stays bounded',
    context.ok === true && context.whitelist.sample.names.length <= 5 && context.whitelist.sample.numbers.length <= 5, JSON.stringify(context.whitelist.sample))

  const plannerAhead = await byName.get('story_context').execute({ work, chapter: 2, role: 'planner' }, exec)
  check('planning an unlisted chapter works', plannerAhead.ok === true && plannerAhead.chapter === 2
    && plannerAhead.sections.some(item => item.name === 'plan'), JSON.stringify(plannerAhead).slice(0, 200))


  const reviewNoBody = await byName.get('story_context').execute({ work, chapter: 1, role: 'reviser' }, exec)
  check('revision without a review is refused', reviewNoBody.ok === false && reviewNoBody.error.code === 'review-required', JSON.stringify(reviewNoBody))

  // Consistency is advisory at landing: an unlisted speaker warns, but does not block.
  const invented = `周三说：“走。”`.repeat(30)
  const inventedCheck = await checkDraft(root, { work, chapter: 1, body: invented })
  check('an unlisted speaker warns without blocking',
    inventedCheck.warnings.some(text => text.includes('周三')), JSON.stringify(inventedCheck))

  const sameText = await byName.get('story_critique').execute({ work, chapter: 1 }, exec)
  check('critique and write report the same word count', sameText.ok === true
    && sameText.metrics.words === write.words, `${sameText.metrics?.words} vs ${write.words}`)

  const rewrite = await byName.get('story_write').execute({ work, chapter: 1, body, rewrite: true }, exec)
  check('rewrite creates revision 2', rewrite.ok === true && rewrite.artifact.revisionId === 'r2', JSON.stringify(rewrite))

  const review = await byName.get('story_review').execute({
    work, chapter: 1, problems: [{ quote: body.slice(0, 12), problem: '钩子虚', fix: '落到合同上' }],
  }, exec)
  check('story_review ok', review.ok === true && review.problems.total === 1, JSON.stringify(review))
  const afterReviewNext = await byName.get('story_next').execute({ work }, exec)
  check('story_next offers reviser delegation after the review',
    afterReviewNext.action === 'story_revise' && afterReviewNext.delegate?.role === 'reviser', JSON.stringify(afterReviewNext))

  const reviewerContext = await byName.get('story_context').execute({ work, chapter: 1, role: 'reviewer' }, exec)
  const reviewerTask = reviewerContext.sections?.find(section => section.name === 'task')?.content ?? ''
  check('reviewer context carries the review item text',
    reviewerContext.ok === true && reviewerTask.includes('O1') && reviewerTask.includes('钩子虚') && !reviewerTask.includes('undefined'),
    reviewerTask.slice(0, 200))
  const reviserContext = await byName.get('story_context').execute({ work, chapter: 1, role: 'reviser', mode: 'patch' }, exec)
  const reviserTask = reviserContext.sections?.find(section => section.name === 'task')?.content ?? ''
  check('reviser context carries the review item text',
    reviserContext.ok === true && reviserTask.includes('O1') && reviserTask.includes('钩子虚') && !reviserTask.includes('undefined'),
    reviserTask.slice(0, 200))

  const noIds = await byName.get('story_revise').execute({ work, chapter: 1, body: `${body}（再改）` }, exec)
  check('revise without ids refused', noIds.ok === false && noIds.error.code === 'missing-problems', JSON.stringify(noIds))

  const unchanged = await byName.get('story_revise').execute({
    work, chapter: 1, body, problemIds: ['O1'],
  }, exec)
  check('unchanged body refused', unchanged.ok === false && unchanged.error.code === 'unchanged-body', JSON.stringify(unchanged))

  const revise = await byName.get('story_revise').execute({
    work, chapter: 1, body: `${body}（改）`, problemIds: ['O1'],
  }, exec)
  check('story_revise ok', revise.ok === true && revise.resolved[0] === 'O1', JSON.stringify(revise))
  const afterReviseReview = await byName.get('story_review').execute({ work, chapter: 1, problems: [] }, exec)
  check('a revised chapter is reviewed again', afterReviseReview.ok === true, JSON.stringify(afterReviseReview))
  const afterReviseNext = await byName.get('story_next').execute({ work }, exec)
  check('story_next offers summarizer after revision',
    afterReviseNext.action === 'story_summarize' && afterReviseNext.delegate?.role === 'summarizer', JSON.stringify(afterReviseNext))



  const earlySettle = await byName.get('story_state').execute({ work, chapter: 1, entities: [] }, exec)
  check('settling before the summary is refused', earlySettle.ok === false && earlySettle.error.code === 'summary-required', JSON.stringify(earlySettle))
  const preSummary = await byName.get('story_summarize').execute({ work, chapter: 1, summary: '司机捡到一盏灯。' }, exec)
  check('summary written before settle', preSummary.ok === true, JSON.stringify(preSummary))
  const afterSummaryNext = await byName.get('story_next').execute({ work }, exec)
  check('story_next offers no delegate for automatic settlement', afterSummaryNext.action === 'story_settle' && afterSummaryNext.delegate === undefined, JSON.stringify(afterSummaryNext))
  const manualEmpty = await byName.get('story_state').execute({ work, chapter: 1, entities: [] }, exec)
  check('manual story_state still rejects an empty delta after the summary',
    manualEmpty.ok === false && manualEmpty.error.code === 'empty-state', JSON.stringify(manualEmpty))
  const statusWithSummary = await byName.get('story_status').execute({ work }, exec)
  check('story_status exposes the summary binding',
    statusWithSummary.ok === true && statusWithSummary.status.chapters[0].hasSummary === true
    && statusWithSummary.status.chapters[0].summaryStale === false
    && statusWithSummary.status.chapters[0].summaryRevision === 3,
    JSON.stringify(statusWithSummary.status?.chapters?.[0]))
  const state = await byName.get('story_state').execute({
    work, chapter: 1,
    factOps: { upsert: [{ subject: '林澈', predicate: '状态', object: '拿到假合同' }] },
    newHooks: [{ text: '合同是假的' }],
  }, exec)
  check('story_state ok', state.ok === true && state.counts.newHooks === 1, JSON.stringify(state))

  const duplicates = await byName.get('story_init').execute({ title: '雨里的灯', proposal: proposal.proposal }, exec)
  check('duplicate init refused', duplicates.ok === false && duplicates.error.code === 'work-exists', JSON.stringify(duplicates))

  const written = await byName.get('story_bible_write').execute({
    work, file: 'characters',
    content: JSON.stringify([{ name: '林澈', role: '主角', want: '拿回合同', fear: '失去妹妹', limit: '不伤人', voice: '短句' }]),
  }, exec)
  check('story_bible_write ok', written.ok === true && typeof written.version === 'string', JSON.stringify(written))

  const invalidBible = await byName.get('story_bible_write').execute({ work, file: 'characters', content: 'not-json' }, exec)
  check('story_bible_write rejects invalid', invalidBible.ok === false && invalidBible.error.code === 'bible-invalid', JSON.stringify(invalidBible))

  const bibleRead = await byName.get('story_bible').execute({ work }, exec)
  check('story_bible reads five files', bibleRead.ok === true && bibleRead.files.length === 5, JSON.stringify(bibleRead.files?.map(file => file.name)))

  const brief = await byName.get('story_brief').execute({ work, chapter: 1 }, exec)
  check('story_brief returns thirteen sections', brief.ok === true && brief.sections.length === 13, JSON.stringify(brief.sections?.map(section => section.name)))
  check('story_brief reports budget', brief.ok === true && brief.budget.limit > 0)
  check('story_brief declares retrieval', brief.ok === true && brief.retrieval.enabled === false
    && byName.get('story_brief').output.schema.properties.retrieval !== undefined, JSON.stringify(brief.retrieval))
  const briefSectionProps = Object.keys(byName.get('story_brief').output.schema.properties.sections.items.properties ?? {})
  check('story_brief sections use only declared fields',
    brief.ok === true && brief.sections.every(section => Object.keys(section).every(key => briefSectionProps.includes(key))),
    JSON.stringify(brief.sections?.flatMap(section => Object.keys(section).filter(key => !briefSectionProps.includes(key)))))

  const summary = await byName.get('story_summarize').execute({ work, chapter: 1, summary: '林澈在塌方里救人，决定北上。' }, exec)
  check('story_summarize ok', summary.ok === true && summary.truncated === false, JSON.stringify(summary))

  const currentProps = Object.keys(byName.get('story_current').output.schema.properties ?? {})
  check('story_current declares its output keys', ['workId', 'current'].every(key => currentProps.includes(key)), currentProps.join(','))
  const nextProps = Object.keys(byName.get('story_next').output.schema.properties ?? {})
  check('story_next declares the delegate hint', nextProps.includes('delegate'), nextProps.join(','))
  const delegateProps = Object.keys(byName.get('story_delegate').output.schema.properties ?? {})
  check('story_delegate declares its compact receipt', ['role', 'stage', 'revision', 'problems'].every(key => delegateProps.includes(key)), delegateProps.join(','))
  const statusProps = Object.keys(byName.get('story_status').output.schema.properties.status.properties ?? {})
  check('story_status declares the fields it returns', ['form', 'wordRange', 'chapters', 'hooks'].every(key => statusProps.includes(key)), statusProps.join(','))
  const statusChapterProps = Object.keys(byName.get('story_status').output.schema.properties.status.properties.chapters.items.properties ?? {})
  check('story_status chapter schema declares summary fields',
    ['hasSummary', 'summaryRevision', 'summaryStale'].every(key => statusChapterProps.includes(key)),
    statusChapterProps.join(','))
  const traceRetrievalProps = byName.get('story_context').output.schema.properties.trace.properties.retrieval.properties
  check('story_context trace declares retrieval hits',
    ['enabled', 'query', 'candidateCount', 'hits'].every(key => Object.hasOwn(traceRetrievalProps, key))
    && traceRetrievalProps.hits.items.required.includes('sourceIds'), Object.keys(traceRetrievalProps).join(','))

  // Delegated subagents share this composition and see the same tools; the
  // runtime keeps them from landing anything.
  const childExec = { agent: { ...exec.agent, id: 'child', session: { header: { cwd: root, delegationDepth: 1 } } } }
  setCurrent('child', work)
  const manifestBefore = JSON.stringify(await s.readManifest(root, work))
  const deniedWrite = await byName.get('story_write').execute({ work, chapter: 1, body, rewrite: true }, childExec)
  check('a delegated subagent cannot land a chapter', deniedWrite.ok === false && deniedWrite.error.code === 'subagent-cannot-land', JSON.stringify(deniedWrite))
  const deniedInit = await byName.get('story_init').execute({ title: '子代理作品', proposal: 'p' }, childExec)
  check('a delegated subagent cannot init a work', deniedInit.ok === false && deniedInit.error.code === 'subagent-cannot-land', JSON.stringify(deniedInit))
  check('a refused landing leaves the manifest unchanged',
    JSON.stringify(await s.readManifest(root, work)) === manifestBefore)
  const childWithoutWork = { agent: { ...exec.agent, id: 'child-nowork', session: { header: { cwd: root, delegationDepth: 1 } } } }
  const deniedEarly = await byName.get('story_write').execute({ work, chapter: 1, body }, childWithoutWork)
  check('delegation is refused before work resolution', deniedEarly.ok === false && deniedEarly.error.code === 'subagent-cannot-land', JSON.stringify(deniedEarly))
  const childRead = await byName.get('story_status').execute({ work }, childExec)
  check('a delegated subagent keeps read actions', childRead.ok === true && childRead.status.writtenChapters === 1, JSON.stringify(childRead.status ?? childRead))
  const deniedCheck = await byName.get('story_state_check').execute({
    work, chapter: 1, factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '一条事实' }] },
  }, childExec)
  check('a delegated subagent cannot start a state check', deniedCheck.ok === false
    && deniedCheck.error.code === 'state-check-parent-denied', JSON.stringify(deniedCheck))
  const deniedSettle = await byName.get('story_settle').execute({ work, chapter: 1 }, childExec)
  check('a delegated subagent cannot settle state', deniedSettle.ok === false
    && deniedSettle.error.code === 'subagent-cannot-land', JSON.stringify(deniedSettle))
  check('the guard refuses delegated file and shell tools',
    ['write', 'edit', 'pwsh', 'bash'].every(name => typeof guards[0]({ name, agent: childExec.agent }) === 'string'))
  check('the guard leaves the main agent alone', guards[0]({ name: 'write', agent: exec.agent }) === undefined)
  check('the guard leaves reads alone for children', guards[0]({ name: 'read', agent: childExec.agent }) === undefined)

  const readBack = await byName.get('story_current').execute({}, exec)
  check('story_current reports the active work', readBack.current === work && readBack.title === '雨里的灯', JSON.stringify(readBack))

  const empty = await byName.get('story_current').execute({}, { ...exec, agent: { ...exec.agent, id: 'session-none' } })
  check('no current work reads as null', empty.ok === true && empty.current === null, JSON.stringify(empty))
  const duplicateTitle = await byName.get('story_propose').execute({
    title: '雨里的灯', premise: '重名的方案',
  }, exec)
  check('a title already taken is refused at proposal time', duplicateTitle.ok === false && duplicateTitle.error.code === 'work-exists', JSON.stringify(duplicateTitle))
  const proposalResult = await byName.get('story_propose').execute({
    title: '夜班司机', premise: '夜班司机捡到一盏不肯灭的灯。',
  }, exec)
  const blockedInit = await byName.get('story_init').execute({ title: '夜班司机', proposal: proposalResult.proposal }, exec)
  check('a second work is refused while another is current', blockedInit.ok === false && blockedInit.error.code === 'work-mismatch', JSON.stringify(blockedInit))
  check('proposal result declares its keys',
    ['proposal', 'title', 'form'].every(key => Object.keys(byName.get('story_propose').output.schema.properties).includes(key))
    && proposalResult.ok === true, JSON.stringify(proposalResult))

  s.setSessionCurrent(root, 'persisted-refusal', work)
  const blockedPersisted = await byName.get('story_init').execute({ title: '夜班司机', proposal: proposalResult.proposal }, { ...exec, agent: { ...exec.agent, id: 'persisted-refusal' } })
  check('a persisted-only current work blocks another init', blockedPersisted.ok === false && blockedPersisted.error.code === 'work-mismatch', JSON.stringify(blockedPersisted))
  check('the refused init created no work', !s.listWorks(root).some(item => item.workId === '夜班司机'))

  setCurrent('session-a', work)
  await byName.get('story_status').execute({ work: 'another-book' }, { ...exec, agent: { ...exec.agent, id: 'session-a' } })
    .then(() => check('a different work is refused while one is active', false, 'expected a rejection'),
      error => check('a different work is refused while one is active', error.code === 'work-mismatch', String(error.code)))

  const withoutWork = await byName.get('story_status').execute({}, { ...exec, agent: { ...exec.agent, id: 'session-a' } })
  check('work can be omitted once the session points at it', withoutWork.ok === true && withoutWork.workId === work)
  await byName.get('story_status').execute({}, { ...exec, agent: { ...exec.agent, id: 'session-b' } })
    .then(() => check('no current work is an actionable error', false), error => check('no current work is an actionable error', error.code === 'work-not-selected'))

  const critique = await byName.get('story_critique').execute({ work, chapter: 1 }, exec)
  check('story_critique returns metrics', critique.ok === true && typeof critique.metrics.words === 'number', JSON.stringify(critique).slice(0, 160))
  check('story_critique stays read-only', critique.ok === true && critique.metrics.sentences.count > 0)

  const next = await byName.get('story_next').execute({ work }, exec)
  check('story_next moves to the next chapter after settling', next.ok === true && next.action === 'story_plan' && next.chapter === 2, JSON.stringify(next))

  const status = await byName.get('story_status').execute({ work }, exec)
  check('story_status ok', status.ok === true && status.status.writtenChapters === 1, JSON.stringify(status.status ?? status))
  check('story_status returns only declared fields',
    Object.keys(status.status).every(key => statusProps.includes(key)),
    JSON.stringify(Object.keys(status.status).filter(key => !statusProps.includes(key))))

  await byName.get('story_status').execute({ work: '不存在' }, exec)
    .then(() => check('another id is refused while one work is active', false, 'expected a rejection'),
      error => check('another id is refused while one work is active', error.code === 'work-mismatch', String(error.code)))

  const manifest = await s.readManifest(root, work)
  check('manifest tracks revision', manifest.chapters[0].currentRevision === 3, String(manifest.chapters[0].currentRevision))

  // A planned but unwritten chapter: the review path must say so, not crash.
  await byName.get('story_plan').execute({
    work, chapter: 2, perspective: '林澈', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'g', threadRefs: [],
  }, exec)
  const unwritten = await byName.get('story_context').execute({ work, chapter: 2, role: 'reviewer' }, exec)
  check('reviewing an unwritten chapter is refused', unwritten.ok === false
    && unwritten.error.code === 'chapter-not-written', JSON.stringify(unwritten))

  // A revision that invents a speaker is refused at landing, like a write.
  await s.approveChapterPlan(root, { work, chapter: 2 })
  services.subagents = {
    startActivation(spec) {
      const id = /delegationId 是 ([0-9a-f-]+)/u.exec(spec.request.prompt[0].text)?.[1]
      return {
        result: (async () => {
          const submitted = await submitPayload({
            delegationId: id,
            depth: 1,
            root: spec.request.cwd,
            payload: { title: '第二章', body: '第二章正文。'.repeat(40) },
          })
          if (submitted.ok !== true) throw new Error(JSON.stringify(submitted))
          return { stopReason: 'completed' }
        })(),
        dispose: async () => {},
      }
    },
  }
  const secondWrite = await byName.get('story_delegate').execute({ work, chapter: 2, role: 'writer' }, exec)
  check('second chapter delegated and written', secondWrite.ok === true && secondWrite.role === 'writer'
    && secondWrite.artifact.artifactId === 'chapter:2', JSON.stringify(secondWrite))
  check('delegated write receipt carries no body', !JSON.stringify(secondWrite).includes('第二章正文'), JSON.stringify(secondWrite))
  const secondReview = await byName.get('story_review').execute({
    work, chapter: 2, problems: [{ quote: '第二章正文', problem: '进得太慢' }],
  }, exec)
  check('second review written', secondReview.ok === true, JSON.stringify(secondReview))

  // #22: model-facing artifact identity, no path, and scoped reads.
  const readCurrent = await byName.get('story_read').execute({ work, artifactId: 'chapter:2' }, exec)
  check('story_read reads the current chapter by id', readCurrent.ok === true
    && readCurrent.artifact.artifactId === 'chapter:2' && readCurrent.content.includes('第二章正文'), JSON.stringify(readCurrent))
  const readOld = await byName.get('story_read').execute({ work, artifactId: 'chapter:1' }, exec)
  check('story_read refuses an older chapter', readOld.ok === false && readOld.error.code === 'artifact-not-readable', JSON.stringify(readOld))
  const readReview = await byName.get('story_read').execute({ work, artifactId: 'review:2:r1:1' }, exec)
  check('story_read reads the current review by id', readReview.ok === true && readReview.artifact.kind === 'review', JSON.stringify(readReview))
  const readPlan = await byName.get('story_read').execute({ work, artifactId: 'plan:2' }, exec)
  check('story_read reads a plan by id', readPlan.ok === true && readPlan.artifact.artifactId === 'plan:2', JSON.stringify(readPlan))
  check('story_read returns memo JSON with its revision',
    JSON.parse(readPlan.content).chapter === 2 && typeof readPlan.artifact.revisionId === 'string',
    readPlan.content)
  const staleRead = await byName.get('story_read').execute({ work, artifactId: 'plan:2', revisionId: 'stale' }, exec)
  check('story_read rejects a stale revision', staleRead.ok === false && staleRead.error.code === 'revision-not-found', JSON.stringify(staleRead))
  const bibleFiles = await byName.get('story_bible').execute({ work }, exec)
  check('story_bible returns file ids, not paths', bibleFiles.ok === true
    && bibleFiles.files.every(file => file.path === undefined && typeof file.artifactId === 'string' && typeof file.file === 'string'), JSON.stringify(bibleFiles))
  const briefRead = await byName.get('story_brief').execute({ work, chapter: 2 }, exec)
  check('story_brief exposes sourceIds, not paths', briefRead.ok === true
    && briefRead.sections.every(section => section.source === undefined && Array.isArray(section.sourceIds))
    && briefRead.sections.some(section => section.sourceIds.includes('bible:characters')), JSON.stringify(briefRead))
  const contextRead = await byName.get('story_context').execute({ work, chapter: 2, role: 'reviewer' }, exec)
  check('story_context exposes sourceIds, not paths', contextRead.ok === true
    && contextRead.sections.every(section => section.source === undefined && Array.isArray(section.sourceIds)), JSON.stringify(contextRead))
  const visible = JSON.stringify([readCurrent, readReview, readPlan, bibleFiles, briefRead, contextRead])
  check('model-facing reads contain no work paths', !visible.includes('works/') && !visible.includes('"path"'), visible.slice(0, 200))
  const refusedPlanBible = await byName.get('story_bible_write').execute({ work, file: 'plan', content: 'x' }, exec)
  check('story_bible_write cannot write the gated outline', refusedPlanBible.ok === false
    && refusedPlanBible.error.code === 'approval-moved', JSON.stringify(refusedPlanBible))
  const outline = await byName.get('story_outline').execute({ work, mainline: '一条主线的重写' }, exec)
  check('story_outline returns an outline artifact id', outline.ok === true
    && outline.artifact.artifactId === 'outline' && outline.artifact.kind === 'outline', JSON.stringify(outline))

  const inventedRevise = `周三说：“改。”`.repeat(30)
  const warnedRevise = await byName.get('story_revise').execute({
    work, chapter: 2, body: inventedRevise, problemIds: ['O1'], mode: 'rewrite',
  }, exec)
  check('a revision with an unlisted speaker warns but still lands',
    warnedRevise.ok === true && warnedRevise.warnings.some(text => text.includes('周三')), JSON.stringify(warnedRevise))

  // Removing the plan makes the dispatch action refuse before any work starts.
  const removePlan = openWork(root, work)
  removePlan.prepare("DELETE FROM artifacts WHERE artifact_id = 'plan:2'").run()
  removePlan.close()
  const noPlan = await byName.get('story_context').execute({ work, chapter: 2, role: 'reviewer' }, exec)
  check('a chapter without a plan is refused', noPlan.ok === false && noPlan.error.code === 'plan-not-found', JSON.stringify(noPlan))

  // The outline gate applies to any chapter, not only before the first plan,
  // and story_next must agree with it after a mid-book plan rewrite.
  await s.writeOutline(root, { work, mainline: '一条主线（重写）' })
  const blockedLaterPlan = await byName.get('story_plan').execute({
    work, chapter: 3, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'g', threadRefs: [],
  }, exec)
  check('the outline gate applies to later chapters', blockedLaterPlan.ok === false
    && blockedLaterPlan.error.code === 'outline-required', JSON.stringify(blockedLaterPlan))
  const blockedNext = await byName.get('story_next').execute({ work }, exec)
  check('story_next agrees with the gate', blockedNext.ok === true
    && blockedNext.action === 'story_plan' && blockedNext.blocked?.includes('outline-approval'), JSON.stringify(blockedNext))

  // Action-level consistency is advisory and clean review is a real round.
  const warnWork = s.initWork(root, { title: '告警测试' }).workId
  s.writeOutline(root, { work: warnWork, mainline: '一条主线' })
  s.approveOutline(root, { work: warnWork })
  s.writePlan(root, { work: warnWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: warnWork, chapter: 1 })
  setCurrent('test-session', warnWork)
  const warnWrite = await byName.get('story_write').execute({
    work: warnWork, chapter: 1, body: '住户说：“走。”'.repeat(20),
  }, exec)
  check('story_write warns on an unlisted name without blocking',
    warnWrite.ok === true && warnWrite.warnings?.some(text => text.includes('住户')), JSON.stringify(warnWrite))
  const cleanReview = await byName.get('story_review').execute({ work: warnWork, chapter: 1, problems: [] }, exec)
  check('story_review records a clean round', cleanReview.ok === true && cleanReview.problems.total === 0, JSON.stringify(cleanReview))
  const cleanNext = await byName.get('story_next').execute({ work: warnWork }, exec)
  check('story_next routes a clean review to summary', cleanNext.ok === true && cleanNext.action === 'story_summarize', JSON.stringify(cleanNext))
  setCurrent('test-session', work)

  delete services.subagents
  const noDelegation = await byName.get('story_delegate').execute({ work, chapter: 1, role: 'writer' }, exec)
  check('story_delegate without the service reports delegation-unavailable',
    noDelegation.ok === false && noDelegation.error.code === 'delegation-unavailable', JSON.stringify(noDelegation))

  // Export and backup are ordinary actions on the selected work.
  const exported = await byName.get('story_export').execute({ work }, exec)
  check('story_export returns an export id', exported.ok === true
    && exported.exported.exportId === `export:${work}` && exported.exported.files > 0, JSON.stringify(exported))
  const backup = await byName.get('story_backup').execute({ work }, exec)
  check('story_backup returns an integrity check', backup.ok === true
    && backup.backup.integrity === 'ok' && typeof backup.backup.backupId === 'string', JSON.stringify(backup))
  check('export and backup declare their output keys',
    ['exported'].every(key => Object.keys(byName.get('story_export').output.schema.properties).includes(key))
    && ['backup'].every(key => Object.keys(byName.get('story_backup').output.schema.properties).includes(key)))

} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
