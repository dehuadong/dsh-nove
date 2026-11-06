// Book outline: mainline is required, confirmation gates chapter planning, and
// rewriting the outline withdraws the confirmation by fingerprint.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function throwsCode(name, code, fn) {
  try {
    fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-outline-'))
try {
  const { workId: work } = s.initWork(root, { title: '全书计划' })
  throwsCode('confirming without an outline is refused', 'outline-required', () => s.approveOutline(root, { work }))
  throwsCode('an empty mainline is refused', 'outline-invalid', () => s.writeOutline(root, { work, mainline: '  ' }))

  s.writeOutline(root, {
    work, mainline: '主角查清旧账', volumes: '第一卷：立住脚；第二卷：翻旧案', ending: '公开账本',
  })
  const outline = readArtifact(root, { work, artifactId: 'outline' })
  check('outline carries mainline, volumes and ending',
    outline.artifact.content.includes('主角查清旧账')
    && outline.artifact.content.includes('第一卷：立住脚')
    && outline.artifact.content.includes('公开账本'), outline.artifact.content)

  const pending = await s.nextStep(root, work)
  check('unconfirmed outline blocks the chapter plan',
    (pending.blocked ?? []).includes('outline-approval'), JSON.stringify(pending))

  s.approveOutline(root, { work, source: 'conversation', reason: '按这个方向' })
  const approved = await s.nextStep(root, work)
  check('confirmed outline advances to chapter planning',
    approved.action === 'story_plan' && !(approved.blocked ?? []).includes('outline-approval'), JSON.stringify(approved))

  s.writeOutline(root, { work, mainline: '换一条主线' })
  const rewritten = await s.nextStep(root, work)
  check('rewriting the outline withdraws its confirmation',
    (rewritten.blocked ?? []).includes('outline-approval'), JSON.stringify(rewritten))
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
