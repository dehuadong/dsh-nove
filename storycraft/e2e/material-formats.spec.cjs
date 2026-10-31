// B1: upload PDF and EPUB through the material panel.
const fs = require('node:fs')
const JSZip = require('jszip')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

function minimalPdf(text) {
  const escaped = String(text).replace(/[()\\]/g, match => `\\${match}`)
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(header + body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(header + body)
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  return Buffer.from(`${header}${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'binary')
}

async function minimalEpub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
  zip.file('OEBPS/content.opf', '<package><metadata><dc:title>EPUB Fixture</dc:title></metadata><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>')
  zip.file('OEBPS/chapter1.xhtml', '<html><body><h1>Chapter One</h1><p>Hello EPUB material</p></body></html>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

test.describe('故事工坊格式素材', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('PDF 与 EPUB 可导入并显示来源', async ({ page }) => {
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /状态-基础设定/ }).evaluate(node => node.click())
    await page.getByRole('tab', { name: '素材', exact: true }).evaluate(node => node.click())
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 15_000 })
    const input = page.getByLabel('导入素材文件')
    await input.setInputFiles({ name: '参考.pdf', mimeType: 'application/pdf', buffer: minimalPdf('PDF material text') })
    await expect(page.getByText('素材库：1 份')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('参考.pdf', { exact: true })).toBeVisible()
    await expect(page.locator('[data-material-format="pdf"]')).toBeVisible()
    await input.setInputFiles({ name: '参考.epub', mimeType: 'application/epub+zip', buffer: await minimalEpub() })
    await expect(page.getByText('素材库：2 份')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('参考.epub', { exact: true })).toBeVisible()
    await expect(page.locator('[data-material-format="epub"]')).toBeVisible()

    page.on('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: '删除' }).last().evaluate(node => node.click())
    await expect(page.getByText('素材库：1 份')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '删除' }).last().evaluate(node => node.click())
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 15_000 })
  })
})
