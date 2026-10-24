// Direct truth editing guards: plan, types, validation and version conflicts.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../dist/storage.js'
import { assertEditableBible, EDITABLE_BIBLE_FILES, readBible, writeBible } from '../bible.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

check('editable set excludes plan', !EDITABLE_BIBLE_FILES.includes('plan')
  && EDITABLE_BIBLE_FILES.join(',') === 'world,characters,style,intent', EDITABLE_BIBLE_FILES.join(','))
let plan
try {
  assertEditableBible('plan')
} catch (error) {
  plan = error.code
}
check('plan is rejected centrally', plan === 'approval-moved', String(plan))
let unknown
try {
  assertEditableBible('unknown')
} catch (error) {
  unknown = error.code
}
check('unknown truth is rejected', unknown === 'bible-invalid', String(unknown))

const root = await mkdtemp(join(tmpdir(), 'storycraft-bible-edit-'))
try {
  const work = (await s.initWork(root, { title: '真值编辑' })).workId
  let notString
  try {
    await writeBible(root, work, 'world', null)
  } catch (error) {
    notString = error.code
  }
  check('content must be a string', notString === 'bible-invalid', String(notString))
  let planWrite
  try {
    await writeBible(root, work, 'plan', '# 计划\n\n绕过。\n')
  } catch (error) {
    planWrite = error.code
  }
  check('writeBible rejects plan', planWrite === 'approval-moved', String(planWrite))
  let characters
  try {
    await writeBible(root, work, 'characters', '{"name":"甲"}')
  } catch (error) {
    characters = error.code
  }
  check('bad characters are bible-invalid', characters === 'bible-invalid', String(characters))
  const validCharacters = JSON.stringify([{ name: '甲', role: '主角', want: 'w', fear: 'f', limit: 'l', voice: 'v' }])
  await writeBible(root, work, 'characters', validCharacters)
  check('six-field characters are accepted', (await readBible(root, work, 'characters')).files[0].content === validCharacters)
  let emptyWorld
  try {
    await writeBible(root, work, 'world', '')
  } catch (error) {
    emptyWorld = error.code
  }
  let emptyStyle
  try {
    await writeBible(root, work, 'style', '')
  } catch (error) {
    emptyStyle = error.code
  }
  check('empty world/style are rejected', emptyWorld === 'bible-invalid' && emptyStyle === 'bible-invalid',
    `${emptyWorld} ${emptyStyle}`)

  const first = await writeBible(root, work, 'world', '# 世界观\n\n井台。\n')
  let conflict
  try {
    await writeBible(root, work, 'world', '# 世界观\n\n井台与路。\n', { expectedVersion: 'stale000000' })
  } catch (error) {
    conflict = error.code
  }
  check('stale expectedVersion is bible-conflict', conflict === 'bible-conflict', String(conflict))
  const second = await writeBible(root, work, 'world', '# 世界观\n\n井台与路。\n', { expectedVersion: first.version })
  check('fresh expectedVersion writes', second.version !== first.version)
  await writeBible(root, work, 'intent', '')
  check('empty intent stays allowed', (await readBible(root, work, 'intent')).files[0].content === '')
  const bible = await readBible(root, work)
  check('readBible exposes editable set', bible.editable.join(',') === 'world,characters,style,intent')
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
