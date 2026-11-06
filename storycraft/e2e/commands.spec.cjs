const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')
const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
test.skip(!runtime.url, 'no instance')
test('panel story-init', async ({ page }) => {
  await openWorkbench(page, runtime.url)
  await page.getByRole('button', { name: '初始化工作区' }).click()
  await expect(page.getByText(/已初始化长篇工作区/)).toBeVisible({ timeout: 10_000 })
})
