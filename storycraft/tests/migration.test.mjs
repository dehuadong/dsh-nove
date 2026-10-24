// Only v6 work databases are supported: legacy test schemas are refused, not upgraded.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, openWork, workFile, WORK_SCHEMA_VERSION } from '../dist/db.js'
import * as s from '../dist/storage.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-schema-'))
try {
  const { workId } = s.initWork(root, { title: 'schema-only', wordRange: { min: 50, max: 200 } })
  check('new work is v8', WORK_SCHEMA_VERSION === 8, String(WORK_SCHEMA_VERSION))
  openWork(root, workId).close()

  for (const version of [1, 2, 3, 4, 5, 99]) {
    const db = openDatabase(workFile(root, workId))
    db.exec(`PRAGMA user_version = ${version}`)
    db.close()
    throwsCode(`v${version} work is refused`, 'schema-version-mismatch', () => openWork(root, workId))
  }

  const db = openDatabase(workFile(root, workId))
  db.exec(`PRAGMA user_version = ${WORK_SCHEMA_VERSION}`)
  db.close()
  openWork(root, workId).close()
  check('v6 work reopens', true)

  const stale = openDatabase(workFile(root, workId))
  stale.exec('ALTER TABLE chapters DROP COLUMN plan_revision')
  stale.close()
  throwsCode('v6 work missing A0 columns is refused', 'schema-version-mismatch', () => openWork(root, workId))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
