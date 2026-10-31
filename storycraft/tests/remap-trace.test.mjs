// The architect trace is work-level even though the contract scopes it to a
// chapter: moving that chapter must not rename or delete it.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as s from '../src/storage.ts'
import { readArtifact } from '../src/artifact-store.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-remap-trace-'))
try {
  const { workId: work } = s.initWork(root, { title: '重映射保留 trace' })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  for (const chapter of [1, 2]) {
    s.writePlan(root, { work, chapter, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: `b${chapter}`, threadRefs: [] })
    s.approveChapterPlan(root, { work, chapter })
    s.writeChapter(root, { work, chapter, title: `第${chapter}章`, body: `正文${chapter}。`.repeat(20) })
  }

  const db = new DatabaseSync(join(root, '.storycraft', 'works', `${work}.db`))
  try {
    db.prepare(`INSERT INTO artifacts (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
      VALUES ('trace:1:architect', 'rev1', 'trace', 1, 'json', ?, 'generated', ?)`)
      .run(JSON.stringify({
        chapter: 1,
        skills: [],
        plannerInputs: [],
        composerInputs: [],
        selectedSources: [],
        contextTiers: { protectedSources: [], compressibleSources: [] },
        tokenBudget: { protectedTokens: 0, compressibleTokens: 0, totalSelectedTokens: 0 },
        notes: ['stage=frame'],
        sections: [],
        trimmed: [],
        dropped: [],
        missing: [],
        overflow: false,
      }), new Date().toISOString())
  } finally {
    db.close()
  }

  s.moveChapter(root, work, 1, 2)

  let kept = false
  try {
    const trace = readArtifact(root, { work, artifactId: 'trace:1:architect' })
    kept = trace.artifact.artifactId === 'trace:1:architect'
  } catch {
    kept = false
  }
  check('a chapter move keeps the architect trace', kept)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
