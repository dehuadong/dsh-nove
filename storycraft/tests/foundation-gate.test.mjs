// Foundation approval binds to the artifact fingerprint, and a complete but
// unconfirmed foundation tells the author what is waiting and asks one question.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Insert an artifact row directly: the test cares about the gate, not the schema. */
function seed(db, artifactId, kind, content) {
  db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
    VALUES (?, ?, ?, NULL, 'text', ?, 'generated', ?)`).run(artifactId, 'rev1', kind, content, new Date().toISOString())
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-foundation-gate-'))
try {
  const { workId: work } = s.initWork(root, { title: '基础设定闸门' })
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

  const state = s.readFoundationState(root, work)
  check('four complete stages are reported complete', state.complete === true, JSON.stringify(state.stages))

  const pending = await s.nextStep(root, work)
  check('a complete but unconfirmed foundation blocks at the gate',
    (pending.blocked ?? []).includes('foundation-approval'), JSON.stringify(pending))
  const items = pending.ask?.present?.[0]?.items ?? []
  check('the foundation ask carries one sentence per stage and one question',
    pending.ask?.question?.includes('确认基础设定') === true
    && items.length === 4
    && items[0].startsWith('故事框架：') && items[1].startsWith('作品规则：')
    && items[2].startsWith('角色：') && items[3].startsWith('角色卡：'),
    JSON.stringify(pending.ask))

  s.approveFoundation(root, { work })
  const approved = await s.nextStep(root, work)
  check('an approved foundation advances to the plan',
    !(approved.blocked ?? []).includes('foundation-approval')
    && approved.action === 'story_outline', JSON.stringify(approved))

  // Rewriting any stage changes the fingerprint without any explicit clearing.
  const db2 = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    db2.prepare("UPDATE artifacts SET revision_id = 'rev2' WHERE artifact_id = 'bible:story_frame'").run()
  } finally {
    db2.close()
  }
  const invalidated = await s.nextStep(root, work)
  check('rewriting a stage invalidates the approval',
    (invalidated.blocked ?? []).includes('foundation-approval'), JSON.stringify(invalidated))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
