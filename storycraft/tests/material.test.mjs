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
  const listed = await s.listMaterials(root, work)
  check('list returns the imported material', listed.length === 1 && listed[0].id === imported.material.id, JSON.stringify(listed))
  const files = await readdir(materialsDir(root))
  check('managed copy exists', files.length === 1 && files[0].endsWith('示例.md'), files.join(','))

  const hit = s.search(root, work, '旧井边')
  check('material is searchable', hit.some(item => item.kind === 'material' && item.id === `material:${imported.material.id}`), JSON.stringify(hit))
  const contextMemory = s.searchMemory(root, work, '旧井边')
  check('searchMemory still excludes materials', contextMemory.every(item => item.kind !== 'material'), JSON.stringify(contextMemory))

  const duplicate = await s.importMaterial(root, work, { name: 'other.md', contentBase64: b64(body) })
  check('duplicate returns the existing id', duplicate.duplicate === true && duplicate.material.id === imported.material.id, JSON.stringify(duplicate))
  check('duplicate adds no file', (await readdir(materialsDir(root))).length === 1)
  const raw = openWork(root, work)
  try {
    check('duplicate adds no search document',
      raw.prepare("SELECT count(*) AS n FROM search_docs WHERE kind = 'material'").get().n === 1)
  } finally {
    raw.close()
  }

  const renamed = await s.renameMaterial(root, work, imported.material.id, '新标题')
  check('rename changes only the title', renamed.title === '新标题' && renamed.id === imported.material.id, JSON.stringify(renamed))
  check('rename does not change search content', s.search(root, work, '旧井边').some(item => item.kind === 'material'), JSON.stringify(s.search(root, work, '旧井边')))

  await s.deleteMaterial(root, work, imported.material.id)
  check('delete removes the list row', (await s.listMaterials(root, work)).length === 0)
  check('delete removes the search document', s.search(root, work, '旧井边').every(item => item.kind !== 'material'))
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
  const prepared = (await import('../materials.js')).prepareMaterial({ name: 'fail.md', contentBase64: b64('x') })
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
