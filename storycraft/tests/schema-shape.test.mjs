// An old work shape is refused up front, not by a later UPDATE.
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

const root = await mkdtemp(join(tmpdir(), 'storycraft-schema-shape-'))
try {
  const { workId: work } = s.initWork(root, { title: '旧形态' })
  const db = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))

  const rebuild = (table, dropped) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter(column => !dropped.includes(column.name))
    const names = columns.map(column => column.name).join(', ')
    const defs = columns.map(column => {
      const notNull = column.notnull === 1 ? ' NOT NULL' : ''
      const fallback = column.dflt_value === null ? '' : ` DEFAULT ${column.dflt_value}`
      return `${column.name} ${column.type}${notNull}${fallback}`
    }).join(', ')
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`)
    db.exec(`CREATE TABLE ${table} (${defs})`)
    db.exec(`INSERT INTO ${table} (${names}) SELECT ${names} FROM ${table}_old`)
    db.exec(`DROP TABLE ${table}_old`)
  }

  rebuild('meta', ['outline_approved_source', 'foundation_approved_source'])
  rebuild('chapters', ['plan_approved_source'])
  db.close()

  let refused = ''
  try {
    s.readManifest(root, work)
  } catch (error) {
    refused = error?.code ?? String(error)
  }
  check('a work missing the approval-source columns is refused up front',
    refused === 'schema-version-mismatch', refused)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
