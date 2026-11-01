// E18: read-only work/chapter summary filters.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url

test.describe('故事工坊列表筛选', () => {
  test.skip(!url, 'STORYCRAFT_E2E_RUNTIME 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('标题/状态与章节阶段筛选、分页、清空', async ({ page }) => {
    await openWorkbench(page, url)

    await page.getByLabel('作品标题').selectOption('状态-筛选')
    await page.getByRole('button', { name: '筛选', exact: true }).first().evaluate(node => node.click())
    await expect(page.getByRole('button', { name: /状态-筛选/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /示例短篇/ })).not.toBeVisible()
    await page.getByRole('button', { name: '清空', exact: true }).first().evaluate(node => node.click())

    await page.getByLabel('作品状态').selectOption('empty')
    await page.getByRole('button', { name: '筛选', exact: true }).first().evaluate(node => node.click())
    await expect(page.getByRole('button', { name: /状态-基础设定/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /状态-筛选/ })).not.toBeVisible()
    await page.getByRole('button', { name: '清空', exact: true }).first().evaluate(node => node.click())

    await page.getByLabel('作品标题').selectOption('状态-筛选')
    await page.getByRole('button', { name: '筛选', exact: true }).first().evaluate(node => node.click())
    await page.getByRole('button', { name: /状态-筛选/ }).evaluate(node => node.click())
    await page.getByRole('tab', { name: '章节', exact: true }).evaluate(node => node.click())
    await page.getByLabel('章节阶段').selectOption('written')
    await page.getByRole('button', { name: '筛选', exact: true }).last().evaluate(node => node.click())
    await expect(page.getByText('第 1 / 2 页 · 共 21 章')).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-chapter-number="21"]').evaluate(node => node.click())
    await page.getByRole('button', { name: '筛选', exact: true }).last().evaluate(node => node.click())
    await expect(page.locator('[data-chapter-number="21"]')).toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: '下一页', exact: true }).evaluate(node => node.click())
    await expect(page.getByText('第 2 / 2 页 · 共 21 章')).toBeVisible({ timeout: 10_000 })

    await page.getByLabel('章节阶段').selectOption('reviewed')
    await page.getByRole('button', { name: '筛选', exact: true }).last().evaluate(node => node.click())
    await expect(page.getByText('没有匹配的章节。')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: '清空', exact: true }).last().evaluate(node => node.click())
    await expect(page.getByText('第 1 / 2 页 · 共 21 章')).toBeVisible({ timeout: 10_000 })
  })
})
