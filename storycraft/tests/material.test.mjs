// Material library: upload validation, dedupe, list, rename, delete and isolation.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../storage.js'
import { materialsDir, openWork } from '../db.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const root = await mkdtemp(join(tmpdir(), 'storycraft-material-'))
try {
  const work = (await s.initWork(root, { title: '素材测试' })).workId
  const body = '旧井边有一把钥匙。\n这是作者提供的参考资料。'
  const imported = await s.importMaterial(root, work, { name: '示例.md', contentBase64: b64(body) })
  check('import returns public metadata', imported.duplicate === false && imported.material.title === '示例'
    && imported.material.format === 'md' && imported.material.bytes === Buffer.byteLength(body), JSON.stringify(imported))
  check('metadata has no content or origin', !JSON.stringify(imported).includes('旧井边') && !JSON.stringify(imported).includes('.storycraft'), JSON.stringify(imported))
  check('material defaults to reference purpose', imported.material.purpose === 'reference', JSON.stringify(imported.material))
  const listed = await s.listMaterials(root, work)
  check('list returns the imported material', listed.length === 1 && listed[0].id === imported.material.id, JSON.stringify(listed))
  const files = await readdir(materialsDir(root))
  check('managed copy exists', files.length === 1 && files[0].endsWith('示例.md'), files.join(','))

  const hit = s.search(root, work, '旧井边')
  check('material is searchable', hit.some(item => item.kind === 'material' && item.id === `material:${imported.material.id}`), JSON.stringify(hit))
  const materialOnly = s.searchMemory(root, work, '旧井边', { kinds: ['material'] })
  check('searchMemory kinds narrows to material', materialOnly.length > 0 && materialOnly.every(item => item.kind === 'material'),
    JSON.stringify(materialOnly))
  check('searchMemory empty kinds returns nothing', s.searchMemory(root, work, '旧井边', { kinds: [] }).length === 0)
  check('searchMemory unknown kinds returns nothing', s.searchMemory(root, work, '旧井边', { kinds: ['nope'] }).length === 0)
  const contextMemory = s.searchMemory(root, work, '旧井边')
  const materialHit = contextMemory.find(item => item.kind === 'material')
  check('material title is searchable', s.searchMemory(root, work, '示例').some(item => item.id === `material:${imported.material.id}`)
    && s.search(root, work, '示例').some(item => item.id === `material:${imported.material.id}`),
  JSON.stringify({ memory: s.searchMemory(root, work, '示例'), search: s.search(root, work, '示例') }))
  check('searchMemory includes a bounded material snippet', materialHit !== undefined
    && materialHit.sourceIds[0] === `material:${imported.material.id}`
    && [...materialHit.text].length <= 400
    && [...materialHit.text.split('\n')[0]].length <= 60
    && materialHit.text.includes('示例') && !materialHit.text.includes('.storycraft'),
  JSON.stringify(materialHit))

  const duplicate = await s.importMaterial(root, work, { name: 'other.md', purpose: 'setting', contentBase64: b64(body) })
  check('duplicate returns the existing id and purpose', duplicate.duplicate === true
    && duplicate.material.id === imported.material.id && duplicate.material.purpose === 'reference', JSON.stringify(duplicate))
  check('duplicate adds no file', (await readdir(materialsDir(root))).length === 1)
  const raw = openWork(root, work)
  try {
    check('duplicate adds no search document',
      raw.prepare("SELECT count(*) AS n FROM search_docs WHERE kind = 'material'").get().n === 1)
  } finally {
    raw.close()
  }

  const purposed = await s.setMaterialPurpose(root, work, imported.material.id, 'scene')
  check('purpose update is returned and filtered', purposed.purpose === 'scene'
    && (await s.listMaterials(root, work, 'scene')).some(item => item.id === imported.material.id)
    && (await s.listMaterials(root, work, 'setting')).length === 0, JSON.stringify(purposed))
  let invalidPurpose
  try {
    await s.setMaterialPurpose(root, work, imported.material.id, 'notes')
  } catch (error) {
    invalidPurpose = error.code
  }
  check('invalid purpose is rejected', invalidPurpose === 'material-purpose-invalid', String(invalidPurpose))
  let invalidImport
  try {
    await s.importMaterial(root, work, { name: 'bad-purpose.md', purpose: 'notes', contentBase64: b64('坏用途') })
  } catch (error) {
    invalidImport = error.code
  }
  check('invalid import purpose is rejected before writing', invalidImport === 'material-purpose-invalid'
    && (await readdir(materialsDir(root))).length === 1, String(invalidImport))
  check('invalid purpose did not change the row',
    (await s.listMaterials(root, work, 'scene')).some(item => item.id === imported.material.id))
  let emptyPurpose
  try {
    await s.setMaterialPurpose(root, work, imported.material.id, '')
  } catch (error) {
    emptyPurpose = error.code
  }
  check('empty purpose is invalid for updates', emptyPurpose === 'material-purpose-invalid', String(emptyPurpose))
  let emptyFilter
  try {
    await s.listMaterials(root, work, '')
  } catch (error) {
    emptyFilter = error.code
  }
  check('empty purpose filter is invalid', emptyFilter === 'material-purpose-invalid', String(emptyFilter))
  check('searchMemory purposes filter only materials',
    s.searchMemory(root, work, '旧井边', { purposes: ['scene'] }).some(item => item.kind === 'material')
    && s.searchMemory(root, work, '旧井边', { purposes: ['setting'] }).every(item => item.kind !== 'material')
    && s.searchMemory(root, work, '旧井边', { purposes: [] }).every(item => item.kind !== 'material'))

  const renamed = await s.renameMaterial(root, work, imported.material.id, '新标题')
  check('rename changes only the title', renamed.title === '新标题' && renamed.id === imported.material.id
    && renamed.hashPrefix === imported.material.hashPrefix && renamed.purpose === 'scene', JSON.stringify(renamed))
  check('rename does not change search content', s.search(root, work, '旧井边').some(item => item.kind === 'material'), JSON.stringify(s.search(root, work, '旧井边')))
  check('rename reindexes the title', s.search(root, work, '新标题').some(item => item.kind === 'material')
    && s.search(root, work, '示例').every(item => item.kind !== 'material'),
  JSON.stringify({ newTitle: s.search(root, work, '新标题'), oldTitle: s.search(root, work, '示例') }))

  await s.deleteMaterial(root, work, imported.material.id)
  check('delete removes the list row', (await s.listMaterials(root, work)).length === 0)
  check('delete removes the search document', s.search(root, work, '旧井边').every(item => item.kind !== 'material'))
  check('delete removes the retrieval candidate', s.searchMemory(root, work, '旧井边').every(item => item.kind !== 'material'))
  check('delete keeps the managed copy', (await readdir(materialsDir(root))).length === 1)
  const again = await s.importMaterial(root, work, { name: '示例.md', contentBase64: b64(body) })
  check('deleted material can be imported again', again.duplicate === false && again.material.id === imported.material.id, JSON.stringify(again))
  await s.deleteMaterial(root, work, again.material.id)

  for (const [name, payload, code] of [
    ['x.exe', b64('text'), 'material-format-unsupported'],
    ['empty.md', b64('   '), 'material-empty'],
    ['zero.md', '', 'material-empty'],
    ['bad.md', Buffer.from([0xc3, 0x28]).toString('base64'), 'material-encoding-invalid'],
    ['../x.md', b64('text'), 'material-name-invalid'],
    ['bytes.md', Buffer.from([0x61, 0x00, 0x62]).toString('base64'), 'material-encoding-invalid'],
    ['utf16.md', Buffer.from([0xff, 0xfe, 0x61, 0x00]).toString('base64'), 'material-encoding-invalid'],
  ]) {
    let codeSeen
    try {
      await s.importMaterial(root, work, { name, contentBase64: payload })
    } catch (error) {
      codeSeen = error.code
    }
    check(`reject ${name}`, codeSeen === code, String(codeSeen))
  }
  let tooLarge
  try {
    await s.importMaterial(root, work, { name: 'big.md', contentBase64: Buffer.alloc(512 * 1024 + 1, 0x61).toString('base64') })
  } catch (error) {
    tooLarge = error.code
  }
  check('reject oversized material', tooLarge === 'material-too-large', String(tooLarge))
  let longTitle
  try {
    await s.importMaterial(root, work, { name: 'title.md', contentBase64: b64('标题'), title: '长'.repeat(201) })
  } catch (error) {
    longTitle = error.code
  }
  check('reject an overlong title', longTitle === 'material-title-too-long', String(longTitle))

  const other = (await s.initWork(root, { title: '另一部' })).workId
  const isolated = await s.importMaterial(root, work, { name: '隔离.md', contentBase64: b64('隔离内容') })
  check('material stays in its work', (await s.listMaterials(root, other)).length === 0
    && s.search(root, other, '隔离内容').every(item => item.kind !== 'material'), JSON.stringify(await s.listMaterials(root, other)))

  const renamedWork = await s.renameWork(root, { work, title: '素材测试二' })
  const moved = await s.listMaterials(root, renamedWork.workId)
  check('work rename keeps materials', moved.some(item => item.id === isolated.material.id)
    && s.search(root, renamedWork.workId, '隔离内容').some(item => item.kind === 'material'), JSON.stringify(moved))

  const renamedDb = openWork(root, renamedWork.workId)
  const row = renamedDb.prepare('SELECT origin FROM materials WHERE id = ?').get(isolated.material.id)
  renamedDb.close()
  check('origin is bucket-relative, not a workspace path', row.origin.startsWith('materials/') && !row.origin.startsWith('.storycraft'), String(row.origin))

  const bomBytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a])
  const bom = await s.importMaterial(root, renamedWork.workId, { name: 'bom.md', contentBase64: bomBytes.toString('base64') })
  const bomDb = openWork(root, renamedWork.workId)
  const bomRow = bomDb.prepare('SELECT content, hash FROM materials WHERE id = ?').get(bom.material.id)
  bomDb.close()
  await rm(materialsDir(root), { recursive: true, force: true })
  writeFileSync(materialsDir(root), 'not a directory')
  let writeFailure
  try {
    await s.importMaterial(root, renamedWork.workId, { name: 'blocked.md', contentBase64: b64('blocked') })
  } catch (error) {
    writeFailure = error.code
  }
  check('managed copy write failure is reported', writeFailure === 'material-write-failed', String(writeFailure))
  await rm(materialsDir(root), { force: true })
  const prepared = (await import('../dist/materials.js')).prepareMaterial({ name: 'fail.md', contentBase64: b64('x') })
  let partialFailure
  try {
    (await import('../store-db.js')).writeManagedCopy(root, prepared, () => { throw new Error('disk full') })
  } catch (error) {
    partialFailure = error.code
  }
  check('a throwing write removes the partial copy',
    partialFailure === 'material-write-failed' && (await readdir(materialsDir(root))).length === 0,
    JSON.stringify({ partialFailure, files: await readdir(materialsDir(root)) }))

  check('BOM is preserved so export can verify the hash',
    Buffer.from(bomRow.content, 'utf8').equals(bomBytes)
    && createHash('sha256').update(Buffer.from(bomRow.content, 'utf8')).digest('hex') === bomRow.hash,
    JSON.stringify({ content: bomRow.content, hash: bomRow.hash }))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
