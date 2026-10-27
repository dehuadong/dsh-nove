// Provenance: a read returns the artifact identity it read, and a missing
// artifact is a typed absence, never an empty string standing in for failure.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { readArtifact, readTextArtifact } from '../src/artifact-store.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-provenance-'))
try {
  const { workId: work } = s.initWork(root, { title: '来源标注' })
  s.writeOutline(root, { work, mainline: '一条主线' })

  const outline = readTextArtifact(root, { work, artifactId: 'outline', kind: 'outline' })
  check('a present artifact reports its identity',
    outline.artifact.artifactId === 'outline' && typeof outline.artifact.revisionId === 'string' && outline.artifact.revisionId !== '',
    JSON.stringify(outline.artifact))

  let absentCode = ''
  try {
    readArtifact(root, { work, artifactId: 'plan:9' })
  } catch (error) {
    absentCode = error.code
  }
  check('a missing artifact is typed, not silently empty', absentCode === 'artifact-not-found', absentCode)

  let unreadableCode = ''
  try {
    readTextArtifact(root, { work, artifactId: 'outline', kind: 'chapter' })
  } catch (error) {
    unreadableCode = error.code
  }
  check('a mismatched kind is a readable failure, not absence',
    unreadableCode === 'artifact-kind-mismatch' || unreadableCode === 'artifact-not-readable', unreadableCode)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
