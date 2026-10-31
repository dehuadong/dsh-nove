// E7 call logs: lazy load, cursor paging, failure-only filter.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

async function enterWork(page, title, form = '短篇') {
  await openWorkbench(page, url)
  const notice = page.getByRole('button', { name: 'Continue' })
  if (await notice.count() > 0) await notice.first().evaluate(node => node.click())
  const typeTab = page.getByRole('button', { name: new RegExp('^' + form) }).first()
  if (await typeTab.count() > 0) await typeTab.evaluate(node => node.click())
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = page.getByRole('button', { name: new RegExp(escaped + '(?!完成)') }).first()
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.evaluate(node => node.click())
}

async function openLogs(page, title, form = '短篇') {
  await enterWork(page, title, form)
  await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
  const panel = page.getByRole('region', { name: '日志' })
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '展开日志', exact: true }).evaluate(node => node.click())
  return panel
}

test.describe('故事工坊调用日志', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('展开前不请求，分页按游标读取', async ({ page }) => {
    let requests = 0
    page.on('request', request => {
      if (request.url().includes('/api/see-storycraft/logs')) requests += 1
    })
    await enterWork(page, '状态-日志')
    await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
    const panel = page.getByRole('region', { name: '日志' })
    await expect(panel).toBeVisible({ timeout: 10_000 })
    expect(requests).toBe(0)
    await page.getByRole('button', { name: '展开日志', exact: true }).evaluate(node => node.click())
    await expect(panel.getByRole('listitem')).toHaveCount(20, { timeout: 10_000 })
    expect(requests).toBe(1)
    await panel.getByRole('button', { name: '更早', exact: true }).evaluate(node => node.click())
    await expect(panel.getByRole('listitem')).toHaveCount(25, { timeout: 10_000 })
    await expect(panel.getByRole('button', { name: '更早', exact: true })).toHaveCount(0)
  })

  test('失败过滤只保留未接受调用', async ({ page }) => {
    const panel = await openLogs(page, '状态-日志')
    await expect(panel.getByRole('listitem')).toHaveCount(20)
    await panel.getByRole('button', { name: '仅失败', exact: true }).evaluate(node => node.click())
    await expect(panel.getByRole('listitem')).toHaveCount(8, { timeout: 10_000 })
    await expect(panel).toContainText('拒绝')
    await expect(panel).toContainText('fixture-failure')
    await expect(panel).not.toContainText('成功')
  })

  test('completed 标为未接受并进入失败过滤', async ({ page }) => {
    const panel = await openLogs(page, '状态-日志完成')
    await expect(panel.getByRole('listitem')).toHaveCount(1)
    await expect(panel).toContainText('未接受')
    await panel.getByRole('button', { name: '仅失败', exact: true }).evaluate(node => node.click())
    await expect(panel.getByRole('listitem')).toHaveCount(1)
  })

  test('没有调用时显示空状态', async ({ page }) => {
    const panel = await openLogs(page, '状态-基础设定', '长篇')
    await expect(panel).toContainText('还没有调用记录')
  })
})

