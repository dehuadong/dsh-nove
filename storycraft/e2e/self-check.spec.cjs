// E13 self-check: lazy run, warnings, and detail-error fallback.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

async function enterWork(page, title, form = '短篇') {
  await openWorkbench(page, url)
  const typeTab = page.getByRole('button', { name: new RegExp('^' + form) }).first()
  if (await typeTab.count() > 0) await typeTab.evaluate(node => node.click())
  const entry = page.getByRole('button', { name: new RegExp(title) }).first()
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.evaluate(node => node.click())
}

test.describe('故事工坊自检', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('运行前不请求，正常作品无问题', async ({ page }) => {
    let requests = 0
    page.on('request', request => {
      if (request.url().includes('/api/see-storycraft/self-check')) requests += 1
    })
    await enterWork(page, '状态-分析')
    await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
    await expect(page.getByRole('region', { name: '自检' })).toBeVisible({ timeout: 10_000 })
    expect(requests).toBe(0)
    await page.getByRole('button', { name: '展开自检', exact: true }).evaluate(node => node.click())
    expect(requests).toBe(0)
    await page.getByRole('button', { name: '运行自检', exact: true }).evaluate(node => node.click())
    await expect(page.getByRole('region', { name: '自检' })).toContainText('未发现问题', { timeout: 10_000 })
    await expect(page.getByRole('region', { name: '自检' })).toContainText('检查 4 组')
    expect(requests).toBe(1)
  })

  test('状态草案显示提醒但不报错', async ({ page }) => {
    await enterWork(page, '状态-看板草案')
    await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
    await page.getByRole('button', { name: '展开自检', exact: true }).evaluate(node => node.click())
    await page.getByRole('button', { name: '运行自检', exact: true }).evaluate(node => node.click())
    await expect(page.getByRole('region', { name: '自检' })).toContainText('无错误', { timeout: 10_000 })
    await expect(page.getByRole('region', { name: '自检' })).toContainText('状态草案')
  })

  test('详情打不开时错误分支仍可自检', async ({ page }) => {
    await enterWork(page, '状态-自检坏库')
    await expect(page.getByRole('region', { name: '自检' })).toBeVisible()
    await page.getByRole('button', { name: '展开自检', exact: true }).evaluate(node => node.click())
    await page.getByRole('button', { name: '运行自检', exact: true }).evaluate(node => node.click())
    await expect(page.getByRole('region', { name: '自检' })).toContainText('schema-version-mismatch', { timeout: 10_000 })
  })
})

