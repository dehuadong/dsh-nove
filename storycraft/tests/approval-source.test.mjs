// The conversation can record an approval: same event as the panel, plus the
// source, and the fingerprint rules still apply.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { openWork } from '../src/db.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-approval-source-'))
try {
  const { workId: work } = s.initWork(root, { title: '批准来源' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work, source: 'conversation' })

  const outlineNext = await s.nextStep(root, work)
  check('a conversation approval advances the gate',
    outlineNext.action === 'story_plan' && !(outlineNext.blocked ?? []).includes('outline-approval'),
    JSON.stringify(outlineNext))

  const db = openWork(root, work)
  try {
    const row = db.prepare('SELECT outline_approved_source, outline_approved_revision FROM meta WHERE id = 1').get()
    check('the outline records where the approval came from', row.outline_approved_source === 'conversation', JSON.stringify(row))
    check('the outline still binds the revision', typeof row.outline_approved_revision === 'string' && row.outline_approved_revision !== '')
  } finally {
    db.close()
  }

  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: 'b', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1, source: 'conversation' })
  const planNext = await s.nextStep(root, work)
  check('a conversation plan approval advances to writing',
    planNext.action === 'story_write' && !(planNext.blocked ?? []).includes('plan-approval'),
    JSON.stringify(planNext))

  const db2 = openWork(root, work)
  try {
    const row = db2.prepare('SELECT plan_approved_source, plan_revision FROM chapters WHERE number = 1').get()
    check('the chapter records where the plan approval came from', row.plan_approved_source === 'conversation', JSON.stringify(row))
    check('the plan still binds the revision', typeof row.plan_revision === 'string' && row.plan_revision !== '')
  } finally {
    db2.close()
  }

  // The panel path keeps working and records its own source.
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: 'g2', obstacle: 'o', cost: 'c', turn: 't', body: 'b2', threadRefs: [] })
  s.approveChapterPlan(root, { work, chapter: 1 })
  const db3 = openWork(root, work)
  try {
    const row = db3.prepare('SELECT plan_approved_source FROM chapters WHERE number = 1').get()
    check('the panel path records panel as its source', row.plan_approved_source === 'panel', JSON.stringify(row))
  } finally {
    db3.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
