// Export reports an approval only while the gate still accepts it.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-export-approval-'))
try {
  const { workId: work } = s.initWork(root, { title: '导出批准' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })

  await s.exportWork(root, work, join(root, 'out-1'))
  const firstManifest = JSON.parse(await readFile(join(root, 'out-1', 'manifest.json'), 'utf8'))
  check('an approved outline is exported as approved',
    typeof firstManifest?.outline?.approvedAt === 'string', JSON.stringify(firstManifest?.outline))

  s.writeOutline(root, { work, mainline: '改过的主线' })
  await s.exportWork(root, work, join(root, 'out-2'))
  const secondManifest = JSON.parse(await readFile(join(root, 'out-2', 'manifest.json'), 'utf8'))
  check('a rewritten outline is not exported as approved',
    secondManifest?.outline?.approvedAt === null, JSON.stringify(secondManifest?.outline))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
