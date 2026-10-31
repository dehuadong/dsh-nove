// E6 analysis: lazy review/call aggregates and on-demand rhythm.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

async function openBoard(page, title, form = '短篇') {
  await openWorkbench(page, url)
  const typeTab = page.getByRole('button', { name: new RegExp('^' + form) }).first()
  if (await typeTab.count() > 0) await typeTab.evaluate(node => node.click())
  const entry = page.getByRole('button', { name: new RegExp(title) }).first()
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.evaluate(node => node.click())
  await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
  await expect(page.locator('#sc-panel-dashboard')).toBeVisible({ timeout: 10_000 })
}

async function openAnalysis(page, title, form = '短篇') {
  await openBoard(page, title, form)
  await page.getByRole('button', { name: '展开分析', exact: true }).evaluate(node => node.click())
}

test.describe('故事工坊分析', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('分析显示审稿分布、调用角色与成本', async ({ page }) => {
    let analysisRequests = 0
    page.on('request', request => {
      if (request.url().includes('/api/see-storycraft/analysis')) analysisRequests += 1
    })
    await openBoard(page, '状态-分析')
    expect(analysisRequests).toBe(0)
    await page.getByRole('button', { name: '展开分析', exact: true }).evaluate(node => node.click())
    await expect.poll(() => analysisRequests).toBeGreaterThan(0)
    const panel = page.locator('#sc-panel-dashboard')
    await expect(panel).toContainText('2 个未处理审稿问题')
    await expect(panel).toContainText('major')
    await expect(panel).toContainText('unspecified')
    await expect(panel).toContainText('execution')
    await expect(panel).toContainText('quality')
    await expect(panel).toContainText('已解决')
    await expect(panel).toContainText('第 1 章')
    await expect(panel).toContainText('2 次调用')
    await expect(panel).toContainText('100')
    await expect(panel).toContainText('缺 usage')
    await expect(panel).toContainText('writer')
    await expect(panel).toContainText('reviewer')
    await expect(panel).toContainText('model-a')
  })

  test('节奏按章读取现有 critique', async ({ page }) => {
    let critiqueRequests = 0
    page.on('request', request => {
      if (request.url().includes('/api/see-storycraft/critique')) critiqueRequests += 1
    })
    await openAnalysis(page, '状态-分析')
    expect(critiqueRequests).toBe(0)
    await page.locator('.sc-rhythm select').selectOption('1')
    await expect(page.locator('.sc-rhythm')).toContainText('平均句长', { timeout: 10_000 })
    await expect(page.locator('.sc-rhythm')).toContainText('最长句')
    await expect.poll(() => critiqueRequests).toBe(1)
  })

  test('没有审稿和调用时显示空状态', async ({ page }) => {
    await openAnalysis(page, '状态-基础设定', '长篇')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('还没有审稿')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('还没有调用')
  })
})
