// The foundation must name something from the accepted proposal: a frame that
// matches none of its premise words or characters is not this work's foundation.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { openCatalog } from '../src/db.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-foundation-premise-'))
try {
  const { workId: work } = s.initWork(root, { title: '前提校验' })
  const catalog = openCatalog(root)
  try {
    catalog.prepare(`INSERT INTO proposals (id, title, form, premise, characters, created_at, used_work_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'p-premise', '前提校验', 'longform', '一个修表匠发现所有钟表都慢了三分钟',
      JSON.stringify([{ name: '老周' }]), new Date().toISOString(), work,
    )
  } finally {
    catalog.close()
  }

  let mismatch = ''
  try {
    s.writeFoundationStage(root, {
      work, stage: 'frame',
      payload: {
        storyFrame: '结构工程师沈砚回到陵川，处理化工厂旧楼。',
        volumeMap: '卷一：旧楼拆迁。',
        currentFocus: '沈砚与周德海。',
      },
    })
  } catch (error) {
    mismatch = error?.code ?? String(error)
  }
  check('a frame unrelated to the proposal is refused', mismatch === 'foundation-mismatch', mismatch)

  let landed = ''
  try {
    s.writeFoundationStage(root, {
      work, stage: 'frame',
      payload: {
        storyFrame: '修表匠老周发现街坊的钟表都慢了三分钟。',
        volumeMap: '卷一：慢掉的三分钟。',
        currentFocus: '老周开始查这三分半。',
      },
    })
    landed = 'ok'
  } catch (error) {
    landed = error?.code ?? String(error)
  }
  // The guard only decides refusal; whatever the artifact schema says next is a
  // different concern, so assert the absence of foundation-mismatch.
  check('a frame that names the premise is not refused by the guard', landed !== 'foundation-mismatch', landed)

  // Without a proposal the guard has nothing to compare and must not block.
  const { workId: plain } = s.initWork(root, { title: '无提案' })
  let plainResult = ''
  try {
    s.writeFoundationStage(root, {
      work: plain, stage: 'frame',
      payload: { storyFrame: '任意框架。', volumeMap: '卷一。', currentFocus: '无。' },
    })
    plainResult = 'ok'
  } catch (error) {
    plainResult = error?.code ?? String(error)
  }
  check('a work without a proposal is not refused by the guard', plainResult !== 'foundation-mismatch', plainResult)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
