// Workspace catalog and work lifecycle: metadata authority, file moves, reconciliation.
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORK_SCHEMA_VERSION, openCatalog, openDatabase, openWork, trashFile, workFile } from '../db.js'
import * as store from '../store-db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
async function rejects(name, code, fn) {
  try {
    await fn()
    check(name, false, 'expected rejection')
  } catch (error) {
    check(name, error?.code === code, `got ${error?.code ?? error?.message}`)
  }
}
const exists = path => stat(path).then(() => true).catch(() => false)

const root = await mkdtemp(join(tmpdir(), 'storycraft-store-'))
try {
  const created = store.initWork(root, { title: '测试作品', wordRange: { min: 3000, max: 5000 }, tags: ['长篇'] })
  const work = created.workId
  check('initWork returns an id', work === '测试作品', work)
  check('initWork creates the work database', await exists(workFile(root, work)))
  check('the returned artifact path is virtual', created.path === `works/${work}`, created.path)
  check('initWork returns the manifest', created.manifest.title === '测试作品')

  const catalog = openCatalog(root, { create: false })
  const row = catalog.prepare('SELECT * FROM works WHERE work_id = ?').get(work)
  check('catalog stores title/form/tags/version', row.title === '测试作品' && row.form === 'longform'
    && row.tags === '["长篇"]' && row.schema_version === WORK_SCHEMA_VERSION, JSON.stringify(row))
  const catalogTables = catalog.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(item => item.name)
  check('catalog has no chapter content tables', !catalogTables.includes('chapters') && !catalogTables.includes('bible'), catalogTables.join(','))
  catalog.close()

  const manifest = store.readManifest(root, work)
  check('manifest carries form and range', manifest.form === 'longform' && manifest.wordRange?.min === 3000, JSON.stringify(manifest))
  check('new work is unapproved', manifest.planApproval === 'required' && manifest.outline === undefined)
  await rejects('uninitialized id is refused, not created', 'work-not-found', async () => store.readManifest(root, '未立项'))
  check('a refused open created no file', (await exists(workFile(root, '未立项'))) === false)

  await rejects('duplicate title refused', 'work-exists', async () => store.createProposal(root, { title: '测试作品', form: 'longform', premise: '重复' }))

  const settings = store.updateSettings(root, { work, wordRange: { min: 2000, max: 4000 }, planApproval: 'off' })
  check('settings update', settings.wordRange.min === 2000 && settings.planApproval === 'off', JSON.stringify(settings))

  const outlined = store.writeOutline(root, { work, mainline: '一条主线', volumes: '第一卷' })
  check('outline written', typeof outlined.outline.writtenAt === 'string')
  const unapproved = store.readManifest(root, work)
  check('outline waits for approval', unapproved.outline.approvedAt === undefined)
  const approved = store.approveOutline(root, { work })
  check('outline approval recorded', typeof approved.outline.approvedAt === 'string')
  check('readManifest sees approval', store.readManifest(root, work).outline.approvedAt !== undefined)

  // Title-only rename keeps the identity and the file, and syncs the meta copy.
  const titled = store.renameWork(root, { work, title: '只改标题' })
  check('title-only rename keeps the id', titled.workId === work && titled.title === '只改标题', JSON.stringify(titled))
  check('title-only rename keeps the file', await exists(workFile(root, work)))
  const metaDb = openWork(root, work)
  const meta = metaDb.prepare('SELECT title FROM meta WHERE id = 1').get()
  metaDb.close()
  check('meta is the export copy and follows the title', meta.title === '只改标题', meta.title)
  const titledCatalog = openCatalog(root, { create: false })
  check('catalog stays the title authority', titledCatalog.prepare('SELECT title FROM works WHERE work_id = ?').get(work).title === '只改标题')
  titledCatalog.close()

  // Identity rename moves the database file and both metadata copies.
  const renamed = store.renameWork(root, { work, workId: '改名作品', title: '改名作品' })
  check('explicit rename changes id and title', renamed.workId === '改名作品' && renamed.title === '改名作品', JSON.stringify(renamed))
  check('old work file is gone', (await exists(workFile(root, work))) === false)
  check('new work file exists', await exists(workFile(root, '改名作品')))
  const renamedDb = openWork(root, '改名作品')
  check('meta follows the id', renamedDb.prepare('SELECT work_id FROM meta WHERE id = 1').get().work_id === '改名作品')
  renamedDb.close()
  await rejects('old id no longer resolves', 'work-not-found', async () => store.readManifest(root, work))

  // Works are isolated; each carries its own schema version.
  store.initWork(root, { title: '另一本' })
  check('listWorks isolates works', store.listWorks(root).length === 2)
  check('readManifest only returns its own chapters', store.readManifest(root, '另一本').chapters.length === 0)
  const broken = openWork(root, '另一本')
  broken.exec('PRAGMA user_version = 99')
  broken.close()
  await rejects('a work with a newer schema is refused', 'schema-version-mismatch', async () => store.readManifest(root, '另一本'))
  check('the other work is unaffected', store.readManifest(root, '改名作品').title === '改名作品')
  const repaired = openDatabase(workFile(root, '另一本'))
  repaired.exec(`PRAGMA user_version = ${WORK_SCHEMA_VERSION}`)
  repaired.close()

  // Trash and restore.
  const deleted = store.deleteWork(root, { work: renamed.workId })
  check('delete moves the file into trash', deleted.path === `.storycraft/trash/${renamed.workId}.db`, deleted.path)
  check('trashed file exists', await exists(trashFile(root, renamed.workId)))
  check('trashed work leaves the active list', !store.listWorks(root).some(item => item.workId === renamed.workId))
  check('trash lists it', store.listTrash(root)[0]?.workId === renamed.workId)
  store.restoreWork(root, { name: renamed.workId })
  check('restore returns it', store.listWorks(root).some(item => item.workId === renamed.workId))
  await rejects('restoring an active work is refused', 'work-not-found', async () => store.restoreWork(root, { name: renamed.workId }))

  // Restore refuses a name that is already taken.
  await store.deleteWork(root, { work: renamed.workId })
  await copyFile(workFile(root, '另一本'), workFile(root, renamed.workId))
  await rejects('restore onto an occupied name is refused', 'work-exists', async () => store.restoreWork(root, { name: renamed.workId }))
  await rm(workFile(root, renamed.workId), { force: true })

  // Startup reconciliation: a catalog row without a file is skipped; an orphan
  // file is reported; a trash file without a row is kept for manual recovery.
  const missing = store.initWork(root, { title: '缺文件' }).workId
  await rm(workFile(root, missing), { force: true })
  const report = store.reconcileWorks(root)
  check('reconcile reports the missing work', report.missing.includes(missing), JSON.stringify(report))
  const afterMissing = openCatalog(root, { create: false })
  check('missing row is stamped', afterMissing.prepare('SELECT missing_at FROM works WHERE work_id = ?').get(missing).missing_at !== null)
  afterMissing.close()
  check('missing work leaves the list', !store.listWorks(root).some(item => item.workId === missing))
  await rejects('opening a missing work reports work-not-found', 'work-not-found', async () => store.readManifest(root, missing))
  // Bring it back: the next reconciliation clears the stamp.
  await copyFile(workFile(root, '另一本'), workFile(root, missing))
  store.reconcileWorks(root)
  check('a recovered file returns to the list', store.listWorks(root).some(item => item.workId === missing))
  // Orphan file (never in the catalog).
  await writeFile(workFile(root, '孤儿'), '')
  check('reconcile reports the orphan file', store.reconcileWorks(root).orphans.includes('孤儿.db'))
  await rm(workFile(root, '孤儿'), { force: true })
  // Trash file without a catalog row.
  await writeFile(trashFile(root, '孤儿'), '')
  check('reconcile reports the trash file', store.reconcileWorks(root).trash.includes('孤儿.db'))
  await rm(trashFile(root, '孤儿'), { force: true })

  // Rename onto an existing identity is refused.
  await rejects('rename onto an existing id refused', 'work-exists', async () => store.renameWork(root, { work: '另一本', workId: '改名作品' }))

  // Session current pointers live in the catalog.
  store.setSessionCurrent(root, 'session-a', '另一本')
  store.setSessionCurrent(root, 'session-b', '改名作品')
  const pointers = store.readSessionCurrent(root)
  check('session pointers persisted', pointers['session-a'] === '另一本' && pointers['session-b'] === '改名作品')
  store.setSessionCurrent(root, 'session-a', '改名作品')
  check('one pointer updates without dropping another', Object.keys(store.readSessionCurrent(root)).length === 2)
  store.setSessionCurrent(root, 'session-a', '另一本')
  store.clearSessionCurrent(root, 'session-b')
  check('one pointer can be cleared without dropping another', Object.keys(store.readSessionCurrent(root)).length === 1)

  // Proposals live in the catalog, not in files.
  await rejects('proposal needs a premise', 'proposal-invalid',
    async () => store.createProposal(root, { title: '空提案', form: 'longform', premise: '  ' }))
  await rejects('proposal form is validated', 'proposal-invalid',
    async () => store.createProposal(root, { title: '怪形态', form: 'novella', premise: '一句话' }))
  const proposal = store.createProposal(root, { title: '新想法', form: 'short', premise: '一句话' })
  const id = proposal.id
  check('proposal stored', store.readProposal(root, id).title === '新想法')
  const catalogWithProposal = openCatalog(root, { create: false })
  check('proposal is in the catalog', catalogWithProposal.prepare('SELECT count(*) AS n FROM proposals').get().n === 1)
  catalogWithProposal.close()
  store.markProposalUsed(root, id, '另一本')
  check('proposal marked used', typeof store.readProposal(root, id).usedAt === 'string')
  check('prune keeps fresh proposals', store.pruneProposals(root, 1000).removed === 0)
  check('listProposals reads the catalog', store.listProposals(root)[0].id === id)

  // Renaming the identity follows the catalog references too.
  const recatalogued = store.renameWork(root, { work: '另一本', workId: '另一改' })
  check('rename returns the new id', recatalogued.workId === '另一改')
  check('rename follows session pointers', store.readSessionCurrent(root)['session-a'] === '另一改')
  check('rename follows used proposals', store.readProposal(root, id).usedWorkId === '另一改')
  // A clean review can settle without a fake revision.
  const clean = store.initWork(root, { title: '清稿测试' }).workId
  store.writeOutline(root, { work: clean, mainline: '一条主线' })
  store.approveOutline(root, { work: clean })
  store.writePlan(root, { work: clean, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  store.approveChapterPlan(root, { work: clean, chapter: 1 })
  store.writeChapter(root, { work: clean, chapter: 1, title: '清稿章', body: '正文。'.repeat(50) })
  store.writeReview(root, { work: clean, chapter: 1, problems: [] })
  const cleanNext = store.nextStep(root, clean)
  check('a clean review goes to summary without revise', cleanNext.action === 'story_summarize', JSON.stringify(cleanNext))
  store.writeChapter(root, { work: clean, chapter: 1, title: '清稿章', body: '正文改。'.repeat(50), rewrite: true })
  await rejects('a stale clean review cannot settle', 'review-required',
    () => store.foldState(root, { work: clean, chapter: 1, entities: [{ name: '甲', facts: ['活着'] }], hooks: [] }))
  store.writeReview(root, { work: clean, chapter: 1, problems: [] })
  store.writeSummary(root, { work: clean, chapter: 1, text: '摘要' })
  const cleanSettle = store.nextStep(root, clean)
  check('a clean review then goes to state', cleanSettle.action === 'story_state', JSON.stringify(cleanSettle))
  const settled = store.foldState(root, { work: clean, chapter: 1, entities: [{ name: '甲', facts: ['活着'] }], hooks: [] })
  check('a clean review can settle', settled.ok === undefined ? true : settled.ok !== false, JSON.stringify(settled))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
