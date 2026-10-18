// Throwaway verification for storycraft/tools.js registration and dispatch.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tools from '../tools.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const registered = []
const ctx = {
  tools: { register: (definition) => { registered.push(definition); return () => {} } },
  effect: (fn) => { const dispose = fn(); return () => dispose?.() },
}
tools.apply(ctx, { mode: 'longform' })

const names = registered.map(definition => definition.name).sort()
check('registers twenty-two actions', names.length === 22, names.join(','))
check('action names', names.join(',') === [
  'story_bible', 'story_bible_import', 'story_bible_write', 'story_brief', 'story_critique', 'story_current',
  'story_delete', 'story_init', 'story_next', 'story_plan', 'story_rename', 'story_reopen', 'story_restore',
  'story_review', 'story_revise', 'story_settings', 'story_state', 'story_status', 'story_summarize',
  'story_volume', 'story_volumes', 'story_write',
].sort().join(','), names.join(','))
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
  const exec = { agent: { session: { header: { cwd: root } } } }
  const created = await byName.get('story_init').execute({ title: '雨里的灯' }, exec)
  check('story_init ok', created.ok === true && typeof created.workId === 'string', JSON.stringify(created))
  const work = created.workId
  check('story_init wrote manifest', (await stat(join(root, 'works', work, 'manifest.json'))).isFile())

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


  const state = await byName.get('story_state').execute({
    work, chapter: 1,
    entities: [{ name: '林澈', facts: ['拿到假合同'] }],
    hooks: [{ text: '合同是假的', state: 'opened' }],
  }, exec)
  check('story_state ok', state.ok === true && state.counts.opened === 1, JSON.stringify(state))

  const duplicates = await byName.get('story_init').execute({ title: '雨里的灯' }, exec)
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

  const pointed = await byName.get('story_current').execute({ work }, { ...exec, agent: { ...exec.agent, id: 'session-a' } })
  check('story_current sets the session work', pointed.current === work, JSON.stringify(pointed))
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

  const missing = await byName.get('story_status').execute({ work: '不存在' }, exec)
  check('unknown work returns structured error', missing.ok === false && missing.error.code === 'work-not-found', JSON.stringify(missing))

  const manifest = JSON.parse(await readFile(join(root, 'works', work, 'manifest.json'), 'utf8'))
  check('manifest tracks revision', manifest.chapters[0].currentRevision === 3, String(manifest.chapters[0].currentRevision))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
