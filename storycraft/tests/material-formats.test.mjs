// B1: EPUB/PDF material import, extraction, search and export.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as s from '../src/storage.ts'
import { openWork, materialsDir } from '../src/db.ts'
import { minimalPdf } from './pdf-fixture.mjs'
import { minimalEpub } from './epub-fixture.mjs'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
async function rejects(name, code, fn) {
  try { await fn(); check(name, false, '没有抛错') }
  catch (error) { check(name, error?.code === code, `${error?.code}: ${error?.message}`) }
}
const b64 = buffer => Buffer.from(buffer).toString('base64')

const root = await mkdtemp(join(tmpdir(), 'storycraft-material-formats-'))
try {
  const { workId: work } = s.initWork(root, { title: '格式素材' })
  const pdf = minimalPdf('PDF reference text')
  const imported = await s.importMaterial(root, work, { name: '参考.pdf', contentBase64: b64(pdf), purpose: 'reference' })
  check('PDF is stored as pdf with source name', imported.material.format === 'pdf' && imported.material.sourceName === '参考.pdf', JSON.stringify(imported.material))
  check('PDF bytes/hash cover the original file', imported.material.bytes === pdf.length, String(imported.material.bytes))
  const [listed] = s.listMaterials(root, work)
  check('list shows the PDF', listed?.format === 'pdf' && listed?.sourceName === '参考.pdf', JSON.stringify(listed))
  const db = openWork(root, work)
  const doc = db.prepare("SELECT body FROM search_docs WHERE doc_id = ?").get(`material:${imported.material.id}`)
  db.close()
  check('extracted PDF text is indexed', String(doc?.body).includes('PDF reference text'), String(doc?.body))

  const duplicate = await s.importMaterial(root, work, { name: '另一份.pdf', contentBase64: b64(pdf) })
  check('same bytes are a duplicate', duplicate.duplicate === true && duplicate.material.id === imported.material.id)
  for (const name of readdirSync(materialsDir(root))) await rm(join(materialsDir(root), name), { force: true })
  const repaired = await s.importMaterial(root, work, { name: '修复.pdf', contentBase64: b64(pdf) })
  const repairedFiles = readdirSync(materialsDir(root))
  check('missing managed copy is repaired on duplicate', repaired.duplicate === true && repairedFiles.length === 1 && (await stat(join(materialsDir(root), repairedFiles[0]))).size === pdf.length)

  const epub = await minimalEpub()
  const epubMaterial = await s.importMaterial(root, work, { name: '参考.epub', contentBase64: b64(epub) })
  check('EPUB is stored as epub', epubMaterial.material.format === 'epub' && epubMaterial.material.sourceName === '参考.epub')
  const fontEpub = await minimalEpub({ encryptedUri: 'OEBPS/fonts/body.ttf' })
  const fontMaterial = await s.importMaterial(root, work, { name: '字体.epub', contentBase64: b64(fontEpub) })
  check('font-obfuscated EPUB is allowed', fontMaterial.material.format === 'epub')
  const exportDir = join(root, 'export')
  const exported = s.exportWork(root, work, exportDir)
  const exportedPdf = await readFile(join(exportDir, 'materials', `${imported.material.id}.pdf`))
  const exportedEpub = await readFile(join(exportDir, 'materials', `${epubMaterial.material.id}.epub`))
  check('export writes original PDF bytes', exportedPdf.equals(pdf), `${exported.files}`)
  check('export writes original EPUB bytes', exportedEpub.equals(epub), `${exportedEpub.length}`)
  const epubDb = openWork(root, work)
  const epubDoc = epubDb.prepare('SELECT body FROM search_docs WHERE doc_id = ?').get(`material:${epubMaterial.material.id}`)
  epubDb.close()
  check('extracted EPUB text is indexed', String(epubDoc?.body).includes('Hello EPUB'), String(epubDoc?.body))

  await rejects('18MB source cap is enforced', 'material-too-large', () => s.importMaterial(root, work, {
    name: '大.pdf', contentBase64: b64(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(18 * 1024 * 1024)])),
  }))
  const longEpub = await minimalEpub({ bodyText: 'a'.repeat(2_000_001) })
  await rejects('2M extracted text cap is enforced', 'material-extract-too-large', () => s.importMaterial(root, work, {
    name: '长.epub', contentBase64: b64(longEpub),
  }))
  const manySpine = await minimalEpub({ chapters: 501 })
  await rejects('EPUB spine cap is enforced', 'material-extract-too-large', () => s.importMaterial(root, work, {
    name: '多章.epub', contentBase64: b64(manySpine),
  }))
  await rejects('corrupt PDF is a parse error', 'material-parse-failed', () => s.importMaterial(root, work, {
    name: '坏.pdf', contentBase64: b64('%PDF-not-a-real-document'),
  }))
  const pdfManaged = readdirSync(materialsDir(root)).find(name => name.endsWith('.pdf'))
  await rm(join(materialsDir(root), pdfManaged), { force: true })
  await rejects('missing original blocks export', 'material-origin-missing', () => s.exportWork(root, work, join(root, 'export-missing')))
  await rejects('encrypted spine is refused', 'material-encrypted', async () => {
    await s.importMaterial(root, work, { name: '加密.epub', contentBase64: b64(await minimalEpub({ encryptedChapter: true })) })
  })

  await rejects('wrong magic is refused', 'material-format-invalid', () => s.importMaterial(root, work, { name: '假.pdf', contentBase64: b64('not a pdf') }))
  await rejects('empty PDF text is refused', 'material-extract-empty', () => s.importMaterial(root, work, { name: '空.pdf', contentBase64: b64(minimalPdf('')) }))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
