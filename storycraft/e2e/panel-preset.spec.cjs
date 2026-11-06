// The longform panel belongs to the storycraft preset, not the whole app.
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}

test.describe('长篇面板预设边界', () => {
  test.skip(!runtime.url, '没有运行中的实例')

  test('标准预设看不到长篇面板', async ({ page }) => {
    await page.goto(runtime.url, { waitUntil: 'domcontentloaded' })
    const onboarding = page.getByRole('dialog', { name: 'Get started' })
    if (await onboarding.count() > 0) {
      const close = onboarding.getByRole('button', { name: 'Close' })
      if (await close.count() > 0) await close.first().evaluate(node => node.click())
    }
    await page.getByRole('button', { name: 'New session' }).first().evaluate(node => node.click())
    await page.waitForTimeout(1_500)
    await expect(page.getByRole('tab', { name: '长篇面板' })).toHaveCount(0)
  })
})
