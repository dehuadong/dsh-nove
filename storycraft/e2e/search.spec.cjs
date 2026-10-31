// B2: panel unified search with skill source and location.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

async function openSearch(page) {
  await openWorkbench(page, url)
  const notice = page.getByRole('button', { name: 'Continue' })
  if (await notice.count() > 0) await notice.first().evaluate(node => node.click())
  await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
  await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
  const panel = page.getByRole('region', { name: '检索' })
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '展开检索', exact: true }).evaluate(node => node.click())
  return panel
}

test.describe('故事工坊统一检索', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('技能命中显示来源与位置', async ({ page }) => {
    let requests = 0
    page.on('request', request => {
      if (request.url().includes('/api/see-storycraft/search')) requests += 1
    })
    const panel = await openSearch(page)
    expect(requests).toBe(0)
    await panel.getByLabel('检索关键词').fill('伏笔')
    await panel.getByRole('button', { name: '检索', exact: true }).evaluate(node => node.click())
    await expect(panel.locator('[data-search-kind="skill"]')).toBeVisible({ timeout: 10_000 })
    await expect(panel.locator('[data-search-kind="skill"]')).toContainText('skill:')
    await expect(panel.locator('[data-search-kind="skill"]')).toContainText('· L')
    expect(requests).toBe(1)
  })

  test('空查询不请求且显示提示', async ({ page }) => {
    let requests = 0
    page.on('request', request => {
      if (request.url().includes('/api/see-storycraft/search')) requests += 1
    })
    const panel = await openSearch(page)
    await panel.getByRole('button', { name: '检索', exact: true }).evaluate(node => node.click())
    await expect(panel).toContainText('输入关键词后检索')
    expect(requests).toBe(0)
    await panel.getByLabel('检索关键词').fill('绝对不存在的检索词XYZ')
    await panel.getByRole('button', { name: '检索', exact: true }).evaluate(node => node.click())
    await expect(panel).toContainText('没有命中', { timeout: 10_000 })
  })
})
