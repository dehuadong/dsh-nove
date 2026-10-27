// The workbench state model: every step offers exactly one primary action.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

async function openWork(page, title, form = '长篇') {
  await openWorkbench(page, url)
  const tab = page.getByRole('button', { name: new RegExp('^' + form) }).first()
  if (await tab.count() > 0) await tab.evaluate(node => node.click())
  const entry = page.getByRole('button', { name: new RegExp(title) }).first()
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.evaluate(node => node.click())
  const card = page.locator('.sc-state-card')
  await expect(card).toBeVisible({ timeout: 15_000 })
  return card
}

test.describe('面板状态模型', () => {
  test.skip(!url, 'STORYCRAFT_E2E_URL 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('基础设定缺失：面板只报告状态，不提供生成按钮', async ({ page }) => {
    const card = await openWork(page, '状态-基础设定')
    await expect(card).toHaveAttribute('data-state', 'foundation-needed')
    // The panel never advances a protocol step: generation belongs to the session.
    await expect(card.getByRole('button', { name: '生成基础设定' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '基础设定待生成' })).toBeDisabled()
  })

  test('没有全书计划：主按钮写计划', async ({ page }) => {
    const card = await openWork(page, '状态-无计划', '短篇')
    await expect(card).toHaveAttribute('data-state', 'outline-needed')
    await expect(card.locator('button.sc-btn-primary')).toHaveCount(1)
    await expect(card.getByRole('button', { name: '写全书计划' })).toBeVisible()
  })

  test('全书计划待确认：主按钮确认计划', async ({ page }) => {
    const card = await openWork(page, '状态-计划待确认', '短篇')
    await expect(card).toHaveAttribute('data-state', 'outline-pending')
    await expect(card.locator('button.sc-btn-primary')).toHaveCount(1)
    await expect(card.getByRole('button', { name: '确认全书计划' })).toBeVisible()
  })

  test('章纲待确认：主按钮确认章纲', async ({ page }) => {
    const card = await openWork(page, '状态-章纲待确认', '短篇')
    await expect(card).toHaveAttribute('data-state', 'plan-pending')
    await expect(card.locator('button.sc-btn-primary')).toHaveCount(1)
    await expect(card.getByRole('button', { name: '确认第 1 篇的章纲' })).toBeVisible()
  })

  test('写作中：主按钮写正文，次按钮一次做完', async ({ page }) => {
    const card = await openWork(page, '状态-写作中', '短篇')
    await expect(card).toHaveAttribute('data-state', 'writing')
    await expect(card.locator('button.sc-btn-primary')).toHaveCount(1)
    await expect(card.getByRole('button', { name: /写第 1 篇（写到修订）/ })).toBeVisible()
    await expect(card.getByRole('button', { name: /一次做完/ })).toBeVisible()
  })

  test('审稿中：修订按钮禁用并给出原因', async ({ page }) => {
    const card = await openWork(page, '状态-审稿中', '短篇')
    await expect(card).toHaveAttribute('data-state', 'reviewing')
    await expect(card.locator('button.sc-btn-primary')).toHaveCount(1)
    await expect(card.getByRole('button', { name: '审稿第 1 篇' })).toBeVisible()
    const revise = card.locator('button[data-workbench="revise"]')
    await expect(revise).toBeDisabled()
    await expect(revise).toHaveAttribute('aria-label', /审稿还没有条目，先审稿/)
  })
})
