// F5: a panel backup restores missing material originals before export.
const fs = require('node:fs')
const { join } = require('node:path')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url
const facts = runtime.facts ?? {}

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

test.describe('故事工坊备份素材', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('恢复备份后素材原文件可导出', async ({ page }) => {
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    await page.getByRole('tab', { name: '素材', exact: true }).evaluate(node => node.click())
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('导入素材文件').setInputFiles({
      name: '恢复参考.pdf', mimeType: 'application/pdf', buffer: minimalPdf('backup material'),
    })
    await expect(page.getByText('素材库：1 份')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('tab', { name: '备份' }).evaluate(node => node.click())
    await page.getByRole('button', { name: '立即备份' }).evaluate(node => node.click())
    await expect(page.getByText(/已备份/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/素材 1 份/)).toBeVisible({ timeout: 10_000 })

    const materialsDir = join(runtime.fixtureWorkspace, '.storycraft', 'materials')
    const origin = fs.readdirSync(materialsDir)[0]
    fs.renameSync(join(materialsDir, origin), join(materialsDir, `${origin}.bak`))

    page.on('dialog', dialog => { void dialog.accept() })
    await page.getByRole('button', { name: '恢复', exact: true }).first().evaluate(node => node.click())
    await expect(page.getByText(/已恢复备份与 1 份素材/)).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => fs.existsSync(join(materialsDir, origin)), { timeout: 5_000 }).toBe(true)

    await page.getByRole('button', { name: '导出', exact: true }).evaluate(node => node.click())
    await expect(page.getByText(/已导出 \d+ 个文件/)).toBeVisible({ timeout: 20_000 })
    const epub = join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId, 'book.epub')
    await expect.poll(() => fs.existsSync(epub), { timeout: 5_000 }).toBe(true)

    await page.getByRole('tab', { name: '素材', exact: true }).evaluate(node => node.click())
    await page.getByRole('button', { name: '删除' }).last().evaluate(node => node.click())
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 10_000 })
  })
})
