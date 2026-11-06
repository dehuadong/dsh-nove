// Artifact identity: current/superseded revisions, checksums and cross-work isolation.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initWork } from '../src/storage.ts'
import { artifactRevision, putArtifact, readArtifact } from '../src/artifact-store.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-artifact-identity-'))
try {
  const { workId: work } = initWork(root, { title: '身份测试' })
  const firstContent = '# 故事框架\n\n## 前提\n第一版。\n\n## 核心冲突\n甲要账本。\n\n## 主角动机\n救父亲。\n\n## 约束\n不能惊动掌柜。\n\n## 因果解决\n账本牵出旧案。\n'
  const secondContent = '# 故事框架\n\n## 前提\n第二版。\n\n## 核心冲突\n甲要账本。\n\n## 主角动机\n救父亲。\n\n## 约束\n不能惊动掌柜。\n\n## 因果解决\n账本牵出旧案。\n'
  const at = new Date().toISOString()
  const first = putArtifact(root, {
    workId: work, artifactId: 'bible:story_frame', kind: 'story_frame', provenance: 'generated',
    revisionId: artifactRevision(firstContent), content: firstContent, createdAt: at,
  }).artifact
  const second = putArtifact(root, {
    workId: work, artifactId: 'bible:story_frame', kind: 'story_frame', provenance: 'edited',
    revisionId: artifactRevision(secondContent), content: secondContent, createdAt: at,
  }).artifact
  check('second revision is current', second.revisionId !== first.revisionId)

  const current = readArtifact(root, { work, artifactId: 'bible:story_frame' })
  check('omitted revision reads current', current.artifact.revisionId === second.revisionId, JSON.stringify(current.artifact))
  check('current status', current.artifact.status === 'current', String(current.artifact.status))
  check('checksum is sha256', String(current.artifact.checksum).startsWith('sha256:') && current.artifact.checksum.length === 71, String(current.artifact.checksum))
  check('byteLength matches bytes', current.artifact.byteLength === Buffer.byteLength(current.artifact.content, 'utf8'), String(current.artifact.byteLength))
  check('parent points at previous revision', current.artifact.parentRevisionId === first.revisionId, String(current.artifact.parentRevisionId))

  const older = readArtifact(root, { work, artifactId: 'bible:story_frame', revisionId: first.revisionId })
  check('explicit revision reads old content', older.artifact.content.includes('第一版') && older.artifact.status === 'superseded', JSON.stringify(older.artifact))

  const { workId: other } = initWork(root, { title: '另一部' })
  let cross
  try {
    readArtifact(root, { work: other, artifactId: 'bible:story_frame' })
  } catch (error) {
    cross = error?.code
  }
  check('same artifact id does not cross works', cross === 'artifact-not-found', String(cross))

  let invalid
  try {
    putArtifact(root, { workId: work, artifactId: '../escape', kind: 'story_frame', provenance: 'generated', revisionId: 'r1', content: 'x', createdAt: at })
  } catch (error) {
    invalid = error?.code
  }
  check('path-like artifact id is rejected', invalid === 'artifact-invalid', String(invalid))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
