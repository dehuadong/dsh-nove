/** Tests for immutable artifact persistence. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initWork } from '../dist/storage.js'
import { writePlan } from '../dist/store-db.js'
import { listArtifacts, putArtifact, readArtifact } from '../dist/artifact-store.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function rejects(name, code, fn) {
  try {
    fn()
    check(name, false, '没有抛错')
  } catch (error) {
    check(name, error?.code === code, `${error?.code}: ${error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-artifact-'))
try {
  const { workId: work } = initWork(root, { title: '产物测试' })
  writePlan(root, {
    work, chapter: 1, perspective: '甲', goal: '拿到账本',
    obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
  })
  const memo = {
    chapter: 1, goal: '拿到账本', body: '从当铺换出账本', threadRefs: ['h_1'],
    perspective: '甲', obstacle: '掌柜刁难', cost: '欠人情', turn: '账本是假的',
  }

  const first = putArtifact(root, {
    workId: work, artifactId: 'plan:1', kind: 'plan', scope: { chapter: 1 },
    revisionId: 'hash-1', content: memo, provenance: 'generated', createdAt: '2026-10-23T00:00:00.000Z',
  })
  check('put artifact returns identity', first.artifact.artifactId === 'plan:1' && first.artifact.revisionId === 'hash-1')

  const second = putArtifact(root, {
    workId: work, artifactId: 'plan:1', kind: 'plan', scope: { chapter: 1 },
    revisionId: 'hash-2', content: { ...memo, goal: '拿到真账本' }, provenance: 'edited', createdAt: '2026-10-23T00:01:00.000Z',
  })
  const latest = readArtifact(root, { work, artifactId: 'plan:1' })
  check('read latest revision', latest.artifact.revisionId === 'hash-2' && latest.artifact.content.goal === '拿到真账本', JSON.stringify(latest))
  const old = readArtifact(root, { work, artifactId: 'plan:1', revisionId: 'hash-1' })
  check('read immutable old revision', old.artifact.content.goal === '拿到账本', JSON.stringify(old))
  check('scope is preserved', latest.artifact.scope.chapter === 1, JSON.stringify(latest))

  putArtifact(root, {
    workId: work, artifactId: 'bible:story_frame', kind: 'story_frame',
    revisionId: 'frame-1', provenance: 'generated', createdAt: '2026-10-23T00:02:00.000Z',
    content: [
      '# 故事框架', '', '## 前提', '有一个账本。', '', '## 核心冲突', '甲要拿回账本。',
      '', '## 主角动机', '救父亲。', '', '## 约束', '不能惊动掌柜。', '', '## 因果解决', '账本牵出旧案。', '',
    ].join('\n'),
  })
  const plans = listArtifacts(root, { work, kind: 'plan' })
  check('list by kind', plans.artifacts.length === 1 && plans.artifacts[0].artifactId === 'plan:1', JSON.stringify(plans))
  const all = listArtifacts(root, { work })
  check('list latest of each artifact', all.artifacts.length === 6
    && ['outline', 'bible:world', 'bible:style', 'bible:intent'].every(id => all.artifacts.some(item => item.artifactId === id))
    && all.artifacts.some(item => item.artifactId === 'plan:1') && all.artifacts.some(item => item.artifactId === 'bible:story_frame'), JSON.stringify(all))

  rejects('missing revision is revision-not-found', 'revision-not-found',
    () => readArtifact(root, { work, artifactId: 'plan:1', revisionId: 'missing' }))
  rejects('duplicate revision is refused', 'artifact-revision-exists', () => putArtifact(root, {
    workId: work, artifactId: 'plan:1', kind: 'plan', scope: { chapter: 1 }, revisionId: 'hash-1', content: memo, provenance: 'generated', createdAt: '2026-10-23T00:00:00.000Z',
  }))
  rejects('missing artifact is not found', 'artifact-not-found', () => readArtifact(root, { work, artifactId: 'plan:2' }))
  rejects('invalid envelope is rejected', 'artifact-invalid', () => putArtifact(root, {
    workId: work, artifactId: 'works/plan', kind: 'plan', revisionId: 'x', content: memo, provenance: 'generated', createdAt: 'now',
  }))
  rejects('chapter artifact needs scope', 'artifact-invalid', () => putArtifact(root, {
    workId: work, artifactId: 'summary:1', kind: 'summary', revisionId: 'x', content: {}, provenance: 'generated', createdAt: 'now',
  }))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
