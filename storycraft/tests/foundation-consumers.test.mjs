// S4b: foundation artifacts feed brief, role context, retrieval and export.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as b from '../src/bible.ts'
import { assembleRoleContext } from '../src/context.ts'
import { putArtifact, writeFoundationDocument, writeRoleCard } from '../src/artifact-store.ts'
import { contentVersion } from '../src/domain.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'storycraft-foundation-consumers-'))
try {
  const { workId: work } = s.initWork(root, { title: '基础消费', wordRange: { min: 50, max: 5000 } })
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  const rolesIndex = {
    roles: [
      { name: '甲', tier: 'major' },
      { name: '乙', tier: 'minor' },
    ],
  }
  writeFoundationDocument(root, {
    work, name: 'story_frame',
    content: '# 故事框架\n\n## 前提\n废土上的工程队。\n\n## 核心冲突\n旧秩序与新建立。\n\n## 主角动机\n救父。\n\n## 约束\n不杀人。\n\n## 因果解决\n立国。\n',
  })
  writeFoundationDocument(root, {
    work, name: 'book_rules',
    content: {
      version: '2', narrativePerson: '第三人称', prohibitions: ['禁止无代价的奇迹'],
      protagonist: { name: '甲', personalityLock: [], behavioralConstraints: [] },
      genreLock: { primary: '废土', forbidden: [] }, enableFullCastTracking: false,
      allowedDeviations: [], markdown: '# 作品规则\n\n禁止无代价的奇迹。\n',
    },
  })
  writeFoundationDocument(root, {
    work, name: 'volume_map',
    content: '## 第一卷\n- 卷目标：立住脚。\n- 起止章：1–20。\n- 关键节拍：搭棚。\n- 卷末承诺：活下来。\n',
  })
  writeFoundationDocument(root, { work, name: 'roles_index', content: rolesIndex })
  writeRoleCard(root, {
    work, content: {
      slug: 'jia', name: '甲', tier: 'major', motivation: '救父', knowledge: '知道账本',
      relationshipPressure: '欠人情', limits: '不杀人', arc: '学会求助', markdown: '# 甲\n\n主角；弧光：学会求助。\n',
    },
  })
  writeRoleCard(root, {
    work, content: {
      slug: 'yi', name: '乙', tier: 'minor', motivation: '守铺', knowledge: '旧案', relationshipPressure: '欠账',
      limits: '不亲自动手', markdown: '# 乙\n\n对手。\n',
    },
  })
  putArtifact(root, {
    workId: work, artifactId: 'bible:current_focus', kind: 'current_focus',
    revisionId: contentVersion('# 当前焦点\n\n先立第一根梁。\n'),
    content: '# 当前焦点\n\n先立第一根梁。\n', provenance: 'generated', createdAt: new Date().toISOString(),
  })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: '立国', obstacle: '荒原', cost: '代价', turn: '决定' })
  s.approveChapterPlan(root, { work, chapter: 1 })

  const brief = await b.assembleBrief(root, work, 1)
  const names = brief.sections.map(section => section.name)
  check('brief carries the foundation order',
    names.join(',') === 'intent,storyFrame,bookRules,plan,currentFocus,characters,hooks,volumeMap,volumeSummary,recentSummaries,previous,style,wordPolicy',
    names.join(','))
  const storyFrame = brief.sections.find(section => section.name === 'storyFrame')
  const bookRules = brief.sections.find(section => section.name === 'bookRules')
  const volumeMap = brief.sections.find(section => section.name === 'volumeMap')
  const focus = brief.sections.find(section => section.name === 'currentFocus')
  const characters = brief.sections.find(section => section.name === 'characters')
  check('foundation sections render their artifacts',
    storyFrame?.content.includes('废土上的工程队') && bookRules?.content.includes('无代价的奇迹')
    && volumeMap?.content.includes('立住脚') && focus?.content.includes('第一根梁'),
    JSON.stringify({ storyFrame, bookRules, volumeMap, focus }))
  check('characters come from the roles index when present',
    characters?.content.includes('甲（major）') && characters.source.endsWith('foundation/roles'),
    JSON.stringify(characters))

  writeFoundationDocument(root, {
    work, name: 'book_rules',
    content: {
      version: '2', narrativePerson: '第三人称', prohibitions: ['禁止无代价的奇迹'],
      protagonist: { name: '甲', personalityLock: [], behavioralConstraints: [] },
      genreLock: { primary: '废土', forbidden: [] }, enableFullCastTracking: false,
      allowedDeviations: [], markdown: '# 作品规则\n\n' + '长'.repeat(9000),
    },
  })
  const trimmed = await b.assembleBrief(root, work, 1)
  check('budget stops before protected foundation sections',
    trimmed.budget.overBudget === true
    && trimmed.sections.some(section => section.name === 'bookRules' && section.content !== '')
    && trimmed.sections.some(section => section.name === 'storyFrame' && section.content !== ''), JSON.stringify(trimmed.budget))
  check('protected sections are never dropped',
    !trimmed.dropped.some(item => ['storyFrame', 'bookRules'].includes(item.name)), JSON.stringify(trimmed.dropped))

  const planner = await assembleRoleContext({ root, work, chapter: 1, role: 'planner', task: '规划第一章' })
  const plannerPlan = planner.sections.find(section => section.name === 'plan')
  check('planner plan carries foundation and focus',
    plannerPlan?.content.includes('故事框架') && plannerPlan.content.includes('当前焦点'),
    JSON.stringify(plannerPlan?.content?.slice(0, 200)))
  const plannerVolumeMap = planner.sections.find(section => section.name === 'volumeMap')
  check('planner volume map is a compressible section',
    plannerVolumeMap?.content.includes('搭棚') && plannerVolumeMap.protection === 'compressible', JSON.stringify(plannerVolumeMap))
  const writer = await assembleRoleContext({ root, work, chapter: 1, role: 'writer', task: '写第一章' })
  const constraints = writer.sections.find(section => section.name === 'constraints')
  check('writer constraints carry story frame and book rules',
    constraints?.content.includes('故事框架') && constraints.content.includes('作品规则'), JSON.stringify(constraints?.content?.slice(0, 200)))
  const plannerCharacters = planner.sections.find(section => section.name === 'characters')
  check('planner characters come from roles',
    plannerCharacters?.content.includes('甲') && plannerCharacters.source.endsWith('foundation/roles'),
    JSON.stringify(plannerCharacters))

  const writerCards = await assembleRoleContext({ root, work, chapter: 1, role: 'writer', task: '写第一章' })
  const writerConstraints = writerCards.sections.find(section => section.name === 'constraints')
  check('writer constraints read the lead card (name + limits)',
    writerConstraints?.content.includes('主角：甲') && writerConstraints.content.includes('行为边界：不杀人')
    && !writerConstraints.content.includes('语气：'),
    JSON.stringify(writerConstraints?.content?.slice(0, 240)))
  s.writePlan(root, { work, chapter: 2, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't', body: '乙先出现，甲后到。' })
  s.approveChapterPlan(root, { work, chapter: 2 })
  const plannerNamed = await assembleRoleContext({ root, work, chapter: 2, role: 'planner', task: '规划第二章' })
  const plannerNamedCards = plannerNamed.sections.find(section => section.name === 'characters')
  check('planner picks plan-named cards', plannerNamedCards?.content.includes('乙')
    && plannerNamedCards.content.includes('甲'), JSON.stringify(plannerNamedCards?.content?.slice(0, 240)))
  s.writeChapter(root, { work, chapter: 1, body: '甲在荒原上立起第一根梁。'.repeat(20) })
  for (const role of ['reviewer', 'reviser']) {
    const context = await assembleRoleContext({ root, work, chapter: 1, role, task: `以${role}身份检查第一章`, body: '甲在荒原上立起第一根梁。'.repeat(20) })
    const roleConstraints = context.sections.find(section => section.name === 'constraints')
    check(`${role} constraints carry story frame and book rules`,
      roleConstraints?.content.includes('故事框架') && roleConstraints.content.includes('作品规则'),
      JSON.stringify(roleConstraints?.content?.slice(0, 200)))
  }

  const frameHits = s.searchMemory(root, work, '废土上的工程队')
  check('story_frame is searchable', frameHits.some(item => item.kind === 'story_frame'), JSON.stringify(frameHits.map(item => item.kind)))
  const rulesHits = s.searchMemory(root, work, '作品规则')
  check('book_rules is searchable', rulesHits.some(item => item.kind === 'book_rules'), JSON.stringify(rulesHits.map(item => item.kind)))
  const mapHits = s.searchMemory(root, work, '搭棚')
  check('volume_map is searchable', mapHits.some(item => item.kind === 'volume_map'), JSON.stringify(mapHits.map(item => item.kind)))
  const indexHits = s.searchMemory(root, work, 'roles')
  check('roles index is searchable', indexHits.some(item => item.kind === 'role_index'), JSON.stringify(indexHits.map(item => item.kind)))
  const roleHits = s.searchMemory(root, work, '学会求助')
  check('role cards are searchable', roleHits.some(item => item.kind === 'role_card'), JSON.stringify(roleHits.map(item => item.kind)))

  const exported = await s.exportWork(root, work, join(root, 'out'))
  const frameFile = await readFile(join(exported.directory, 'foundation', 'story_frame.md'), 'utf8')
  const rulesFile = await readFile(join(exported.directory, 'foundation', 'book_rules.md'), 'utf8')
  const indexFile = await readFile(join(exported.directory, 'foundation', 'roles', 'index.json'), 'utf8')
  const cardFile = await readFile(join(exported.directory, 'foundation', 'roles', 'jia.md'), 'utf8')
  const focusFile = await readFile(join(exported.directory, 'foundation', 'current_focus.md'), 'utf8')
  check('export projects the foundation tree',
    frameFile.includes('废土') && rulesFile.includes('作品规则') && indexFile.includes('"jia"') === false
    && JSON.parse(indexFile).roles.length === 2 && cardFile.includes('主角') && focusFile.includes('第一根梁'),
    JSON.stringify({ frameFile, rulesFile, indexFile, cardFile, focusFile }))
  let volumeMissing = false
  try {
    await stat(join(exported.directory, 'foundation', 'volume_map.md'))
  } catch {
    volumeMissing = true
  }
  check('present foundation documents are exported', volumeMissing === false)

  const plain = s.initWork(root, { title: '无 foundation', wordRange: { min: 50, max: 5000 } }).workId
  s.writeOutline(root, { work: plain, mainline: '无 foundation 的计划' })
  s.approveOutline(root, { work: plain })
  s.writeBible(root, {
    work: plain, name: 'characters',
    content: JSON.stringify([{ name: '丙', role: '主角', want: '活', fear: '死', limit: '不害人', voice: '平' }]),
  })
  s.writePlan(root, { work: plain, chapter: 1, perspective: '丙', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  s.approveChapterPlan(root, { work: plain, chapter: 1 })
  const absent = await b.assembleBrief(root, plain, 1)
  const absentByName = new Map(absent.sections.map(section => [section.name, section]))
  check('missing foundation fails open with absent sections',
    absentByName.get('storyFrame')?.absent === true && absentByName.get('bookRules')?.absent === true
    && absentByName.get('volumeMap')?.absent === true && absentByName.get('currentFocus')?.absent === true,
    JSON.stringify([...absentByName.values()].filter(section => section.absent).map(section => section.name)))
  check('missing roles fall back to bible characters',
    absentByName.get('characters')?.source.endsWith('bible/characters.json') && absentByName.get('characters').content.includes('丙'),
    JSON.stringify(absentByName.get('characters')))
  const plainExport = await s.exportWork(root, plain, join(root, 'plain-out'))
  let foundationAbsent = false
  try {
    await stat(join(plainExport.directory, 'foundation'))
  } catch {
    foundationAbsent = true
  }
  check('missing foundation artifacts produce no foundation export', foundationAbsent === true)
  const plainPlanner = await assembleRoleContext({ root, work: plain, chapter: 1, role: 'planner', task: '规划第一章' })
  check('planner still assembles without foundation',
    plainPlanner.sections.some(section => section.name === 'plan'), JSON.stringify(plainPlanner.sections.map(section => section.name)))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) process.exitCode = 1
