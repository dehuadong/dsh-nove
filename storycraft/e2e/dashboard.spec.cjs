// E1/E4/E5 dashboard: progress, unresolved hooks, summaries, and the foundation card.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

async function enterWork(page, title, form = '长篇') {
  await openWorkbench(page, url)
  const typeTab = page.getByRole('button', { name: new RegExp('^' + form) }).first()
  if (await typeTab.count() > 0) await typeTab.evaluate(node => node.click())
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = page.getByRole('button', { name: new RegExp(escaped + '(?!草案)') }).first()
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.evaluate(node => node.click())
  await expect(page.locator('.sc-main-tab')).toHaveCount(7, { timeout: 15_000 })
  await expect(page.locator('.sc-main-tab').first()).toHaveText('看板')
}

async function openDashboard(page, title, form = '长篇') {
  await enterWork(page, title, form)
  await page.locator('.sc-main-tab').filter({ hasText: '看板' }).evaluate(node => node.click())
  await expect(page.locator('#sc-panel-dashboard')).toBeVisible({ timeout: 10_000 })
}

test.describe('故事工坊看板', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('看板显示进度、伏笔与摘要', async ({ page }) => {
    await openDashboard(page, '示例短篇')
    await expect(page.locator('.sc-dash-card')).toHaveCount(6)
    await expect(page.locator('#sc-panel-dashboard')).toContainText('待处理伏笔')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('灰旗是谁挂的')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('章节进度')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('摘要')
    // The fixture's only chapter is settled, so the author transition is blocked with a reason.
    await expect(page.getByRole('button', { name: '已用（推进）' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '已用（推进）' })).toHaveAttribute('title', /没有未定稿的已写章/)
  })

  test('伏笔按章分组，标记后刷新状态', async ({ page }) => {
    await openDashboard(page, '状态-看板', '短篇')
    const first = page.locator('.sc-hook').filter({ hasText: '旧钥匙' })
    const second = page.locator('.sc-hook').filter({ hasText: '第二把钥匙' })
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(page.locator('.sc-hook-group')).toHaveCount(2)
    await first.getByRole('button', { name: '已用（推进）' }).evaluate(node => node.click())
    await expect(first).toContainText('推进中', { timeout: 10_000 })
    await expect(first.getByRole('button', { name: '已解' })).toBeEnabled()
  })

  test('有状态草案时标记被拒绝并提示', async ({ page }) => {
    await openDashboard(page, '状态-看板草案', '短篇')
    const hook = page.locator('.sc-hook').filter({ hasText: '旧钥匙' })
    await hook.getByRole('button', { name: '已用（推进）' }).evaluate(node => node.click())
    await expect(page.getByText(/本章还有状态草案/)).toBeVisible({ timeout: 10_000 })
  })

  test('没有章节时看板为空状态', async ({ page }) => {
    await openDashboard(page, '状态-基础设定')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('还没有章节')
    await expect(page.locator('#sc-panel-dashboard')).toContainText('没有未解伏笔')
  })

  test('基础设定按钮从章节切到真值并显示阶段卡', async ({ page }) => {
    await enterWork(page, '示例短篇')
    await page.locator('.sc-main-tab').filter({ hasText: '章节' }).evaluate(node => node.click())
    await page.getByRole('button', { name: '基础设定', exact: true }).evaluate(node => node.click())
    await expect(page.locator('.sc-main-tab[aria-selected="true"]')).toHaveText('真值')
    await expect(page.locator('.sc-foundation')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.sc-foundation .sc-stage')).toHaveCount(4)
  })
})

