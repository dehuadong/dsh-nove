// A role card is readable by its `role:<slug>` identity, and the model can find
// that path in the tool description.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import * as b from '../src/bible.ts'
import * as tools from '../src/tools.ts'
import { putArtifact, writeFoundationDocument, writeRoleCard } from '../src/artifact-store.ts'
import { contentVersion } from '../src/domain.ts'
import { setCurrent } from '../src/current.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const registered = []
const ctx = {
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {} },
  effect: (fn) => { fn(); return () => {} },
  get: () => undefined,
}
tools.apply(ctx, { mode: 'longform' })
const byName = new Map(registered.map(definition => [definition.name, definition]))
const readTool = byName.get('story_read')

// AC4b: the model must be able to see that role cards are readable.
check('the tool description names role:<slug>', readTool.description.includes('role:<slug>'), readTool.description)
check('the artifactId example spells out role:<slug>', readTool.parameters.properties.artifactId.description.includes('role:<slug>'), readTool.parameters.properties.artifactId.description)
check('the tool description names foundation documents', readTool.description.includes('bible:book_rules') && readTool.description.includes('roles:index'), readTool.description)
check('the artifactId example names foundation documents', readTool.parameters.properties.artifactId.description.includes('bible:book_rules') && readTool.parameters.properties.artifactId.description.includes('roles:index'), readTool.parameters.properties.artifactId.description)
check('the output schema declares hasMore', readTool.output?.schema?.properties?.hasMore?.type === 'boolean', JSON.stringify(readTool.output?.schema?.properties?.hasMore))
check('the failure envelope declares next and retryable',
  readTool.output?.schema?.properties?.error?.properties?.next !== undefined
  && readTool.output?.schema?.properties?.error?.properties?.retryable !== undefined,
  JSON.stringify(readTool.output?.schema?.properties?.error))

const root = await mkdtemp(join(tmpdir(), 'storycraft-read-role-'))
const exec = { agent: { id: 'role-session', session: { header: { cwd: root } } } }

async function seedWork(title) {
  const { workId: work } = s.initWork(root, { title, wordRange: { min: 50, max: 5000 } })
  setCurrent('role-session', work)
  return work
}

try {
  const work = await seedWork('读角色卡')
  s.writeOutline(root, { work, mainline: '一条主线' })
  s.approveOutline(root, { work })
  writeFoundationDocument(root, {
    work, name: 'story_frame',
    content: '# 故事框架\n\n## 前提\n废土上的工程队。\n\n## 核心冲突\n旧秩序与新建立。\n\n## 主角动机\n救父。\n\n## 约束\n不杀人。\n\n## 因果解决\n立国。\n',
  })
  const rulesWritten = writeFoundationDocument(root, {
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
  const indexWritten = writeFoundationDocument(root, {
    work, name: 'roles_index',
    content: { roles: [{ name: '甲', tier: 'major' }] },
  })
  setCurrent('role-session', work)
  const rulesRead = await readTool.execute({ work, artifactId: 'bible:book_rules' }, exec)
  check('book_rules reads as Markdown, not [object Object]', rulesRead.ok === true
    && rulesRead.content.startsWith('# 作品规则') && !rulesRead.content.includes('[object Object]'), JSON.stringify(rulesRead).slice(0, 300))
  check('book_rules read keeps the written revision', rulesRead.artifact?.revisionId === rulesWritten.artifact.revisionId
    && rulesRead.artifact?.kind === 'book_rules', JSON.stringify(rulesRead.artifact))
  const indexRead = await readTool.execute({ work, artifactId: 'roles:index' }, exec)
  check('roles:index reads complete JSON', indexRead.ok === true && JSON.parse(indexRead.content).roles.length === 1
    && indexRead.artifact?.kind === 'role_index' && indexRead.artifact?.revisionId === indexWritten.artifact.revisionId
    && indexRead.hasMore === false, JSON.stringify(indexRead).slice(0, 300))
  const card = {
    slug: 'jia', name: '甲', tier: 'major', motivation: '救父', knowledge: '知道账本',
    relationshipPressure: '欠人情', limits: '不杀人', arc: '学会求助', markdown: '# 甲\n\n主角；弧光：学会求助。\n',
  }
  const written = writeRoleCard(root, { work, content: card })
  putArtifact(root, {
    workId: work, artifactId: 'bible:current_focus', kind: 'current_focus',
    revisionId: contentVersion('# 当前焦点\n\n先立第一根梁。\n'),
    content: '# 当前焦点\n\n先立第一根梁。\n', provenance: 'generated', createdAt: new Date().toISOString(),
  })
  s.writePlan(root, { work, chapter: 1, perspective: '甲', goal: '立国', obstacle: '荒原', cost: '代价', turn: '决定' })
  s.approveChapterPlan(root, { work, chapter: 1 })

  // AC4: reading a card must not change what the brief sees.
  const before = (await b.assembleBrief(root, work, 1)).sections.find(section => section.name === 'characters')
  const read = await readTool.execute({ work, artifactId: 'role:jia' }, exec)
  check('a role card is readable by slug', read.ok === true, JSON.stringify(read).slice(0, 200))
  const after = (await b.assembleBrief(root, work, 1)).sections.find(section => section.name === 'characters')
  check('reading a card leaves the brief characters unchanged',
    before?.content === after?.content && after?.content.includes('甲（major）'), JSON.stringify({ before: before?.content, after: after?.content }))

  // AC1: card fields only, never the index six fields.
  const content = JSON.parse(read.content)
  const keys = Object.keys(content).sort().join(',')
  check('the card fields match the contract',
    keys === 'arc,knowledge,limits,markdown,motivation,name,relationshipPressure,slug,tier',
    keys)

  // AC2: the revision is the one that was written.
  check('the read revision is the written revision', read.artifact?.revisionId === written.artifact.revisionId,
    JSON.stringify({ read: read.artifact, written: written.artifact }))

  // AC3: a wrong slug names the existing cards; a work without cards points at the stage.
  setCurrent('role-session', work)
  const wrongResult = await readTool.execute({ work, artifactId: 'role:nobody' }, exec)
  const wrongSlug = `${wrongResult?.error?.code ?? ''}|${wrongResult?.error?.next ?? ''}`
  check('a wrong slug fails with artifact-not-found and lists existing slugs',
    wrongSlug.startsWith('artifact-not-found|') && wrongSlug.includes('jia'), wrongSlug)

  const bare = await seedWork('没有角色卡')
  setCurrent('role-session', bare)
  const noCardsResult = await readTool.execute({ work: bare, artifactId: 'role:x' }, exec)
  const noCards = `${noCardsResult?.error?.code ?? ''}|${noCardsResult?.error?.next ?? ''}`
  check('a work without cards points at the role-card stage',
    noCards.startsWith('artifact-not-found|')
    && noCards.includes('先跑角色卡阶段')
    && noCards !== wrongSlug, noCards)

  // AC5: the other id shapes keep their behaviour.
  setCurrent('role-session', work)
  const largeMarkdown = `# 作品规则\n\n${Array.from({ length: 260 }, (_, index) => `- 规则 ${index + 1}`).join('\n')}\n`
  const largeRulesWork = await seedWork('大规则')
  writeFoundationDocument(root, { work: largeRulesWork, name: 'book_rules', content: {
    version: '2', narrativePerson: '第三人称', prohibitions: ['禁止'], protagonist: { name: '甲', personalityLock: [], behavioralConstraints: [] },
    genreLock: { primary: '废土', forbidden: [] }, enableFullCastTracking: false, allowedDeviations: [], markdown: largeMarkdown,
  } })
  setCurrent('role-session', largeRulesWork)
  const partial = await readTool.execute({ work: largeRulesWork, artifactId: 'bible:book_rules' }, exec)
  check('large book_rules marks hasMore', partial.ok === true && partial.hasMore === true && partial.endLine < partial.totalLines, JSON.stringify(partial).slice(0, 200))
  const whole = await readTool.execute({ work: largeRulesWork, artifactId: 'bible:book_rules', lineCount: 500 }, exec)
  check('large book_rules reads fully with a larger page', whole.content === largeMarkdown && whole.hasMore === false, String(whole.content?.length))
  const largeIndexWork = await seedWork('大索引')
  const roles = Array.from({ length: 300 }, (_, index) => ({ name: `角色${index + 1}`, tier: index < 5 ? 'major' : 'minor' }))
  writeFoundationDocument(root, { work: largeIndexWork, name: 'roles_index', content: { roles } })
  setCurrent('role-session', largeIndexWork)
  const largeIndex = await readTool.execute({ work: largeIndexWork, artifactId: 'roles:index', lineCount: 5 }, exec)
  check('large roles:index returns complete JSON despite lineCount', largeIndex.ok === true
    && largeIndex.hasMore === false && JSON.parse(largeIndex.content).roles.length === 300, JSON.stringify(largeIndex).slice(0, 200))

  setCurrent('role-session', work)
  const worldRead = await readTool.execute({ work, artifactId: 'bible:world' }, exec)
  check('bible:world still reads text', worldRead.ok === true && typeof worldRead.content === 'string' && worldRead.content === '# 世界观\n', JSON.stringify(worldRead).slice(0, 200))
  const bibleRead = await readTool.execute({ work, artifactId: 'bible:characters' }, exec)
  check('bible:characters still reads', bibleRead.ok === true, JSON.stringify(bibleRead).slice(0, 120))
  const unknownResult = await readTool.execute({ work, artifactId: 'nonsense:1' }, exec)
  const unknown = unknownResult?.error?.code ?? ''
  check('an unknown kind stays artifact-not-readable', unknown === 'artifact-not-readable', unknown)
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
