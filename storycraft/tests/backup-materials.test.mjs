// F5: explicit backups carry material originals; automatic backups stay DB-only.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import * as s from '../src/storage.ts'
import JSZip from 'jszip'
import { minimalPdf } from './pdf-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const idFor = (work, file) => `backup:${work}:${/-(\d+)\.db$/u.exec(basename(file))?.[1]}`

const root = await mkdtemp(join(tmpdir(), 'storycraft-backup-materials-'))
try {
  const { workId: work } = s.initWork(root, { title: '备份素材' })
  const imported = await s.importMaterial(root, work, {
    name: '旧井.md', title: '旧井', purpose: 'setting',
    contentBase64: b64('旧井素材原文件。'),
  })
  const materialsDirPath = join(root, '.storycraft', 'materials')
  const origin = join(materialsDirPath, readdirSync(materialsDirPath)[0])
  const source = readFileSync(origin)

  const backup = await s.backupWork(root, work)
  check('explicit backup writes materials sidecar', backup.materialsFile !== undefined && existsSync(backup.materialsFile)
    && backup.materials?.count === 1, JSON.stringify({ file: backup.file, materialsFile: backup.materialsFile, materials: backup.materials }))
  const listed = await s.listBackups(root, work)
  check('list reports materials count', listed[0]?.materials?.count === 1 && listed[0]?.incomplete !== true, JSON.stringify(listed[0]))
  check('materials sidecar is separate from DB', listed[0]?.bytes > statSync(backup.file).size, JSON.stringify(listed[0]))

  unlinkSync(origin)
  const restored = await s.restoreBackup(root, work, idFor(work, backup.file))
  check('restore restores material originals', restored.materialsRestored === 1 && restored.hasMaterials === true
    && readFileSync(origin).equals(source), JSON.stringify(restored))

  const second = await s.backupWork(root, work)
  const sidecar = second.materialsFile
  unlinkSync(origin)
  writeFileSync(sidecar, 'not a zip')
  const corruptList = await s.listBackups(root, work)
  check('corrupt sidecar is labeled corrupt', corruptList.some(item => item.corrupt === true && item.materials === undefined), JSON.stringify(corruptList))
  try {
    await s.restoreBackup(root, work, idFor(work, second.file))
    check('corrupt sidecar is rejected', false)
  } catch (error) {
    check('corrupt sidecar is rejected', error?.code === 'backup-material-corrupt' && !existsSync(origin), String(error?.code))
  }

  if (existsSync(origin)) unlinkSync(origin)
  const before = (await s.listBackups(root, work)).length
  try {
    await s.backupWork(root, work)
    check('missing origin fails explicit backup', false)
  } catch (error) {
    check('missing origin fails explicit backup', error?.code === 'backup-material-missing'
      && (await s.listBackups(root, work)).length === before, String(error?.code))
  }

  const tamperWork = (await s.initWork(root, { title: '侧车篡改' })).workId
  await s.importMaterial(root, tamperWork, { name: '篡改.md', contentBase64: b64('原始素材') })
  const tamperBackup = await s.backupWork(root, tamperWork)
  const tamperZip = await JSZip.loadAsync(readFileSync(tamperBackup.materialsFile))
  const tamperManifest = JSON.parse(await tamperZip.file('manifest.json').async('string'))
  tamperZip.file('materials/未登记.txt', 'evil')
  writeFileSync(tamperBackup.materialsFile, await tamperZip.generateAsync({ type: 'nodebuffer' }))
  try {
    await s.restoreBackup(root, tamperWork, idFor(tamperWork, tamperBackup.file))
    check('unknown sidecar entry is rejected', false)
  } catch (error) {
    check('unknown sidecar entry is rejected', error?.code === 'backup-material-corrupt'
      && s.listMaterials(root, tamperWork).length === 1, String(error?.code))
  }

  const traversal = await s.backupWork(root, tamperWork)
  const traversalZip = await JSZip.loadAsync(readFileSync(traversal.materialsFile))
  const traversalManifest = JSON.parse(await traversalZip.file('manifest.json').async('string'))
  traversalManifest.materials[0].origin = 'materials/../evil'
  traversalZip.file('manifest.json', JSON.stringify(traversalManifest))
  writeFileSync(traversal.materialsFile, await traversalZip.generateAsync({ type: 'nodebuffer' }))
  try {
    await s.restoreBackup(root, tamperWork, idFor(tamperWork, traversal.file))
    check('traversal origin is rejected', false)
  } catch (error) {
    check('traversal origin is rejected', error?.code === 'backup-material-corrupt', String(error?.code))
  }

  const orphan = await s.backupWork(root, tamperWork)
  const orphanSidecar = orphan.materialsFile
  unlinkSync(orphan.file)
  await s.listBackups(root, tamperWork)
  check('list sweeps orphan sidecar', !existsSync(orphanSidecar))

  const auto = await s.backupWork(root, work, { materials: false })
  check('automatic backup is DB-only', auto.materialsFile === undefined && auto.materials === undefined, JSON.stringify(auto))
  const autoListed = await s.listBackups(root, work)
  check('DB-only backup with materials is incomplete', autoListed.some(item => item.incomplete === true && item.materials === undefined), JSON.stringify(autoListed))
  const autoRestore = await s.restoreBackup(root, work, idFor(work, auto.file))
  check('DB-only restore reports zero materials', autoRestore.hasMaterials === false && autoRestore.materialsRestored === 0, JSON.stringify(autoRestore))

  const failDestination = join(root, '.storycraft', 'backups', 'failed.db')
  try {
    await s.backupWork(root, work, failDestination)
    check('failed destination backup leaves no half pair', false)
  } catch (error) {
    check('failed destination backup leaves no half pair', error?.code === 'backup-material-missing'
      && !existsSync(failDestination) && !existsSync(`${failDestination}.materials.zip`), String(error?.code))
  }

  writeFileSync(origin, source)
  const corruptDestination = join(root, '.storycraft', 'backups', 'corrupt.db')
  writeFileSync(origin, 'tampered')
  try {
    await s.backupWork(root, work, corruptDestination)
    check('corrupt origin fails explicit backup', false)
  } catch (error) {
    check('corrupt origin fails explicit backup', error?.code === 'backup-material-corrupt'
      && !existsSync(corruptDestination) && !existsSync(`${corruptDestination}.materials.zip`), String(error?.code))
  }
  writeFileSync(origin, source)
  await s.backupWork(root, work)
  const backupsPath = join(root, '.storycraft', 'backups')
  const sidecarsBeforeNames = readdirSync(backupsPath).filter(name => name.startsWith(work + '-') && name.endsWith('.materials.zip'))
  const sidecarsBefore = sidecarsBeforeNames.length
  const keep = s.pruneBackups(root, work, 1)
  const sidecarsAfterNames = readdirSync(backupsPath).filter(name => name.startsWith(work + '-') && name.endsWith('.materials.zip'))
  const sidecarsAfter = sidecarsAfterNames.length
  check('prune removes paired sidecars', keep.removed.length > 0 && sidecarsBefore > sidecarsAfter && sidecarsAfter === 1, JSON.stringify({ keep, before: sidecarsBeforeNames, after: sidecarsAfterNames, dbs: readdirSync(backupsPath).filter(name => name.startsWith(work + '-') && name.endsWith('.db')) }))

  const latest = await s.backupWork(root, work)
  const latestSidecar = latest.materialsFile
  await s.deleteBackup(root, work, idFor(work, latest.file))
  check('delete removes paired sidecar', !existsSync(latest.file) && !existsSync(latestSidecar))

  const pdfWork = (await s.initWork(root, { title: 'PDF 备份' })).workId
  const pdf = minimalPdf('PDF backup restore')
  await s.importMaterial(root, pdfWork, { name: '原文件.pdf', title: '原文件', contentBase64: pdf.toString('base64') })
  const pdfBackup = await s.backupWork(root, pdfWork)
  const pdfDir = join(root, '.storycraft', 'materials')
  const pdfOrigin = join(pdfDir, readdirSync(pdfDir).find(name => name.includes('原文件.pdf')))
  renameSync(pdfOrigin, `${pdfOrigin}.bak`)
  const pdfRestored = await s.restoreBackup(root, pdfWork, idFor(pdfWork, pdfBackup.file))
  const pdfExport = join(root, 'pdf-export')
  s.exportWork(root, pdfWork, pdfExport)
  const exportedPdf = readFileSync(join(pdfExport, 'materials', `${s.listMaterials(root, pdfWork)[0].id}.pdf`))
  check('restored PDF exports original bytes', pdfRestored.materialsRestored === 1 && exportedPdf.equals(pdf), String(exportedPdf.length))

  await s.writePlan(root, { work: pdfWork, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
  await s.approveChapterPlan(root, { work: pdfWork, chapter: 1 })
  await s.writeChapter(root, { work: pdfWork, chapter: 1, body: '第1章正文。'.repeat(20) })
  unlinkSync(pdfOrigin)
  await s.deleteChapter(root, pdfWork, 1, { confirm: true })
  check('delete chapter tolerates missing origin', (await s.listMaterials(root, pdfWork)).length === 1 && !existsSync(pdfOrigin))

  const empty = s.initWork(root, { title: '无素材' })
  const emptyBackup = await s.backupWork(root, empty.workId)
  check('no-material backup has no sidecar', emptyBackup.materialsFile === undefined && emptyBackup.materials === undefined)
  const emptyListed = await s.listBackups(root, empty.workId)
  check('no-material backup is labeled noMaterials', emptyListed[0]?.noMaterials === true && emptyListed[0]?.incomplete !== true, JSON.stringify(emptyListed))

  const manual = join(root, '.storycraft', 'backups', 'manual.db')
  const manualBackup = await s.backupWork(root, work, manual)
  check('explicit destination sidecar is fixed', manualBackup.materialsFile === `${manual}.materials.zip` && existsSync(manualBackup.materialsFile), JSON.stringify(manualBackup))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
