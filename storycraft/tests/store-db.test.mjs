// Work-level SQLite store (S2): lifecycle, settings, outline, proposals.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../db.js'
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

const root = await mkdtemp(join(tmpdir(), 'storycraft-store-'))
try {
  const created = store.initWork(root, { title: '测试作品', wordRange: { min: 3000, max: 5000 } })
  const work = created.workId
  check('initWork returns an id', work === '测试作品', work)
  const manifest = store.readManifest(root, work)
  check('manifest carries form and range', manifest.form === 'longform' && manifest.wordRange?.min === 3000, JSON.stringify(manifest))
  check('new work is unapproved', manifest.planApproval === 'required' && manifest.outline === undefined)

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

  // Rename cascades to child rows.
  const db = openStore(root)
  db.prepare('INSERT INTO chapters (work_id, number, updated_at) VALUES (?, ?, ?)').run(work, 1, new Date().toISOString())
  db.prepare("INSERT INTO bible (work_id, name, content, version, updated_at) VALUES (?, 'style', '短句', 'v1', ?)").run(work, new Date().toISOString())
  db.close()
  const titled = store.renameWork(root, { work, title: '只改标题' })
  check('title-only rename keeps the id', titled.workId === work && titled.title === '只改标题', JSON.stringify(titled))
  const renamed = store.renameWork(root, { work, workId: '改名作品', title: '改名作品' })
  check('explicit rename changes id and title', renamed.workId === '改名作品' && renamed.title === '改名作品', JSON.stringify(renamed))
  const renamedDb = openStore(root)
  check('rename cascades to chapters', renamedDb.prepare('SELECT work_id FROM chapters').get()?.work_id === '改名作品')
  check('rename cascades to bible', renamedDb.prepare('SELECT work_id FROM bible').get()?.work_id === '改名作品')
  renamedDb.close()

  // Works are isolated: another work does not see these chapters.
  store.initWork(root, { title: '另一本' })
  check('listWorks isolates works', store.listWorks(root).length === 2)
  check('readManifest only returns its own chapters', store.readManifest(root, '另一本').chapters.length === 0)

  // Trash and restore.
  store.deleteWork(root, { work: renamed.workId })
  check('trashed work leaves the active list', !store.listWorks(root).some(item => item.workId === renamed.workId))
  check('trash lists it', store.listTrash(root)[0]?.workId === '改名作品')
  store.restoreWork(root, { work: renamed.workId })
  check('restore returns it', store.listWorks(root).some(item => item.workId === renamed.workId))

  // Session current pointers live in the store.
  store.replaceSessionCurrent(root, { 'session-a': renamed.workId, 'session-b': '另一本' })
  const pointers = store.readSessionCurrent(root)
  check('session pointers persisted', pointers['session-a'] === renamed.workId && pointers['session-b'] === '另一本')
  store.replaceSessionCurrent(root, { 'session-a': renamed.workId })
  check('session pointers can be replaced', Object.keys(store.readSessionCurrent(root)).length === 1)

  // Proposals.
  const proposal = store.createProposal(root, { title: '新想法', form: 'short', premise: '一句话' })
  const id = proposal.proposal.id
  check('proposal stored', store.readProposal(root, id).title === '新想法')
  store.markProposalUsed(root, id, '新想法')
  check('proposal marked used', typeof store.readProposal(root, id).usedAt === 'string')
  check('prune keeps fresh proposals', store.pruneProposals(root, 1000).removed === 0)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
