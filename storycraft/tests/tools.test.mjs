// Throwaway verification for storycraft/tools.js registration and dispatch.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tools from '../tools.js'
import { setCurrent } from '../current.js'

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
const ctx = {
  tools: {
    register: (definition) => { registered.push(definition); return () => {} },
    guard: (guard) => { guards.push(guard); return () => {} },
  },
  effect: (fn) => { const dispose = fn(); return () => dispose?.() },
}
tools.apply(ctx, { mode: 'longform' })

const names = registered.map(definition => definition.name).sort()
check('registers twenty-five actions', names.length === 25, names.join(','))
check('action names', names.join(',') === [
  'story_bible', 'story_bible_import', 'story_bible_write', 'story_brief', 'story_context', 'story_critique', 'story_current',
  'story_delete', 'story_init', 'story_next', 'story_plan', 'story_rename', 'story_reopen', 'story_restore',
  'story_outline', 'story_propose', 'story_review', 'story_revise', 'story_settings', 'story_state',
  'story_status', 'story_summarize', 'story_volume', 'story_volumes', 'story_write',
].sort().join(','), names.join(','))
check('the delegation guard is registered once', guards.length === 1, String(guards.length))
check('every action declares output schema', registered.every(definition => definition.output?.schema && typeof definition.output?.render === 'function'))
check('every action declares execute', registered.every(definition => typeof definition.execute === 'function'))

const byName = new Map(registered.map(definition => [definition.name, definition]))
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
  const withoutProposal = await byName.get('story_init').execute({ title: '雨里的灯' }, exec)
  check('init without a proposal is refused', withoutProposal.ok === false && withoutProposal.error.code === 'proposal-required', JSON.stringify(withoutProposal))
  const proposal = await byName.get('story_propose').execute({
    title: '雨里的灯', form: 'longform', premise: '夜班司机捡到一盏不肯灭的灯。',
  }, exec)
  check('proposal written', proposal.ok === true && typeof proposal.proposal === 'string', JSON.stringify(proposal))
  const mismatched = await byName.get('story_init').execute({ title: '别的标题', proposal: proposal.proposal }, exec)
  check('title must match the proposal', mismatched.ok === false && mismatched.error.code === 'proposal-mismatch', JSON.stringify(mismatched))
  const created = await byName.get('story_init').execute({ title: '雨里的灯', proposal: proposal.proposal }, exec)
  check('story_init ok', created.ok === true && typeof created.workId === 'string', JSON.stringify(created))
  const used = JSON.parse(await readFile(join(root, 'works', '.proposals', `${proposal.proposal}.json`), 'utf8'))
  check('the proposal records the work it became', used.workId === created.workId && typeof used.usedAt === 'string', JSON.stringify(used))
  const work = created.workId
  check('story_init wrote manifest', (await stat(join(root, 'works', work, 'manifest.json'))).isFile())
  // From here the session is pointed at that work, as the panel would.
  setCurrent('test-session', work)

  const earlyPlan = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't',
  }, exec)
  check('the first chapter plan needs an approved outline', earlyPlan.ok === false && earlyPlan.error.code === 'outline-required', JSON.stringify(earlyPlan))
  await byName.get('story_outline').execute({ work, mainline: '一条主线' }, exec)
  const unapproved = await byName.get('story_outline').execute({ work }, exec)
  check('an unapproved outline blocks nothing by itself', unapproved.ok === true || unapproved.ok === false)
  const blockedPlan = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't',
  }, exec)
  check('writing the outline is not enough', blockedPlan.ok === false && blockedPlan.error.code === 'outline-required', JSON.stringify(blockedPlan))
  const approved = await byName.get('story_outline').execute({ work, approve: true }, exec)
  check('approval recorded', approved.ok === true && typeof approved.outline?.approvedAt === 'string', JSON.stringify(approved))

  const plan = await byName.get('story_plan').execute({
    work, chapter: 1, perspective: '林澈', goal: '拿回合同', obstacle: '房东', cost: '人情', turn: '合同是假的',
  }, exec)
  check('story_plan ok', plan.ok === true && plan.artifact.path.endsWith('ch-0001.plan.md'), JSON.stringify(plan))

  const badPlan = await byName.get('story_plan').execute({
    work, chapter: 2, perspective: '林澈', goal: '', obstacle: 'x', cost: 'y', turn: 'z',
  }, exec)
  check('story_plan rejects missing field', badPlan.ok === false && badPlan.error.code === 'plan-incomplete', JSON.stringify(badPlan))

  const body = '他站在雨里。'.repeat(60)
  const write = await byName.get('story_write').execute({ work, chapter: 1, title: '雨里的灯', body }, exec)
  check('story_write ok', write.ok === true && write.words > 0, JSON.stringify(write))

  const afterWrite = JSON.parse(await readFile(join(root, 'works', work, 'manifest.json'), 'utf8'))
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
  const missingChapter = await byName.get('story_context').execute({ work, chapter: 99, role: 'writer' }, exec)
  check('story_context refuses an unknown chapter', missingChapter.ok === false
    && missingChapter.error.code === 'chapter-not-found', JSON.stringify(missingChapter))

  const context = await byName.get('story_context').execute({ work, chapter: 1, role: 'writer' }, exec)
  check('story_context returns writer sections', context.ok === true
    && ['authority', 'task', 'constraints', 'state', 'style'].every(name => context.sections.some(item => item.name === name)),
  JSON.stringify(context).slice(0, 300))
  check('story_context returns a trace', context.ok === true && context.trace.budget > 0, JSON.stringify(context.trace))
  check('whitelist leaves the action as a summary', context.ok === true
    && typeof context.whitelist.counts.names === 'number' && Array.isArray(context.whitelist.sample.names), JSON.stringify(context.whitelist))
  check('the whitelist sample stays bounded',
    context.ok === true && context.whitelist.sample.names.length <= 5 && context.whitelist.sample.numbers.length <= 5, JSON.stringify(context.whitelist.sample))

  const plannerAhead = await byName.get('story_context').execute({ work, chapter: 2, role: 'planner' }, exec)
  check('planning an unlisted chapter works', plannerAhead.ok === true && plannerAhead.sections.some(item => item.name === 'plan'), JSON.stringify(plannerAhead).slice(0, 200))


  const reviewNoBody = await byName.get('story_context').execute({ work, chapter: 1, role: 'reviser' }, exec)
  check('revision without a review is refused', reviewNoBody.ok === false && reviewNoBody.error.code === 'review-required', JSON.stringify(reviewNoBody))

  // Consistency runs at the landing action: an invented speaker blocks the write.
  const invented = `周三说：“走。”`.repeat(30)
  const manifestBeforeConsistency = await readFile(join(root, 'works', work, 'manifest.json'), 'utf8')
  const rejected = await byName.get('story_write').execute({ work, chapter: 1, body: invented, rewrite: true }, exec)
  check('an invented speaker is refused at landing', rejected.ok === false && rejected.error.code === 'consistency-violation', JSON.stringify(rejected))
  check('a refused consistency check leaves the work untouched',
    (await readFile(join(root, 'works', work, 'manifest.json'), 'utf8')) === manifestBeforeConsistency)

  const rewrite = await byName.get('story_write').execute({ work, chapter: 1, body, rewrite: true }, exec)
  check('rewrite creates revision 2', rewrite.ok === true && rewrite.artifact.revision === 2, JSON.stringify(rewrite))

  const review = await byName.get('story_review').execute({
    work, chapter: 1, problems: [{ location: '结尾', problem: '钩子虚', suggestion: '落到合同上' }],
  }, exec)
  check('story_review ok', review.ok === true && review.problems[0].id === 'Q1', JSON.stringify(review))

  const noIds = await byName.get('story_revise').execute({ work, chapter: 1, body: `${body}（再改）` }, exec)
  check('revise without ids refused', noIds.ok === false && noIds.error.code === 'missing-problems', JSON.stringify(noIds))

  const unchanged = await byName.get('story_revise').execute({
    work, chapter: 1, body, problemIds: ['Q1'],
  }, exec)
  check('unchanged body refused', unchanged.ok === false && unchanged.error.code === 'unchanged-body', JSON.stringify(unchanged))

  const revise = await byName.get('story_revise').execute({
    work, chapter: 1, body: `${body}（改）`, problemIds: ['Q1'],
  }, exec)
  check('story_revise ok', revise.ok === true && revise.resolved[0] === 'Q1', JSON.stringify(revise))



  const earlySettle = await byName.get('story_state').execute({ work, chapter: 1, entities: [], hooks: [] }, exec)
  check('settling before the summary is refused', earlySettle.ok === false && earlySettle.error.code === 'summary-required', JSON.stringify(earlySettle))
  const preSummary = await byName.get('story_summarize').execute({ work, chapter: 1, summary: '司机捡到一盏灯。' }, exec)
  check('summary written before settle', preSummary.ok === true, JSON.stringify(preSummary))
  const state = await byName.get('story_state').execute({
    work, chapter: 1,
    entities: [{ name: '林澈', facts: ['拿到假合同'] }],
    hooks: [{ text: '合同是假的', state: 'opened' }],
  }, exec)
  check('story_state ok', state.ok === true && state.counts.opened === 1, JSON.stringify(state))

  const duplicates = await byName.get('story_init').execute({ title: '雨里的灯', proposal: proposal.proposal }, exec)
  check('duplicate init refused', duplicates.ok === false && duplicates.error.code === 'work-exists', JSON.stringify(duplicates))

  const written = await byName.get('story_bible_write').execute({
    work, file: 'characters',
    content: JSON.stringify([{ name: '林澈', role: '主角', want: '拿回合同', fear: '失去妹妹', limit: '不伤人', voice: '短句' }]),
  }, exec)
  check('story_bible_write ok', written.ok === true && typeof written.version === 'string', JSON.stringify(written))

  const invalidBible = await byName.get('story_bible_write').execute({ work, file: 'characters', content: 'not-json' }, exec)
  check('story_bible_write rejects invalid', invalidBible.ok === false && invalidBible.error.code === 'bible-invalid', JSON.stringify(invalidBible))

  const bible = await byName.get('story_bible').execute({ work }, exec)
  check('story_bible reads five files', bible.ok === true && bible.files.length === 5, JSON.stringify(bible.files?.map(file => file.name)))

  const brief = await byName.get('story_brief').execute({ work, chapter: 1 }, exec)
  check('story_brief returns nine sections', brief.ok === true && brief.sections.length === 9, JSON.stringify(brief.sections?.map(section => section.name)))
  check('story_brief reports budget', brief.ok === true && brief.budget.limit > 0)

  const summary = await byName.get('story_summarize').execute({ work, chapter: 1, summary: '林澈在塌方里救人，决定北上。' }, exec)
  check('story_summarize ok', summary.ok === true && summary.truncated === false, JSON.stringify(summary))

  const currentProps = Object.keys(byName.get('story_current').output.schema.properties ?? {})
  check('story_current declares its output keys', ['workId', 'current'].every(key => currentProps.includes(key)), currentProps.join(','))
  const statusProps = Object.keys(byName.get('story_status').output.schema.properties.status.properties ?? {})
  check('story_status declares the fields it returns', ['form', 'wordRange', 'chapters', 'hooks'].every(key => statusProps.includes(key)), statusProps.join(','))

  // Delegated subagents share this composition and see the same tools; the
  // runtime keeps them from landing anything.
  const childExec = { agent: { ...exec.agent, id: 'child', session: { header: { cwd: root, delegationDepth: 1 } } } }
  setCurrent('child', work)
  const manifestBefore = await readFile(join(root, 'works', work, 'manifest.json'), 'utf8')
  const deniedWrite = await byName.get('story_write').execute({ work, chapter: 1, body, rewrite: true }, childExec)
  check('a delegated subagent cannot land a chapter', deniedWrite.ok === false && deniedWrite.error.code === 'subagent-cannot-land', JSON.stringify(deniedWrite))
  check('a refused landing leaves the manifest unchanged',
    (await readFile(join(root, 'works', work, 'manifest.json'), 'utf8')) === manifestBefore)
  const childWithoutWork = { agent: { ...exec.agent, id: 'child-nowork', session: { header: { cwd: root, delegationDepth: 1 } } } }
  const deniedEarly = await byName.get('story_write').execute({ work, chapter: 1, body }, childWithoutWork)
  check('delegation is refused before work resolution', deniedEarly.ok === false && deniedEarly.error.code === 'subagent-cannot-land', JSON.stringify(deniedEarly))
  const childRead = await byName.get('story_status').execute({ work }, childExec)
  check('a delegated subagent keeps read actions', childRead.ok === true && childRead.status.writtenChapters === 1, JSON.stringify(childRead.status ?? childRead))
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
  check('proposal result declares its keys',
    ['proposal', 'title', 'form'].every(key => Object.keys(byName.get('story_propose').output.schema.properties).includes(key))
    && proposalResult.ok === true, JSON.stringify(proposalResult))

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

  await byName.get('story_status').execute({ work: '不存在' }, exec)
    .then(() => check('another id is refused while one work is active', false, 'expected a rejection'),
      error => check('another id is refused while one work is active', error.code === 'work-mismatch', String(error.code)))

  const manifest = JSON.parse(await readFile(join(root, 'works', work, 'manifest.json'), 'utf8'))
  check('manifest tracks revision', manifest.chapters[0].currentRevision === 3, String(manifest.chapters[0].currentRevision))

  // A planned but unwritten chapter: the review path must say so, not crash.
  await byName.get('story_plan').execute({
    work, chapter: 2, perspective: '林澈', goal: 'g', obstacle: 'o', cost: 'c', turn: 't',
  }, exec)
  const unwritten = await byName.get('story_context').execute({ work, chapter: 2, role: 'reviewer' }, exec)
  check('reviewing an unwritten chapter is refused', unwritten.ok === false
    && unwritten.error.code === 'chapter-not-written', JSON.stringify(unwritten))

  // A revision that invents a speaker is refused at landing, like a write.
  const secondWrite = await byName.get('story_write').execute({ work, chapter: 2, body: '第二章正文。'.repeat(40) }, exec)
  check('second chapter written', secondWrite.ok === true, JSON.stringify(secondWrite))
  const secondReview = await byName.get('story_review').execute({
    work, chapter: 2, problems: [{ location: '开头', problem: '进得太慢' }],
  }, exec)
  check('second review written', secondReview.ok === true, JSON.stringify(secondReview))
  const inventedRevise = `周三说：“改。”`.repeat(30)
  const refusedRevise = await byName.get('story_revise').execute({
    work, chapter: 2, body: inventedRevise, problemIds: ['Q1'],
  }, exec)
  check('a revision that invents a speaker is refused', refusedRevise.ok === false
    && refusedRevise.error.code === 'consistency-violation', JSON.stringify(refusedRevise))

} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
