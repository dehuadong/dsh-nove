// story_read must return structured truth files (hooks) as parseable JSON.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as s from '../src/storage.ts'
import { setCurrent } from '../src/current.ts'
import * as tools from '../src/tools/index.ts'

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
const readTool = registered.find(definition => definition.name === 'story_read')

const root = await mkdtemp(join(tmpdir(), 'storycraft-read-hooks-'))
try {
  const { workId: work } = s.initWork(root, { title: '伏笔读取' })
  setCurrent('read-hooks-session', work)
  const db = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, 'generated', ?)`).run(
      'bible:hooks',
      'rev1',
      'hooks',
      'json',
      JSON.stringify({
        hooks: [{ hookId: 'ledger', status: 'deferred', type: '物件', expectedPayoff: '第二卷翻出旧账', notes: '', text: '旧账本' }],
        markdown: '# 初始伏笔\n\n| hook_id | status |\n| --- | --- |\n| ledger | deferred |\n',
      }),
      new Date().toISOString(),
    )
    db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
      VALUES (?, ?, ?, NULL, 'text', ?, 'generated', ?)`).run(
      'bible:world',
      'rev1',
      'world',
      '第一行\n第二行\n第三行',
      new Date().toISOString(),
    )
  } finally {
    db.close()
  }
  const exec = { agent: { id: 'read-hooks-session', session: { header: { cwd: root } } } }
  const read = await readTool.execute({ work, artifactId: 'bible:hooks' }, exec)
  check('hooks read is a string', typeof read.content === 'string')
  check('hooks read is not the object placeholder', !read.content.includes('[object Object]'), read.content)
  let parsed
  try { parsed = JSON.parse(read.content) } catch { parsed = undefined }
  check('hooks read parses as JSON', parsed !== undefined)
  check('hooks JSON carries the seeded hook',
    JSON.stringify(parsed).includes('ledger') && JSON.stringify(parsed).includes('deferred'),
    read.content?.slice(0, 200))
  check('hooks read keeps line accounting', read.startLine === 1 && read.totalLines >= 1)

  const text = await readTool.execute({ work, artifactId: 'bible:world' }, exec)
  check('text bible content passes through unchanged', text.content === '第一行\n第二行\n第三行', text.content)
  const windowed = await readTool.execute({ work, artifactId: 'bible:world', startLine: 2, lineCount: 1 }, exec)
  check('a line window slices the text', windowed.content === '第二行' && windowed.startLine === 2 && windowed.totalLines === 3,
    JSON.stringify({ content: windowed.content, startLine: windowed.startLine, totalLines: windowed.totalLines }))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
