// story_approve records a conversation approval through the tool surface, not
// only through the store functions the other tests call directly.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as tools from '../src/tools.ts'
import * as s from '../src/storage.ts'
import { setCurrent } from '../src/current.ts'

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
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {} },
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
}
tools.apply(ctx, { mode: 'longform' })
const byName = new Map(registered.map(definition => [definition.name, definition]))

function seed(db, artifactId, kind, content) {
  db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
    VALUES (?, 'rev1', ?, NULL, 'text', ?, 'generated', ?)`).run(artifactId, kind, content, new Date().toISOString())
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-approve-tool-'))
const exec = { agent: { id: 'test-session', session: { header: { cwd: root } } } }
try {
  const { workId: work } = s.initWork(root, { title: '会话批准' })
  const db = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    seed(db, 'bible:story_frame', 'story_frame', '框架')
    seed(db, 'bible:volume_map', 'volume_map', '卷一')
    seed(db, 'bible:current_focus', 'current_focus', '焦点')
    seed(db, 'bible:book_rules', 'book_rules', '{}')
    seed(db, 'roles:index', 'role_index', JSON.stringify({ roles: [{ name: '甲', tier: 'major' }] }))
    seed(db, 'role:甲', 'role_card', JSON.stringify({ slug: 'jia', name: '甲', tier: 'major', motivation: 'm', knowledge: 'k', relationshipPressure: 'r', limits: 'l', markdown: '# 甲' }))
  } finally {
    db.close()
  }

  setCurrent('test-session', work)

  const approved = await byName.get('story_approve').execute({ work, kind: 'foundation' }, exec)
  check('the tool records a foundation approval', approved.ok === true && approved.source === 'conversation', JSON.stringify(approved))
  const manifest = s.readManifest(root, work)
  check('the approval carries its source to the reader',
    manifest.foundation?.approvedAt !== undefined && manifest.foundation?.approvedSource === 'conversation',
    JSON.stringify(manifest.foundation))

  s.writeOutline(root, { work, mainline: '一条主线' })
  const outline = await byName.get('story_approve').execute({ work, kind: 'outline' }, exec)
  check('the tool records an outline approval', outline.ok === true, JSON.stringify(outline))

  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  const plan = await byName.get('story_approve').execute({ work, kind: 'plan', chapter: 1 }, exec)
  check('the tool records a plan approval', plan.ok === true, JSON.stringify(plan))
  const next = await s.nextStep(root, work)
  check('the conversation approvals advance the gate', next.action === 'story_write', JSON.stringify(next))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
