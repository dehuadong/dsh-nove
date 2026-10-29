// No invented role caps; identity is name, tier is the index's, and a tier
// change invalidates the card.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { readRoleCard } from '../src/artifact-store.ts'
import { validateArchitectShape } from '../src/submission.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function codeOf(fn) {
  try { fn(); return '' } catch (error) { return error?.code ?? String(error) }
}
const card = (slug, name, tier = 'major') => ({
  slug, name, tier, motivation: 'm', knowledge: 'k', relationshipPressure: 'r', limits: 'l', markdown: `# ${name}`,
})
const frame = {
  storyFrame: '# 故事框架\n\n## 前提\n甲在修表。\n\n## 核心冲突\n旧账。\n\n## 主角动机\n还账。\n\n## 约束\n不骗人。\n\n## 因果解决\n归零。\n',
  volumeMap: '## 第一卷\n- 卷目标：查账。\n- 起止章：1–3。\n- 关键节拍：翻账。\n- 卷末承诺：选择。\n',
  currentFocus: '# 当前焦点\n\n先查甲。',
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-role-model-'))
try {
  const { workId: work } = s.initWork(root, { title: '角色模型' })
  s.writeFoundationStage(root, { work, stage: 'frame', payload: frame })
  const many = Array.from({ length: 30 }, (_, index) => ({ name: `角色${index + 1}`, tier: index % 2 === 0 ? 'major' : 'minor' }))
  const manyCards = many.map((role, index) => card(`role${index + 1}`, role.name, role.tier))
  check('dispatch accepts 30 roles', validateArchitectShape('architect', { rolesIndex: { roles: many } }, 'roles') === undefined)
  check('dispatch accepts 30 cards', validateArchitectShape('architect', { roleCards: manyCards }, 'cards') === undefined)
  s.writeFoundationStage(root, { work, stage: 'roles', payload: { rolesIndex: { roles: many } } })
  const landed = s.writeFoundationStage(root, { work, stage: 'cards', payload: { roleCards: manyCards } })
  check('30 roles and 30 cards land', landed.foundation.stages.cards === true && manyCards.length === 30, JSON.stringify(landed.foundation.stages))
  check('a 30/13 card set is refused as incomplete', codeOf(() => s.writeFoundationStage(root, {
    work, stage: 'cards', payload: { roleCards: manyCards.slice(0, 13) },
  })) === 'artifact-invalid')

  // Name identity: a new slug replaces the old card instead of duplicating it.
  const second = s.initWork(root, { title: 'slug 替换' }).workId
  s.writeFoundationStage(root, { work: second, stage: 'frame', payload: frame })
  s.writeFoundationStage(root, { work: second, stage: 'roles', payload: { rolesIndex: { roles: [{ name: '甲', tier: 'major' }] } } })
  s.writeFoundationStage(root, { work: second, stage: 'cards', payload: { roleCards: [card('jia', '甲')] } })
  s.writeFoundationStage(root, { work: second, stage: 'cards', payload: { roleCards: [card('jia2', '甲')] } })
  check('a new slug replaces the old card', codeOf(() => readRoleCard(root, { work: second, slug: 'jia' })) === 'artifact-not-found'
    && readRoleCard(root, { work: second, slug: 'jia2' }).artifact.content.name === '甲')

  // Tier follows the index: a changed tier drops the stale card and blocks approval.
  const third = s.initWork(root, { title: '层级变更' }).workId
  s.writeFoundationStage(root, { work: third, stage: 'frame', payload: frame })
  s.writeFoundationStage(root, { work: third, stage: 'roles', payload: { rolesIndex: { roles: [{ name: '甲', tier: 'major' }, { name: '乙', tier: 'minor' }] } } })
  s.writeFoundationStage(root, { work: third, stage: 'cards', payload: { roleCards: [card('jia', '甲'), card('yi', '乙', 'minor')] } })
  s.writeFoundationStage(root, { work: third, stage: 'roles', payload: { rolesIndex: { roles: [{ name: '甲', tier: 'major' }, { name: '乙', tier: 'major' }] } } })
  check('a tier change drops the stale card', codeOf(() => readRoleCard(root, { work: third, slug: 'yi' })) === 'artifact-not-found'
    && s.readFoundationState(root, third).stages.cards === false)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
