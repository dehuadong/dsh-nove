// The panel confirmation is a function, not an untestable HTTP closure: the route
// and this test share one path that records the approval event.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as s from '../src/storage.ts'
import { approveFoundationFromPanel, parseRequestBody, readFoundationPreview } from '../src/index.ts'
import { setCurrent } from '../src/current.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function seed(db, artifactId, kind, content, contentType = 'text') {
  db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
    VALUES (?, 'rev1', ?, NULL, ?, ?, 'generated', ?)`).run(artifactId, kind, contentType, content, new Date().toISOString())
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-panel-approve-'))
try {
  const { workId: work } = s.initWork(root, { title: '面板确认' })
  const db = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    seed(db, 'bible:story_frame', 'story_frame', '框架')
    seed(db, 'bible:volume_map', 'volume_map', '卷一')
    seed(db, 'bible:current_focus', 'current_focus', '焦点')
    seed(db, 'bible:book_rules', 'book_rules', '{}')
    seed(db, 'bible:hooks', 'hooks', JSON.stringify({ hooks: [{ hookId: 'ledger', type: '物件', expectedPayoff: '第二卷翻出旧账', notes: '', text: '旧账本' }], markdown: '# 初始伏笔\n\n| hook_id |\n| --- |\n| ledger |\n' }), 'json')
    seed(db, 'roles:index', 'role_index', JSON.stringify({ roles: [{ name: '甲', tier: 'major' }] }))
    seed(db, 'role:甲', 'role_card', JSON.stringify({ slug: 'jia', name: '甲', tier: 'major', motivation: 'm', knowledge: 'k', relationshipPressure: 'r', limits: 'l', markdown: '# 甲' }))
  } finally {
    db.close()
  }

  setCurrent('panel-session', work)
  const approved = approveFoundationFromPanel(root, { sessionId: 'panel-session', workId: work })
  check('the panel path records the approval', typeof approved.foundation?.approvedAt === 'string', JSON.stringify(approved))
  const preview = readFoundationPreview(root, work)
  const roles = preview.documents.find(item => item.name === 'roles_index')
  const cards = preview.documents.filter(item => item.name === 'jia' || item.name === '甲')
  const hooks = preview.documents.find(item => item.name === 'hooks')
  check('the foundation preview carries the initial hooks document',
    hooks?.content.startsWith('# 初始伏笔') === true && hooks.content.includes('ledger'),
    JSON.stringify(preview.documents.map(item => item.name)))
  check('the foundation preview carries the thin index and the card',
    roles?.content.includes('"tier"') && !roles.content.includes('"want"')
    && cards.length === 1 && cards[0].content.includes('甲'),
    JSON.stringify(preview.documents.map(item => item.name)))
  check('the panel path records its source', approved.foundation?.approvedSource === 'panel', JSON.stringify(approved.foundation))
  const metaDb = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    const row = metaDb.prepare('SELECT foundation_approved_source, foundation_approved_revision, foundation_approved_reason FROM meta WHERE id = 1').get()
    check('the panel approval binds the foundation revision', row.foundation_approved_source === 'panel'
      && typeof row.foundation_approved_revision === 'string' && row.foundation_approved_revision !== '', JSON.stringify(row))
    check('a panel approval has no invented reason', row.foundation_approved_reason === null, JSON.stringify(row))
    metaDb.prepare("UPDATE artifacts SET revision_id = 'rev2' WHERE artifact_id = 'bible:story_frame'").run()
  } finally {
    metaDb.close()
  }
  check('rewriting a foundation document invalidates the approval',
    s.readFoundationState(root, work).approvedAt === undefined, JSON.stringify(s.readFoundationState(root, work)))

  s.approveFoundation(root, { work, source: 'conversation', reason: '就按这一版' })
  const conversationDb = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    const row = conversationDb.prepare('SELECT foundation_approved_source, foundation_approved_reason FROM meta WHERE id = 1').get()
    check('a conversation approval records its source and reason',
      row.foundation_approved_source === 'conversation' && row.foundation_approved_reason === '就按这一版', JSON.stringify(row))
  } finally {
    conversationDb.close()
  }

  let mismatch = ''
  try {
    approveFoundationFromPanel(root, { sessionId: 'panel-session', workId: '别的工作' })
  } catch (error) {
    mismatch = error?.code ?? String(error)
  }
  check('a different current work is refused', mismatch === 'work-mismatch', mismatch)

  check('an empty body parses to an object', JSON.stringify(parseRequestBody('')) === '{}')
  check('a JSON body parses', parseRequestBody('{"workId":"x"}').workId === 'x')

  let invalid = ''
  try {
    parseRequestBody('{not json')
  } catch (error) {
    invalid = error?.code ?? String(error)
  }
  check('bad JSON is a typed error', invalid === 'invalid-body', invalid)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
